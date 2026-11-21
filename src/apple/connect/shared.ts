import type { AscKey } from '@/core/types/credentials.js';
import type { MutableDeep } from '@/core/types/mutable.js';
import type { components } from '@/apple/generated/schema.js';
import { Chunk, Data, Effect, Option, Schema, Stream } from 'effect';
import { FileSystem } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { SignJWT, importPKCS8 } from 'jose';
import { createHash } from 'node:crypto';
import { makeStoreUploadFailure } from '@/core/types/providers.js';
import { retryAppleTransportRequest } from '@/apple/transportHelpers.js';
import {
  type AccessibilityDeclarationResource,
  type AccessibilitySupport,
  type AnalyticsReportRequestResource,
  type AppEventLocalizationResource,
  type AppEventResource,
  type AppStoreVersionResource,
  type BetaFeedbackSubmissionResource,
  type BuildResource,
  type BuildUploadProblem,
  type CustomerReviewResponseResource,
  type DeviceFamily,
  type PhasedReleaseResource,
  type PricePointResource,
  ACCESSIBILITY_SUPPORT_KEYS,
} from '@/core/types/appleCatalog.js';

export const API_ORIGIN = 'https://api.appstoreconnect.apple.com';
export const BASE_URL = `${API_ORIGIN}/v1`;
export const AUDIENCE = 'appstoreconnect-v1';

export const TOKEN_TTL_SECONDS = 19 * 60;
export const TOKEN_REUSE_SECONDS = 15 * 60;
export const mintedTokens = new Map<string, Readonly<{ token: string; issuedAt: number }>>();
export const ASSET_UPLOAD_CONCURRENCY = 4;

export const CLOCK_SKEW_TOLERANCE_SECONDS = 60;

export const DISTRIBUTION_CERT_TYPE = 'DISTRIBUTION';

export const APP_STORE_PROFILE_TYPE = 'IOS_APP_STORE';

export const AD_HOC_PROFILE_TYPE = 'IOS_APP_ADHOC';

export type ProvisioningProfileType = NonNullable<
  NonNullable<components['schemas']['Profile']['attributes']>['profileType']
>;

export const REQUIRED_AGREEMENTS_ERROR_CODE = 'REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED';

export const IOS_DEVICE_PLATFORM = 'IOS';

export const EDITABLE_VERSION_STATES = new Set<string>([
  'PREPARE_FOR_SUBMISSION',
  'METADATA_REJECTED',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'INVALID_BINARY',
]);

export const EDITABLE_APPINFO_STATES = new Set<string>([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
]);

export const LIVE_STATES = new Set<string>([
  'READY_FOR_DISTRIBUTION',
  'READY_FOR_SALE',
  'PREORDER_READY_FOR_SALE',
]);

export const APP_INFO_LISTING_FIELDS = ['name', 'subtitle', 'privacyPolicyUrl'] as const;

export const VERSION_LISTING_FIELDS = [
  'description',
  'keywords',
  'whatsNew',
  'promotionalText',
  'supportUrl',
  'marketingUrl',
] as const;

export type AscError = {
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

export interface VersionedLocalizationResources {
  versionsUrl: (parentId: string) => string;
  versionType: string;
  parentRelationship: string;
  parentType: string;
  localizationType: string;
}

export interface ProductVersion {
  id: string;
  attributes: { state?: string; version?: number };
}

export interface LocaleCopy {
  locale: string;
  name: string;
  description?: string | undefined;
}
export const IN_APP_PURCHASE_VERSION_RESOURCES: VersionedLocalizationResources = {
  versionsUrl: (parentId) => `${API_ORIGIN}/v2/inAppPurchases/${parentId}/versions`,
  versionType: 'inAppPurchaseVersions',
  parentRelationship: 'inAppPurchase',
  parentType: 'inAppPurchases',
  localizationType: 'inAppPurchaseLocalizations',
};
export const SUBSCRIPTION_VERSION_RESOURCES: VersionedLocalizationResources = {
  versionsUrl: (parentId) => `${BASE_URL}/subscriptions/${parentId}/versions`,
  versionType: 'subscriptionVersions',
  parentRelationship: 'subscription',
  parentType: 'subscriptions',
  localizationType: 'subscriptionLocalizations',
};
export const SUBSCRIPTION_GROUP_VERSION_RESOURCES: VersionedLocalizationResources = {
  versionsUrl: (parentId) => `${BASE_URL}/subscriptionGroups/${parentId}/versions`,
  versionType: 'subscriptionGroupVersions',
  parentRelationship: 'subscriptionGroup',
  parentType: 'subscriptionGroups',
  localizationType: 'subscriptionGroupLocalizations',
};

export const pickDraftVersion = (versions: ProductVersion[]): ProductVersion | null =>
  versions.find((version) => version.attributes.state === 'PREPARE_FOR_SUBMISSION') ?? null;

export const pickNewestVersion = (versions: ProductVersion[]): ProductVersion | null => {
  const versionsNewestFirst = [...versions].sort(
    (firstVersion, secondVersion) =>
      (secondVersion.attributes.version ?? 0) - (firstVersion.attributes.version ?? 0),
  );
  const [newestVersion] = versionsNewestFirst;

  const hasNoVersion = newestVersion == null;
  if (hasNoVersion) return null;
  return newestVersion;
};

export const AscErrorSchema: Schema.Schema<AscError> = Schema.suspend(() =>
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
export const AscErrorsDocumentSchema = Schema.parseJson(
  Schema.Struct({ errors: Schema.optionalWith(Schema.Array(AscErrorSchema), { exact: true }) }),
);

export class AscRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codes: readonly string[] = [],
  ) {
    super(message);
    this.name = 'AscRequestError';
  }
}

export class AscAvailabilityUpdateError extends Data.TaggedError('AscAvailabilityUpdateError')<{
  readonly message: string;
  readonly missingTerritories: readonly string[];
}> {}

export const isRetryableAscError = (error: unknown): boolean => {
  if (!(error instanceof AscRequestError)) return false;
  if (error.status === 429) return true;
  return error.status >= 500;
};

export const isRejectedToken = (requestFailure: unknown): boolean =>
  requestFailure instanceof AscRequestError && requestFailure.status === 401;

export const isRetryableIdempotentFailure = (requestFailure: unknown): boolean => {
  if (requestFailure instanceof TypeError) return true;
  return isRetryableAscError(requestFailure);
};

export type AccessibilityDeclarationAttributes = AccessibilitySupport & {
  deviceFamily?: DeviceFamily;
  state?: AccessibilityDeclarationResource['state'];
};

export type AppEventAttributes = {
  referenceName?: string;
  badge?: string | null;
  eventState?: string;
  primaryLocale?: string | null;
  deepLink?: string | null;
  priority?: string | null;
  purpose?: string | null;
};

export type AppEventLocalizationAttributes = {
  locale?: string;
  name?: string | null;
  shortDescription?: string | null;
  longDescription?: string | null;
};
export type ResourceList<A> = {
  data: {
    id: string;
    attributes: A;
  }[];
};
export type AppInfoStates = {
  state?: string;
  appStoreState?: string;
};
export type VersionStates = {
  appStoreState: string;
};

export const findAppInfoId = (
  appInfos: ResourceList<AppInfoStates>['data'],
  states: ReadonlySet<string>,
): string | null => {
  const appInformation = appInfos.find((candidate) => {
    let state = candidate.attributes.state;
    if (state === undefined) state = candidate.attributes.appStoreState;
    return state !== undefined && states.has(state);
  });
  if (appInformation === undefined) return null;
  return appInformation.id;
};

export const findVersionId = (
  versions: ResourceList<VersionStates>['data'],
  states: ReadonlySet<string>,
): string | null => {
  const version = versions.find((candidate) => states.has(candidate.attributes.appStoreState));
  if (version === undefined) return null;
  return version.id;
};
export type ResourceSingle<A> = {
  data: {
    id: string;
    attributes: A;
  };
};

export type AppleResource<Attributes> = {
  id: string;
  attributes: Attributes;
  relationships?: { build?: { data?: { id: string } | null } };
};

export type PagedList<A> = {
  data: AppleResource<A>[];
  links?: {
    next?: string;
  };
};

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

// Apple 409s an inline-created included resource (ENTITY_ERROR.INCLUDED.INVALID_ID) unless its id is
// a local id written as ${local-id}; the relationship references the same string.
export const inlinePriceId = (index: number): string => `\${price-${index}}`;
export const md5Hex = (bytes: Buffer): string => {
  return createHash('md5').update(bytes).digest('hex');
};
export const readTransportFile = (filePath: string): Promise<Buffer> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const fileBytes = yield* fileSystem.readFile(filePath);
    return Buffer.from(fileBytes);
  }).pipe(Effect.provide(NodeContext.layer), Effect.runPromise);
export const readTransportSize = (filePath: string): Promise<number> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* fileSystem.stat(filePath);
    return Number(fileInfo.size);
  }).pipe(Effect.provide(NodeContext.layer), Effect.runPromise);
export const readTransportRange = (
  filePath: string,
  offset: number,
  byteCount: number,
): Promise<Buffer> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const rangeStream = fileSystem.stream(filePath, { offset, bytesToRead: byteCount });
    const rangeChunks = yield* Stream.runCollect(rangeStream);
    const rangeParts = Chunk.toReadonlyArray(rangeChunks);
    const rangeBuffer = Buffer.concat(rangeParts);
    if (rangeBuffer.byteLength === byteCount) return rangeBuffer;
    return yield* Effect.fail(
      makeStoreUploadFailure({
        provider: 'app-store-connect',
        message: `Read ${rangeBuffer.byteLength} of ${byteCount} bytes at offset ${offset} from ${filePath}; the file changed during the upload.`,
      }),
    );
  }).pipe(Effect.provide(NodeContext.layer), Effect.runPromise);

export const pickListingFields = (
  attributes: Record<string, unknown>,
  keys: readonly string[],
): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const key of keys) {
    const fieldValue = attributes[key];
    if (typeof fieldValue === 'string' && fieldValue.length > 0) fields[key] = fieldValue;
  }
  return fields;
};

export const pickAccessibilitySupport = (
  attributes: Partial<AccessibilitySupport>,
): AccessibilitySupport => {
  const support: MutableDeep<AccessibilitySupport> = {};
  for (const key of ACCESSIBILITY_SUPPORT_KEYS) {
    const fieldValue = attributes[key];
    if (typeof fieldValue === 'boolean') support[key] = fieldValue;
  }
  return support;
};

export type CustomerReviewPage = {
  data: {
    id: string;
    attributes: {
      rating?: number;
      title?: string;
      body?: string;
      reviewerNickname?: string;
      territory?: string;
      createdDate?: string;
    };
    relationships?: {
      response?: {
        data?: {
          id: string;
        } | null;
      };
    };
  }[];
  links?: {
    next?: string;
  };
};

export type BetaFeedbackPage = {
  data: {
    id: string;
    attributes?: {
      createdDate?: string;
      comment?: string | null;
      email?: string | null;
      deviceModel?: string | null;
      osVersion?: string | null;
      screenshots?: {
        url?: string;
        width?: number;
        height?: number;
      }[];
    };
    relationships?: {
      build?: {
        data?: {
          id: string;
        } | null;
      };
    };
  }[];
  included?: {
    type: string;
    id: string;
    attributes?: {
      version?: string;
    };
  }[];
  links?: {
    next?: string;
  };
};
export const BUILD_PAGE_QUERY =
  'fields[builds]=version,processingState,uploadedDate,expired,preReleaseVersion&include=preReleaseVersion&fields[preReleaseVersions]=version';
export const createMarketingVersionFilter = (marketingVersion: string | undefined): string => {
  const isMarketingVersionGiven = marketingVersion !== undefined;
  if (!isMarketingVersionGiven) return '';
  return `&filter[preReleaseVersion.version]=${marketingVersion}`;
};
export type BuildPageIncluded = {
  type: string;
  id: string;
  attributes?: {
    version?: string;
    processingState?: string;
  };
};
export type AppStoreVersionPage = PagedList<{
  versionString?: string;
  appStoreState?: string;
  releaseType?: string;
}> & {
  included?: BuildPageIncluded[];
};
export type BuildPage = {
  data: {
    id: string;
    attributes: {
      version?: string;
      processingState?: string;
      uploadedDate?: string;
      expired?: boolean;
    };
    relationships?: {
      preReleaseVersion?: {
        data?: {
          id: string;
        } | null;
      };
    };
  }[];
  included?: BuildPageIncluded[];
};

export type BetaFeedbackRow = {
  base: BetaFeedbackSubmissionResource;
  screenshots: {
    url: string;
    width?: number;
    height?: number;
  }[];
};

export type TerritoryAvailabilityRow = {
  id: string;
  attributes?: {
    available?: boolean;
  };
  relationships?: {
    territory?: {
      data?: {
        id: string;
      } | null;
    };
  };
};

export type TerritoryAvailabilityPage = {
  data: TerritoryAvailabilityRow[];
  links?: {
    next?: string;
  };
};

export const TERRITORY_AVAILABILITY_UPDATE_CONCURRENCY = 8;

export type PromotedPurchasePage = {
  data: {
    id: string;
    attributes?: {
      enabled?: boolean;
      visibleForAllUsers?: boolean;
    };
    relationships?: {
      inAppPurchaseV2?: {
        data?: {
          id: string;
        } | null;
      };
      subscription?: {
        data?: {
          id: string;
        } | null;
      };
    };
  }[];
  links?: {
    next?: string;
  };
};

export type AppClipExperiencePage = {
  data: {
    id: string;
    attributes?: {
      action?: string;
    };
    relationships?: {
      releaseWithAppStoreVersion?: {
        data?: {
          id: string;
        } | null;
      };
    };
  }[];
  links?: {
    next?: string;
  };
};

export const EDITABLE_METADATA_STATES = new Set<string>([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
]);

export const mintToken = async (key: AscKey, issuedAt: number): Promise<string> => {
  const privateKey = await importPKCS8(key.p8, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: key.keyId, typ: 'JWT' })
    .setIssuer(key.issuerId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + TOKEN_TTL_SECONDS)
    .setAudience(AUDIENCE)
    .sign(privateKey);
};

export const tokenCacheKey = (key: AscKey): string => `${key.issuerId}:${key.keyId}`;

export const forgetToken = (key: AscKey): void => {
  const tokenKey = tokenCacheKey(key);
  mintedTokens.delete(tokenKey);
};

export const reusableToken = async (key: AscKey): Promise<string> => {
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
  const token = await mintToken(key, currentSeconds);
  mintedTokens.set(tokenKey, { token, issuedAt: currentSeconds });
  return token;
};

export const putAssetChunk = async (
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
        throw new AscRequestError(
          `asset upload chunk failed (${appleResponse.status})`,
          appleResponse.status,
        );
      }
    },
    { isRetryableFailure: isRetryableIdempotentFailure },
  );
};

export const buildUploadProblems = (
  stateDetails: readonly components['schemas']['StateDetail'][] | undefined,
): BuildUploadProblem[] => {
  if (stateDetails === undefined) return [];
  return stateDetails.map((stateDetail) => {
    let code = stateDetail.code;
    if (code === undefined) code = '';
    let description = stateDetail.description;
    if (description === undefined) description = '';
    return { code, description };
  });
};

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
    if (failedChunkUpload !== undefined) return Promise.reject(failedChunkUpload.reason);
  }
};

export interface AppleAppSummary {
  id: string;
  name: string;
  bundleId: string | null;
}

export const readNonEmptyAttribute = (attribute: string | undefined): string | null => {
  const isAttributePresent = typeof attribute === 'string' && attribute.length > 0;
  if (isAttributePresent) return attribute;
  return null;
};

export const summarizeAppleApp = (appleResource: {
  id: string;
  attributes: { name?: string; bundleId?: string };
}): AppleAppSummary => {
  const name = readNonEmptyAttribute(appleResource.attributes.name);
  const bundleId = readNonEmptyAttribute(appleResource.attributes.bundleId);
  const isNameMissing = name === null;
  if (isNameMissing) return { id: appleResource.id, name: appleResource.id, bundleId };
  return { id: appleResource.id, name, bundleId };
};

export const toBuildResource = (
  entry: BuildPage['data'][number],
  preReleaseVersions: readonly BuildPageIncluded[],
): BuildResource => {
  let version = entry.attributes.version;
  if (version === undefined) version = '';
  let processingState = entry.attributes.processingState;
  if (processingState === undefined) processingState = '';
  let expired = entry.attributes.expired;
  if (expired === undefined) expired = false;
  const buildResource: BuildResource = {
    id: entry.id,
    version,
    processingState,
    expired,
  };
  if (entry.attributes.uploadedDate !== undefined)
    Object.assign(buildResource, { uploadedDate: entry.attributes.uploadedDate });
  const preReleaseVersionId = entry.relationships?.preReleaseVersion?.data?.id;
  const preReleaseVersion = preReleaseVersions.find(
    (includedResource) =>
      includedResource.type === 'preReleaseVersions' && includedResource.id === preReleaseVersionId,
  );
  const marketingVersion = preReleaseVersion?.attributes?.version;
  if (marketingVersion !== undefined) Object.assign(buildResource, { marketingVersion });
  return buildResource;
};
export const toBuildResources = ({ data: builds, included = [] }: BuildPage): BuildResource[] =>
  builds.map((entry) => toBuildResource(entry, included));

export const toVersionResource = (
  entry: AppleResource<{
    versionString?: string;
    appStoreState?: string;
    releaseType?: string;
  }>,
  fallbackVersion = '',
  includedBuilds: readonly BuildPageIncluded[] = [],
): AppStoreVersionResource => {
  let versionString = entry.attributes.versionString;
  if (versionString === undefined) versionString = fallbackVersion;
  let appStoreState = entry.attributes.appStoreState;
  if (appStoreState === undefined) appStoreState = '';
  const releaseType = entry.attributes.releaseType;
  const attachedBuildId = entry.relationships?.build?.data?.id;
  const isBuildAttached = attachedBuildId !== undefined;
  const attachedBuild = includedBuilds.find(
    (includedBuild) => includedBuild.type === 'builds' && includedBuild.id === attachedBuildId,
  );
  const attachedBuildNumber = attachedBuild?.attributes?.version;
  const attachedBuildProcessingState = attachedBuild?.attributes?.processingState;
  const version: AppStoreVersionResource = {
    id: entry.id,
    versionString,
    appStoreState,
    ...(releaseType !== undefined && { releaseType }),
    ...(isBuildAttached && { attachedBuildId }),
    ...(attachedBuildNumber !== undefined && { attachedBuildNumber }),
    ...(attachedBuildProcessingState !== undefined && { attachedBuildProcessingState }),
  };
  return version;
};

export const toPhasedRelease = (entry: {
  id: string;
  attributes: {
    phasedReleaseState?: string;
    currentDayNumber?: number;
  };
}): PhasedReleaseResource => {
  let phasedReleaseState = entry.attributes.phasedReleaseState;
  if (phasedReleaseState === undefined) phasedReleaseState = '';
  const phasedRelease: PhasedReleaseResource = {
    id: entry.id,
    phasedReleaseState,
  };
  if (entry.attributes.currentDayNumber !== undefined)
    Object.assign(phasedRelease, { currentDayNumber: entry.attributes.currentDayNumber });
  return phasedRelease;
};

export const matchPricePoint = (
  points: {
    id: string;
    attributes: {
      customerPrice?: string;
      territory?: string;
    };
  }[],
  territory: string,
  customerPrice: number,
): PricePointResource | null => {
  for (const point of points) {
    const price = point.attributes.customerPrice;
    if (price !== undefined && Number.parseFloat(price) === customerPrice) {
      let priceTerritory = point.attributes.territory;
      if (priceTerritory === undefined) priceTerritory = territory;
      return {
        id: point.id,
        customerPrice: price,
        territory: priceTerritory,
      };
    }
  }
  return null;
};

export const toFeedbackScreenshots = (
  raw:
    | {
        url?: string;
        width?: number;
        height?: number;
      }[]
    | undefined,
): {
  url: string;
  width?: number;
  height?: number;
}[] => {
  if (!raw) return [];
  return raw.flatMap((screenshot) => {
    const screenshotUrl = screenshot.url;
    if (screenshotUrl === undefined) return [];
    const feedbackScreenshot: { url: string; width?: number; height?: number } = {
      url: screenshotUrl,
    };
    if (screenshot.width !== undefined)
      Object.assign(feedbackScreenshot, { width: screenshot.width });
    if (screenshot.height !== undefined)
      Object.assign(feedbackScreenshot, { height: screenshot.height });
    return [feedbackScreenshot];
  });
};

export const toReviewResponse = (appleResources: {
  id: string;
  attributes: {
    responseBody?: string;
    state?: string;
    lastModifiedDate?: string;
  };
}): CustomerReviewResponseResource => {
  let responseBody = appleResources.attributes.responseBody;
  if (responseBody === undefined) responseBody = '';
  const reviewResponse: CustomerReviewResponseResource = {
    id: appleResources.id,
    responseBody,
  };
  if (appleResources.attributes.state !== undefined)
    Object.assign(reviewResponse, { state: appleResources.attributes.state });
  if (appleResources.attributes.lastModifiedDate !== undefined)
    Object.assign(reviewResponse, { lastModifiedDate: appleResources.attributes.lastModifiedDate });
  return reviewResponse;
};

export const toAppEvent = (
  appleEvent: {
    id: string;
    attributes: AppEventAttributes;
  },
  fallbackReferenceName: string,
): AppEventResource => {
  let referenceName = appleEvent.attributes.referenceName;
  if (referenceName === undefined) referenceName = fallbackReferenceName;
  const appEvent: AppEventResource = { id: appleEvent.id, referenceName };
  if (typeof appleEvent.attributes.badge === 'string')
    Object.assign(appEvent, { badge: appleEvent.attributes.badge });
  if (appleEvent.attributes.eventState !== undefined)
    Object.assign(appEvent, { eventState: appleEvent.attributes.eventState });
  if (typeof appleEvent.attributes.primaryLocale === 'string')
    Object.assign(appEvent, { primaryLocale: appleEvent.attributes.primaryLocale });
  if (typeof appleEvent.attributes.deepLink === 'string')
    Object.assign(appEvent, { deepLink: appleEvent.attributes.deepLink });
  if (typeof appleEvent.attributes.priority === 'string')
    Object.assign(appEvent, { priority: appleEvent.attributes.priority });
  if (typeof appleEvent.attributes.purpose === 'string')
    Object.assign(appEvent, { purpose: appleEvent.attributes.purpose });
  return appEvent;
};

export const toAppEventLocalization = (
  appleResources: {
    id: string;
    attributes: AppEventLocalizationAttributes;
  },
  fallbackLocale: string,
): AppEventLocalizationResource => {
  let locale = appleResources.attributes.locale;
  if (locale === undefined) locale = fallbackLocale;
  const eventLocalization: AppEventLocalizationResource = {
    id: appleResources.id,
    locale,
  };
  if (typeof appleResources.attributes.name === 'string')
    Object.assign(eventLocalization, { name: appleResources.attributes.name });
  if (typeof appleResources.attributes.shortDescription === 'string')
    Object.assign(eventLocalization, {
      shortDescription: appleResources.attributes.shortDescription,
    });
  if (typeof appleResources.attributes.longDescription === 'string')
    Object.assign(eventLocalization, {
      longDescription: appleResources.attributes.longDescription,
    });
  return eventLocalization;
};

export const toReportRequest = (
  entry: {
    id: string;
    attributes: {
      accessType?: string;
      stoppedDueToInactivity?: boolean;
    };
  },
  fallbackAccessType: string,
): AnalyticsReportRequestResource => {
  let accessType = entry.attributes.accessType;
  if (accessType === undefined) accessType = fallbackAccessType;
  const reportRequest: AnalyticsReportRequestResource = {
    id: entry.id,
    accessType,
  };
  if (entry.attributes.stoppedDueToInactivity !== undefined)
    Object.assign(reportRequest, {
      stoppedDueToInactivity: entry.attributes.stoppedDueToInactivity,
    });
  return reportRequest;
};

export const clockSkewHint = (args: {
  appleDate: string | null;
  nowMs: number;
  platform: NodeJS.Platform;
}): string => {
  if (args.platform !== 'darwin') return '';
  if (args.appleDate === null) return '';
  const appleMs = Date.parse(args.appleDate);
  if (Number.isNaN(appleMs)) return '';
  const skewSeconds = Math.abs(args.nowMs - appleMs) / 1000;
  if (skewSeconds < CLOCK_SKEW_TOLERANCE_SECONDS) return '';
  let drift = `~${Math.round(skewSeconds)} seconds`;
  if (skewSeconds >= 120) drift = `~${Math.round(skewSeconds / 60)} minutes`;
  return ` Your Mac's clock is off by ${drift} from Apple's, which makes the signed token read as expired - run \`sudo sntp -sS time.apple.com\` to resync, then retry.`;
};

export const describeErrors = (responseText: string): string => {
  const decodedDocument = Schema.decodeUnknownOption(AscErrorsDocumentSchema)(responseText);
  if (Option.isSome(decodedDocument) && decodedDocument.value.errors?.length) {
    return decodedDocument.value.errors.map(describeAscError).join('; ');
  }
  if (responseText.length > 0) return responseText;
  return 'no response body';
};
export const describeAscError = (error: AscError): string => {
  let message = error.detail;
  if (message === undefined) message = error.title;
  if (message === undefined) message = error.code;
  if (message === undefined) message = 'unknown App Store Connect error';
  const associated = describeAssociatedErrors(error.meta?.associatedErrors);
  if (associated.length > 0) return `${message}; ${associated.join('; ')}`;
  return message;
};
export const describeAssociatedErrors = (
  associatedErrors: Record<string, readonly AscError[]> | undefined,
): string[] => {
  if (!associatedErrors) return [];
  return Object.entries(associatedErrors).flatMap(([resource, errors]) =>
    errors.map((error) => `associated ${resource}: ${describeAscError(error)}`),
  );
};

export const parseErrorCodes = (responseText: string): string[] => {
  const decodedDocument = Schema.decodeUnknownOption(AscErrorsDocumentSchema)(responseText);
  if (Option.isNone(decodedDocument)) return [];
  if (decodedDocument.value.errors === undefined) return [];
  return decodedDocument.value.errors
    .map((error) => error.code)
    .filter((errorCode): errorCode is string => errorCode !== undefined);
};
