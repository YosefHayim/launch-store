// Docs: https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { platform as detectOperatingSystem } from 'node:os';
import { Option, Schema } from 'effect';
import type { AscKey } from '@core/types/credentials.js';

export const APP_STORE_CONNECT_ORIGIN = 'https://api.appstoreconnect.apple.com';
export const APP_STORE_CONNECT_BASE_URL = `${APP_STORE_CONNECT_ORIGIN}/v1`;
const AUDIENCE = 'appstoreconnect-v1';
// Apple rejects tokens whose lifetime exceeds 20 minutes; stay safely under it.
const TOKEN_TTL_SECONDS = 19 * 60;
const TOKEN_REUSE_SECONDS = 15 * 60;
const ASSET_UPLOAD_CONCURRENCY = 4;
// A clock more than ~1 minute fast pushes the 19-minute `exp` past Apple's 20-minute ceiling; 60s is above HTTP `Date` granularity and network jitter.
const CLOCK_SKEW_TOLERANCE_SECONDS = 60;
// Apple has no agreements-status endpoint; this 403 code on any request is the only signal.
const REQUIRED_AGREEMENTS_ERROR_CODE = 'REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED';

const mintedTokens = new Map<string, Readonly<{ token: string; issuedAt: number }>>();

export interface LocaleCopy {
  locale: string;
  name: string;
  description?: string | undefined;
}

export type ResourceList<Attributes> = {
  data: {
    id: string;
    attributes: Attributes;
  }[];
};

export type ResourceSingle<Attributes> = {
  data: {
    id: string;
    attributes: Attributes;
  };
};

// `relationships` holds the `build` linkage only when the request named `build` in `fields`.
export type AppleResource<Attributes> = {
  id: string;
  attributes: Attributes;
  relationships?: { build?: { data?: { id: string } | null } };
};

// `links.next` is an absolute URL to the following page, present only while more pages remain.
export type PagedList<Attributes> = {
  data: AppleResource<Attributes>[];
  links?: {
    next?: string;
  };
};

// One chunk Apple wants sent to its upload CDN. The URL is presigned, and `requestHeaders` must be sent verbatim.
export type UploadOperation = {
  method?: string;
  url: string;
  length?: number;
  offset?: number;
  requestHeaders?: {
    name?: string;
    value?: string;
  }[];
};

export type AssetReservation = {
  data: {
    id: string;
    attributes: {
      uploadOperations?: UploadOperation[];
    };
  };
};

// App / version / app-info states in which Apple still accepts metadata edits (categories, age rating, review details).
export const EDITABLE_METADATA_STATES = new Set<string>([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
]);

type AscError = {
  status?: string;
  code?: string;
  title?: string;
  detail?: string;
  source?: {
    pointer?: string;
    parameter?: string;
  };
  meta?: {
    associatedErrors?: Record<string, readonly AscError[]>;
  };
};

const AscErrorSchema: Schema.Schema<AscError> = Schema.suspend(() =>
  Schema.Struct({
    status: Schema.optionalWith(Schema.String, { exact: true }),
    code: Schema.optionalWith(Schema.String, { exact: true }),
    title: Schema.optionalWith(Schema.String, { exact: true }),
    detail: Schema.optionalWith(Schema.String, { exact: true }),
    source: Schema.optionalWith(
      Schema.Struct({
        pointer: Schema.optionalWith(Schema.String, { exact: true }),
        parameter: Schema.optionalWith(Schema.String, { exact: true }),
      }),
      { exact: true },
    ),
    meta: Schema.optionalWith(
      Schema.Struct({
        associatedErrors: Schema.optionalWith(
          Schema.Record({ key: Schema.String, value: Schema.Array(AscErrorSchema) }),
          { exact: true },
        ),
      }),
      { exact: true },
    ),
  }),
);

const AscErrorsDocumentSchema = Schema.parseJson(
  Schema.Struct({ errors: Schema.optionalWith(Schema.Array(AscErrorSchema), { exact: true }) }),
);

// Carries the HTTP `status` so callers can tell a transient failure (429, 5xx) from a permanent 4xx, and Apple's machine-readable `codes`.
export type AscRequestError = Error & {
  readonly name: 'AscRequestError';
  readonly status: number;
  readonly codes: readonly string[];
};

export const makeAscRequestError = (
  message: string,
  status: number,
  codes: readonly string[] = [],
): AscRequestError => {
  const requestError = new Error(message);
  return Object.assign(requestError, { name: 'AscRequestError' as const, status, codes });
};

const isAscRequestError = (failure: unknown): failure is AscRequestError => {
  if (!(failure instanceof Error)) return false;
  return failure.name === 'AscRequestError' && 'status' in failure && 'codes' in failure;
};

const isRetryableAscError = (failure: unknown): boolean => {
  if (!isAscRequestError(failure)) return false;
  if (failure.status === 429) return true;
  return failure.status >= 500;
};

// Apple sometimes refuses a valid bearer token mid-run; the request did not run.
const isRejectedToken = (requestFailure: unknown): boolean =>
  isAscRequestError(requestFailure) && requestFailure.status === 401;

// A GET or byte-range PUT is safe to repeat, so a dropped connection (fetch's TypeError) is retried like a 5xx.
export const isRetryableIdempotentFailure = (requestFailure: unknown): boolean => {
  if (requestFailure instanceof TypeError) return true;
  return isRetryableAscError(requestFailure);
};

export type AppleTransportRetryPolicy = {
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly maximumDelayMs?: number;
  readonly isRetryableFailure: (transportFailure: unknown) => boolean;
};

export const retryAppleTransportRequest = async <TransportResponse>(
  requestAttempt: () => Promise<TransportResponse>,
  retryPolicy: AppleTransportRetryPolicy,
): Promise<TransportResponse> => {
  let attempts = 4;
  if (retryPolicy.attempts !== undefined) attempts = retryPolicy.attempts;
  let baseDelayMs = 500;
  if (retryPolicy.baseDelayMs !== undefined) baseDelayMs = retryPolicy.baseDelayMs;
  let maximumDelayMs = 8000;
  if (retryPolicy.maximumDelayMs !== undefined) maximumDelayMs = retryPolicy.maximumDelayMs;

  let lastTransportFailure: unknown;
  for (let attemptNumber = 1; attemptNumber <= attempts; attemptNumber += 1) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: retries wait for the preceding request.
      return await requestAttempt();
    } catch (transportFailure) {
      lastTransportFailure = transportFailure;
      if (attemptNumber === attempts) throw transportFailure;
      if (!retryPolicy.isRetryableFailure(transportFailure)) throw transportFailure;
      const retryDelayMs = Math.min(maximumDelayMs, baseDelayMs * 2 ** (attemptNumber - 1));
      await new Promise<void>((resumeRetry) => setTimeout(resumeRetry, retryDelayMs));
    }
  }
  throw lastTransportFailure;
};

type NumericVersion = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};

const parseNumericVersion = (marketingVersion: string): NumericVersion | null => {
  const versionCore = marketingVersion.trim().replace(/^v/i, '').split(/[-+]/)[0];
  if (versionCore === undefined) return null;
  if (!/^\d+(\.\d+){0,2}$/.test(versionCore)) return null;
  const versionParts = versionCore
    .split('.')
    .map((versionPart) => Number.parseInt(versionPart, 10));
  let major = 0;
  if (versionParts[0] !== undefined) major = versionParts[0];
  let minor = 0;
  if (versionParts[1] !== undefined) minor = versionParts[1];
  let patch = 0;
  if (versionParts[2] !== undefined) patch = versionParts[2];
  return { major, minor, patch };
};

const compareNumericVersions = (leftVersion: string, rightVersion: string): number => {
  const leftParts = parseNumericVersion(leftVersion);
  const rightParts = parseNumericVersion(rightVersion);
  if (leftParts === null) return -1;
  if (rightParts === null) return 1;
  for (const versionPart of ['major', 'minor', 'patch'] as const) {
    if (leftParts[versionPart] < rightParts[versionPart]) return -1;
    if (leftParts[versionPart] > rightParts[versionPart]) return 1;
  }
  return 0;
};

export const highestAppleMarketingVersion = (
  marketingVersions: readonly string[],
): string | null => {
  const parseableVersions = marketingVersions.filter(
    (marketingVersion) => parseNumericVersion(marketingVersion) !== null,
  );
  if (parseableVersions.length === 0) return null;
  return parseableVersions.reduce((highestVersion, marketingVersion) => {
    if (compareNumericVersions(marketingVersion, highestVersion) > 0) return marketingVersion;
    return highestVersion;
  });
};

// Turn a bare 401 into an actionable hint when the machine clock disagrees with Apple's `Date` header. macOS-only because the `sudo sntp` remedy is Apple-specific.
export const clockSkewHint = (clockReading: {
  appleDate: string | null;
  nowMs: number;
  platform: NodeJS.Platform;
}): string => {
  if (clockReading.platform !== 'darwin') return '';
  if (clockReading.appleDate === null) return '';
  const appleMs = Date.parse(clockReading.appleDate);
  if (Number.isNaN(appleMs)) return '';
  const skewSeconds = Math.abs(clockReading.nowMs - appleMs) / 1000;
  if (skewSeconds < CLOCK_SKEW_TOLERANCE_SECONDS) return '';
  let drift = `~${Math.round(skewSeconds)} seconds`;
  if (skewSeconds >= 120) drift = `~${Math.round(skewSeconds / 60)} minutes`;
  return ` Your Mac's clock is off by ${drift} from Apple's, which makes the signed token read as expired - run \`sudo sntp -sS time.apple.com\` to resync, then retry.`;
};

const describeAscError = (error: AscError): string => {
  let message = error.detail;
  if (message === undefined) message = error.title;
  if (message === undefined) message = error.code;
  if (message === undefined) message = 'unknown App Store Connect error';
  const associated = describeAssociatedErrors(error.meta?.associatedErrors);
  if (associated.length > 0) return `${message}; ${associated.join('; ')}`;
  return message;
};

const describeAssociatedErrors = (
  associatedErrors: Record<string, readonly AscError[]> | undefined,
): string[] => {
  if (!associatedErrors) return [];
  return Object.entries(associatedErrors).flatMap(([resource, errors]) =>
    errors.map((error) => `associated ${resource}: ${describeAscError(error)}`),
  );
};

export const describeErrors = (responseText: string): string => {
  const decodedDocument = Schema.decodeUnknownOption(AscErrorsDocumentSchema)(responseText);
  if (Option.isSome(decodedDocument) && decodedDocument.value.errors?.length) {
    return decodedDocument.value.errors.map(describeAscError).join('; ');
  }
  if (responseText.length > 0) return responseText;
  return 'no response body';
};

export const parseErrorCodes = (responseText: string): string[] => {
  const decodedDocument = Schema.decodeUnknownOption(AscErrorsDocumentSchema)(responseText);
  if (Option.isNone(decodedDocument)) return [];
  if (decodedDocument.value.errors === undefined) return [];
  return decodedDocument.value.errors
    .map((error) => error.code)
    .filter((errorCode): errorCode is string => errorCode !== undefined);
};

const md5Hex = (bytes: Buffer): string => createHash('md5').update(bytes).digest('hex');

export const readTransportFile = (filePath: string): Promise<Buffer> => readFile(filePath);

export const readTransportSize = async (filePath: string): Promise<number> => {
  const fileInfo = await stat(filePath);
  return Number(fileInfo.size);
};

const readTransportRange = async (
  filePath: string,
  offset: number,
  byteCount: number,
): Promise<Buffer> => {
  const fileHandle = await open(filePath, 'r');
  let rangeBuffer: Buffer;
  try {
    const rangeTarget = Buffer.alloc(byteCount);
    const { bytesRead } = await fileHandle.read(rangeTarget, 0, byteCount, offset);
    rangeBuffer = rangeTarget.subarray(0, bytesRead);
  } finally {
    await fileHandle.close();
  }
  if (rangeBuffer.byteLength === byteCount) return rangeBuffer;
  throw new Error(
    `Read ${rangeBuffer.byteLength} of ${byteCount} bytes at offset ${offset} from ${filePath}; the file changed during the upload.`,
  );
};

const base64UrlJson = (jsonPart: object): string =>
  Buffer.from(JSON.stringify(jsonPart)).toString('base64url');

const mintToken = (key: AscKey, issuedAt: number): string => {
  const header = base64UrlJson({ alg: 'ES256', kid: key.keyId, typ: 'JWT' });
  const claims = base64UrlJson({
    iss: key.issuerId,
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
    aud: AUDIENCE,
  });
  const signingInput = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(key.p8),
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${signature.toString('base64url')}`;
};

const tokenCacheKey = (key: AscKey): string => `${key.issuerId}:${key.keyId}`;

const forgetToken = (key: AscKey): void => {
  mintedTokens.delete(tokenCacheKey(key));
};

// Reuse a key's token until TOKEN_REUSE_SECONDS, so a long sync signs once instead of per request.
const reusableToken = (key: AscKey): string => {
  const tokenKey = tokenCacheKey(key);
  const currentSeconds = Math.floor(Date.now() / 1000);
  const mintedToken = mintedTokens.get(tokenKey);
  if (
    mintedToken !== undefined &&
    currentSeconds >= mintedToken.issuedAt &&
    currentSeconds - mintedToken.issuedAt < TOKEN_REUSE_SECONDS
  ) {
    return mintedToken.token;
  }
  const token = mintToken(key, currentSeconds);
  mintedTokens.set(tokenKey, { token, issuedAt: currentSeconds });
  return token;
};

const putAssetChunk = async (
  operation: UploadOperation,
  filePath: string,
  fileByteLength: number,
): Promise<void> => {
  let offset = operation.offset;
  if (offset === undefined) offset = 0;
  let operationLength = operation.length;
  if (operationLength === undefined) operationLength = fileByteLength - offset;
  const chunk = await readTransportRange(filePath, offset, operationLength);
  const headers: Record<string, string> = {};
  let requestHeaders = operation.requestHeaders;
  if (requestHeaders === undefined) requestHeaders = [];
  for (const header of requestHeaders) {
    if (header.name && header.value !== undefined) headers[header.name] = header.value;
  }
  let requestMethod = operation.method;
  if (requestMethod === undefined) requestMethod = 'PUT';
  await retryAppleTransportRequest(
    async () => {
      const appleResponse = await fetch(operation.url, {
        method: requestMethod,
        headers,
        body: chunk as Uint8Array<ArrayBuffer>,
      });
      if (!appleResponse.ok) {
        throw makeAscRequestError(
          `asset upload chunk failed (${appleResponse.status})`,
          appleResponse.status,
        );
      }
    },
    { isRetryableFailure: isRetryableIdempotentFailure },
  );
};

// Sends a reserved asset's file to Apple's CDN, reading only the few byte-range parts in flight.
export const putAssetFile = async (
  operations: readonly UploadOperation[],
  filePath: string,
  fileByteLength: number,
): Promise<void> => {
  for (let batchStart = 0; batchStart < operations.length; batchStart += ASSET_UPLOAD_CONCURRENCY) {
    const operationBatch = operations.slice(batchStart, batchStart + ASSET_UPLOAD_CONCURRENCY);
    const chunkUploads = operationBatch.map((operation) =>
      putAssetChunk(operation, filePath, fileByteLength),
    );
    // biome-ignore lint/performance/noAwaitInLoops: bounded batches - each part is its own byte range, so a batch uploads in parallel without flooding Apple's CDN
    const settledChunkUploads = await Promise.allSettled(chunkUploads);
    const failedChunkUpload = settledChunkUploads.find(
      (chunkUpload): chunkUpload is PromiseRejectedResult => chunkUpload.status === 'rejected',
    );
    if (failedChunkUpload !== undefined) throw failedChunkUpload.reason;
  }
};

export const makeAppStoreConnectRequests = (
  key: AscKey,
  operatingSystem: NodeJS.Platform = detectOperatingSystem(),
) => {
  const token = async (): Promise<string> => reusableToken(key);

  // A single (un-retried) authenticated request; `pathOrUrl` is relative to the `/v1` base or an absolute URL such as Apple's `links.next`.
  const sendOnce = async <Resource>(
    method: string,
    pathOrUrl: string,
    requestDocument?: unknown,
  ): Promise<Resource> => {
    let url = pathOrUrl;
    if (!pathOrUrl.startsWith('http')) url = `${APP_STORE_CONNECT_BASE_URL}${pathOrUrl}`;
    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${await token()}`,
    };
    const requestInit: RequestInit = { method, headers: requestHeaders };
    if (requestDocument !== undefined) {
      requestHeaders['Content-Type'] = 'application/json';
      requestInit.body = JSON.stringify(requestDocument);
    }
    const appleResponse = await fetch(url, requestInit);
    if (appleResponse.status === 204) return undefined as Resource;
    const responseText = await appleResponse.text();
    if (!appleResponse.ok) {
      // A skewed local clock is the sneaky cause of a 401; Apple's `Date` header is the authoritative reference.
      let clockHint = '';
      if (appleResponse.status === 401)
        clockHint = clockSkewHint({
          appleDate: appleResponse.headers.get('date'),
          nowMs: Date.now(),
          platform: operatingSystem,
        });
      throw makeAscRequestError(
        `App Store Connect ${method} ${pathOrUrl} failed (${appleResponse.status}): ${describeErrors(responseText)}${clockHint}`,
        appleResponse.status,
        parseErrorCodes(responseText),
      );
    }
    return JSON.parse(responseText) as Resource;
  };

  const request = async <Resource>(
    method: string,
    pathOrUrl: string,
    requestDocument?: unknown,
  ): Promise<Resource> => {
    // A write that lost its connection may already have landed, so only a GET retries one.
    let isRetryableFailure = isRetryableAscError;
    if (method === 'GET') isRetryableFailure = isRetryableIdempotentFailure;
    const requestWithBackoff = () =>
      retryAppleTransportRequest(() => sendOnce<Resource>(method, pathOrUrl, requestDocument), {
        isRetryableFailure,
      });
    try {
      return await requestWithBackoff();
    } catch (requestFailure) {
      if (!isRejectedToken(requestFailure)) throw requestFailure;
      forgetToken(key);
      return requestWithBackoff();
    }
  };

  const v2 = (path: string): string => `${APP_STORE_CONNECT_ORIGIN}/v2${path}`;

  // Reading only the first page silently truncates large collections, so every "list all" call follows `links.next`.
  const requestPages = async <Page extends { links?: { next?: string } }>(
    path: string,
  ): Promise<Page[]> => {
    const pages: Page[] = [];
    let next: string | undefined = path;
    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page's `next` link comes from the prior response, so the reads are inherently sequential
      const page: Page = await request<Page>('GET', next);
      pages.push(page);
      next = page.links?.next;
    }
    return pages;
  };

  const requestAll = async <Attributes>(path: string): Promise<AppleResource<Attributes>[]> => {
    const pages = await requestPages<PagedList<Attributes>>(path);
    return pages.flatMap((page) => page.data);
  };

  // Apple returns 404 for an absent optional record; this is the one place "404 means absent, anything else is a real failure" lives.
  const getOptional = async <Resource>(load: () => Promise<Resource>): Promise<Resource | null> => {
    try {
      return await load();
    } catch (error) {
      if (isAscRequestError(error) && error.status === 404) return null;
      throw error;
    }
  };

  const createResource = async <Attributes = unknown>(
    path: string,
    member: {
      type: string;
      attributes?: object;
      relationships?: object;
    },
  ): Promise<{
    id: string;
    attributes: Attributes;
  }> => {
    const { data: createdResource } = await request<ResourceSingle<Attributes>>('POST', path, {
      data: member,
    });
    return createdResource;
  };

  // Apple's update responses are ignored; callers re-read when they need the new state.
  const updateResource = async (
    path: string,
    member: {
      type: string;
      id: string;
      attributes: object;
    },
  ): Promise<void> => {
    await request<unknown>('PATCH', path, { data: member });
  };

  const deleteResource = async (path: string): Promise<void> => {
    await request<unknown>('DELETE', path);
  };

  const assertReady = async (): Promise<void> => {
    await request<ResourceList<unknown>>('GET', '/bundleIds?limit=1');
  };

  const checkRequiredAgreements = async (): Promise<boolean> => {
    try {
      await request<ResourceList<unknown>>('GET', '/bundleIds?limit=1');
      return true;
    } catch (error) {
      if (
        isAscRequestError(error) &&
        error.status === 403 &&
        error.codes.some((code) => code.includes(REQUIRED_AGREEMENTS_ERROR_CODE))
      ) {
        return false;
      }
      throw error;
    }
  };

  // The bundle-id `seedId` is the only team identifier an API key exposes.
  const resolveTeamId = async (): Promise<string | null> => {
    const { data: bundleIdResources } = await request<
      ResourceList<{
        seedId?: string;
      }>
    >('GET', '/bundleIds?limit=1&fields[bundleIds]=seedId');
    const bundleIdResource = bundleIdResources[0];
    if (bundleIdResource === undefined) return null;
    const teamId = bundleIdResource.attributes.seedId;
    if (teamId === undefined) return null;
    return teamId;
  };

  const reserveAsset = async (
    type: string,
    parent: { relationship: string; type: string; id: string },
    fileName: string,
    fileSize: number,
    assetAttributes: Record<string, string> = {},
  ): Promise<{
    id: string;
    operations: UploadOperation[];
  }> => {
    const reservation = await request<AssetReservation>('POST', `/${type}`, {
      data: {
        type,
        attributes: { fileName, fileSize, ...assetAttributes },
        relationships: { [parent.relationship]: { data: { type: parent.type, id: parent.id } } },
      },
    });
    let operations = reservation.data.attributes.uploadOperations;
    if (operations === undefined) operations = [];
    return { id: reservation.data.id, operations };
  };

  // Commit a reserved asset once its bytes are uploaded: PATCH `uploaded:true` plus the MD5 Apple verifies.
  const commitAsset = async (type: string, id: string, bytes: Buffer): Promise<void> => {
    await request<unknown>('PATCH', `/${type}/${id}`, {
      data: { type, id, attributes: { uploaded: true, sourceFileChecksum: md5Hex(bytes) } },
    });
  };

  return {
    request,
    requestAll,
    requestPages,
    getOptional,
    createResource,
    updateResource,
    deleteResource,
    v2,
    token,
    assertReady,
    checkRequiredAgreements,
    resolveTeamId,
    reserveAsset,
    commitAsset,
  };
};

export type AppStoreConnectRequests = ReturnType<typeof makeAppStoreConnectRequests>;
