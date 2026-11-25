// App Store Connect calls the launch commands use. One class, one key, fetch.

import { createHash, createSign } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

import type { StoreSnapshot } from '@/plan/plan-store.js';

const APPLE_API = 'https://api.appstoreconnect.apple.com/v1';
const APPLE_AUDIENCE = 'appstoreconnect-v1';
const APPLE_JSON = 'application/vnd.api+json';

export interface AppleKey {
  keyId: string;
  issuerId: string;
  privateKey: string;
}

export interface IosUpload {
  bundleId: string;
  version: string;
  buildNumber: number;
  ipaPath: string;
}

interface AppleDocument {
  data?: unknown;
}

interface AppleResource {
  id: string;
  attributes: Record<string, unknown>;
}

interface AppleUploadOperation {
  url: string;
  method: string | null;
  offset: number | null;
  length: number | null;
  requestHeaders: { name: string; value: string }[];
}

export class AppStoreConnect {
  constructor(private key: AppleKey) {}

  /**
   * Reads the store name and the editable version for one bundle id.
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps}
   */
  async readLive(bundleId: string): Promise<StoreSnapshot> {
    const app = await this.findApp(bundleId);
    const storeName = await this.readStoreName(app.id);
    const version = await this.readStoreVersion(app.id);
    const isStoreNameMissing = storeName == null;

    if (isStoreNameMissing) {
      return { name: app.name, version };
    }

    return { name: storeName, version };
  }

  /**
   * Writes the store name and the editable version from launch.config.ts.
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversions-_id_}
   */
  async writeLive(bundleId: string, desired: StoreSnapshot): Promise<void> {
    const app = await this.findApp(bundleId);
    await this.writeStoreName(app.id, desired.name);

    if (desired.version == null) {
      return;
    }

    await this.writeStoreVersion(app.id, desired.version);
  }

  /**
   * Opens a build upload, sends the IPA in the parts Apple reserves, and marks the file uploaded.
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-builduploads}
   */
  async uploadBuild(upload: IosUpload): Promise<void> {
    const app = await this.findApp(upload.bundleId);
    const created = await this.request('POST', '/buildUploads', {
      data: {
        type: 'buildUploads',
        attributes: {
          cfBundleShortVersionString: upload.version,
          cfBundleVersion: String(upload.buildNumber),
          platform: 'IOS',
        },
        relationships: { app: { data: { type: 'apps', id: app.id } } },
      },
    });
    const buildUpload = readCreatedResource(created);
    const fileSize = await fileByteLength(upload.ipaPath);
    const reserved = await this.request('POST', '/buildUploadFiles', {
      data: {
        type: 'buildUploadFiles',
        attributes: {
          fileName: basename(upload.ipaPath),
          fileSize,
          assetType: 'ASSET',
          uti: 'com.apple.ipa',
        },
        relationships: {
          buildUpload: { data: { type: 'buildUploads', id: buildUpload.id } },
        },
      },
    });
    const reservedFile = readCreatedResource(reserved);
    const operations = readUploadOperations(reservedFile);
    const isEmpty = operations.length === 0;

    if (isEmpty) {
      throw new Error('App Store Connect reserved the IPA but returned no upload parts.');
    }

    await putAssetChunks(operations, upload.ipaPath, fileSize);
    const checksum = await md5File(upload.ipaPath);
    await this.request('PATCH', `/buildUploadFiles/${reservedFile.id}`, {
      data: {
        type: 'buildUploadFiles',
        id: reservedFile.id,
        attributes: { uploaded: true, sourceFileChecksum: checksum },
      },
    });
  }

  /**
   * Sends the editable App Store version to App Review.
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissions}
   */
  async submit(bundleId: string): Promise<void> {
    const app = await this.findApp(bundleId);
    const version = await this.findEditableVersion(app.id);
    const isVersionMissing = version == null;

    if (isVersionMissing) {
      throw new Error(
        'No editable App Store version. Upload a build, then run launch release ios.',
      );
    }

    const created = await this.request('POST', '/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: 'IOS' },
        relationships: { app: { data: { type: 'apps', id: app.id } } },
      },
    });
    const submission = readCreatedResource(created);
    await this.request('POST', '/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
        },
      },
    });
    await this.request('PATCH', `/reviewSubmissions/${submission.id}`, {
      data: {
        type: 'reviewSubmissions',
        id: submission.id,
        attributes: { submitted: true },
      },
    });
  }

  private async findApp(bundleId: string): Promise<{ id: string; name: string }> {
    const path = `/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1&fields[apps]=name,bundleId`;
    const document = await this.request('GET', path);
    const app = readResourceList(document)[0];
    const isMissing = app == null;

    if (isMissing) {
      throw new Error(`No App Store Connect app for ${bundleId}.`);
    }

    const name = readAttribute(app, 'name');
    const isNameMissing = name == null;

    if (isNameMissing) {
      return { id: app.id, name: bundleId };
    }

    return { id: app.id, name };
  }

  private async readStoreName(appId: string): Promise<string | null> {
    const localization = await this.findStoreLocalization(appId);
    const isMissing = localization == null;

    if (isMissing) {
      return null;
    }

    return readAttribute(localization, 'name');
  }

  private async writeStoreName(appId: string, name: string): Promise<void> {
    const localization = await this.findStoreLocalization(appId);
    const isMissing = localization == null;

    if (isMissing) {
      throw new Error('No editable App Store name. Create the app listing, then run launch sync.');
    }

    await this.request('PATCH', `/appInfoLocalizations/${localization.id}`, {
      data: {
        type: 'appInfoLocalizations',
        id: localization.id,
        attributes: { name },
      },
    });
  }

  private async findStoreLocalization(appId: string): Promise<AppleResource | null> {
    const infos = await this.request(
      'GET',
      `/apps/${appId}/appInfos?limit=10&fields[appInfos]=state,appStoreState`,
    );
    const info = pickEditable(readResourceList(infos));
    const isInfoMissing = info == null;

    if (isInfoMissing) {
      return null;
    }

    const localizations = await this.request(
      'GET',
      `/appInfos/${info.id}/appInfoLocalizations?limit=20&fields[appInfoLocalizations]=name,locale`,
    );

    return pickEnglish(readResourceList(localizations));
  }

  private async readStoreVersion(appId: string): Promise<string | null> {
    const version = await this.findEditableVersion(appId);
    const isMissing = version == null;

    if (isMissing) {
      return null;
    }

    return readAttribute(version, 'versionString');
  }

  private async writeStoreVersion(appId: string, version: string): Promise<void> {
    const editable = await this.findEditableVersion(appId);
    const isMissing = editable == null;

    if (isMissing) {
      throw new Error('No editable App Store version. Create one, then run launch sync.');
    }

    await this.request('PATCH', `/appStoreVersions/${editable.id}`, {
      data: {
        type: 'appStoreVersions',
        id: editable.id,
        attributes: { versionString: version },
      },
    });
  }

  private async findEditableVersion(appId: string): Promise<AppleResource | null> {
    const document = await this.request(
      'GET',
      `/apps/${appId}/appStoreVersions?filter[appStoreState]=PREPARE_FOR_SUBMISSION&limit=1&fields[appStoreVersions]=versionString,appStoreState`,
    );
    const version = readResourceList(document)[0];
    const isMissing = version == null;

    if (isMissing) {
      return null;
    }

    return version;
  }

  private async request(method: string, path: string, document?: unknown): Promise<AppleDocument> {
    var appleDocument: AppleDocument;

    try {
      appleDocument = await this.requestOnce(method, path, document);
    } catch (error) {
      const isGet = method === 'GET';

      if (!isGet) {
        throw error;
      }

      const isAppleError = error instanceof AppleRequestError;

      if (!isAppleError) {
        throw error;
      }

      const shouldRetry = isTransientStatus(error.status);

      if (!shouldRetry) {
        throw error;
      }

      const retryDelayMilliseconds = 1000;
      await delay(retryDelayMilliseconds);

      return this.requestOnce(method, path, document);
    }

    return appleDocument;
  }

  private async requestOnce(
    method: string,
    path: string,
    document?: unknown,
  ): Promise<AppleDocument> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${signAppleToken(this.key)}`,
    };
    const init: RequestInit = { method, headers };
    const hasDocument = document != null;

    if (hasDocument) {
      headers['Content-Type'] = APPLE_JSON;
      init.body = JSON.stringify(document);
    }

    const isAbsolute = path.startsWith('http');
    let url = `${APPLE_API}${path}`;

    if (isAbsolute) {
      url = path;
    }

    var appleReply: Response;

    try {
      appleReply = await fetch(url, init);
    } catch (error) {
      throw new Error(`App Store Connect ${method} ${path} failed.`, { cause: error });
    }

    const isEmpty = appleReply.status === 204;

    if (isEmpty) {
      return {};
    }

    const replyText = await appleReply.text();
    const isOk = appleReply.ok;

    if (!isOk) {
      throw new AppleRequestError(
        appleFailure(method, path, appleReply.status, replyText),
        appleReply.status,
      );
    }

    return parseAppleDocument(replyText);
  }
}

export function signAppleToken(key: AppleKey): string {
  const header = base64Url(JSON.stringify({ alg: 'ES256', kid: key.keyId, typ: 'JWT' }));
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const tokenLifetimeSeconds = 20 * 60;
  const payload = base64Url(
    JSON.stringify({
      iss: key.issuerId,
      iat: issuedAtSeconds,
      exp: issuedAtSeconds + tokenLifetimeSeconds,
      aud: APPLE_AUDIENCE,
    }),
  );
  const tokenPrefix = `${header}.${payload}`;
  const signer = createSign('SHA256');

  // Apple requires this ES256 signature. The keychain item is the signing key, not a password hash.
  // codeql[js/insufficient-password-hash]
  signer.update(tokenPrefix);
  signer.end();
  const signature = signer.sign({ key: key.privateKey, dsaEncoding: 'ieee-p1363' });

  return `${tokenPrefix}.${base64Url(signature)}`;
}

class AppleRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AppleRequestError';
  }
}

function isTransientStatus(status: number): boolean {
  const isRateLimited = status === 429;

  if (isRateLimited) {
    return true;
  }

  return status >= 500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(function settle(resolve) {
    setTimeout(resolve, milliseconds);
  });
}

function base64Url(contents: string | Buffer): string {
  const isText = typeof contents === 'string';
  const buffer = isText ? Buffer.from(contents) : contents;

  return buffer.toString('base64url');
}

function parseAppleDocument(replyText: string): AppleDocument {
  var parsed: unknown;

  try {
    parsed = JSON.parse(replyText) as unknown;
  } catch (error) {
    throw new Error('App Store Connect returned invalid JSON.', { cause: error });
  }

  const isMissing = parsed == null;

  if (isMissing) {
    throw new Error('App Store Connect returned invalid JSON.');
  }

  const isNotObject = typeof parsed !== 'object';

  if (isNotObject) {
    throw new Error('App Store Connect returned invalid JSON.');
  }

  return parsed as AppleDocument;
}

function appleFailure(method: string, path: string, status: number, replyText: string): string {
  const detail = readAppleErrorDetail(replyText);
  const isMissing = detail == null;

  if (isMissing) {
    return `App Store Connect ${method} ${path} failed (${status}).`;
  }

  return `App Store Connect ${method} ${path} failed (${status}): ${detail}`;
}

function readAppleErrorDetail(replyText: string): string | null {
  var parsed: unknown;

  try {
    parsed = JSON.parse(replyText) as unknown;
  } catch (error) {
    const isError = error instanceof Error;

    if (isError) {
      return null;
    }

    return null;
  }

  const isMissing = parsed == null;

  if (isMissing) {
    return null;
  }

  const isNotObject = typeof parsed !== 'object';

  if (isNotObject) {
    return null;
  }

  const errors = (parsed as Record<string, unknown>)['errors'];
  const isArray = Array.isArray(errors);

  if (!isArray) {
    return null;
  }

  const first = errors[0] as unknown;
  const isFirstMissing = first == null;

  if (isFirstMissing) {
    return null;
  }

  const isFirstObject = typeof first === 'object';

  if (!isFirstObject) {
    return null;
  }

  const detail = (first as Record<string, unknown>)['detail'];
  const isDetail = typeof detail === 'string';

  if (!isDetail) {
    return null;
  }

  return detail;
}

function readResourceList(document: AppleDocument): AppleResource[] {
  const listed = document.data;
  const isArray = Array.isArray(listed);

  if (!isArray) {
    return [];
  }

  return listed.map(readResourceEntry);
}

function readCreatedResource(document: AppleDocument): AppleResource {
  const created = document.data;
  const isArray = Array.isArray(created);

  if (isArray) {
    const first = created[0];
    const isMissing = first == null;

    if (isMissing) {
      throw new Error('App Store Connect returned no resource.');
    }

    return readResourceEntry(first);
  }

  return readResourceEntry(document.data);
}

function readResourceEntry(entry: unknown): AppleResource {
  const isMissing = entry == null;

  if (isMissing) {
    throw new Error('App Store Connect returned no resource.');
  }

  const isNotObject = typeof entry !== 'object';

  if (isNotObject) {
    throw new Error('App Store Connect returned no resource.');
  }

  const record = entry as Record<string, unknown>;
  const id = record['id'];
  const isId = typeof id === 'string';

  if (!isId) {
    throw new Error('App Store Connect returned no resource id.');
  }

  const attributes = record['attributes'];
  const isAttributes = typeof attributes === 'object';

  if (!isAttributes) {
    return { id, attributes: {} };
  }

  const isAttributesNull = attributes == null;

  if (isAttributesNull) {
    return { id, attributes: {} };
  }

  return { id, attributes: attributes as Record<string, unknown> };
}

function readAttribute(resource: AppleResource, fieldName: string): string | null {
  const field = resource.attributes[fieldName];
  const isText = typeof field === 'string';

  if (!isText) {
    return null;
  }

  const isEmpty = field.length === 0;

  if (isEmpty) {
    return null;
  }

  return field;
}

function readUploadOperations(resource: AppleResource): AppleUploadOperation[] {
  const operations = resource.attributes['uploadOperations'];
  const isArray = Array.isArray(operations);

  if (!isArray) {
    return [];
  }

  return operations.map(readUploadOperation);
}

function readUploadOperation(entry: unknown): AppleUploadOperation {
  const isMissing = entry == null;

  if (isMissing) {
    throw new Error('App Store Connect returned an upload part with no URL.');
  }

  const isNotObject = typeof entry !== 'object';

  if (isNotObject) {
    throw new Error('App Store Connect returned an upload part with no URL.');
  }

  const record = entry as Record<string, unknown>;
  const url = record['url'];
  const isUrl = typeof url === 'string';

  if (!isUrl) {
    throw new Error('App Store Connect returned an upload part with no URL.');
  }

  return {
    url,
    method: readOptionalText(record['method']),
    offset: readOptionalNumber(record['offset']),
    length: readOptionalNumber(record['length']),
    requestHeaders: readHeaderList(record['requestHeaders']),
  };
}

function readOptionalText(candidate: unknown): string | null {
  const isText = typeof candidate === 'string';

  if (!isText) {
    return null;
  }

  return candidate;
}

function readOptionalNumber(candidate: unknown): number | null {
  const isNumber = typeof candidate === 'number';

  if (!isNumber) {
    return null;
  }

  return candidate;
}

function readHeaderList(candidate: unknown): { name: string; value: string }[] {
  const isArray = Array.isArray(candidate);

  if (!isArray) {
    return [];
  }

  const headers: { name: string; value: string }[] = [];

  for (const header of candidate) {
    const parsed = readHeader(header);
    const isMissing = parsed == null;

    if (isMissing) {
      continue;
    }

    headers.push(parsed);
  }

  return headers;
}

function readHeader(entry: unknown): { name: string; value: string } | null {
  const isMissing = entry == null;

  if (isMissing) {
    return null;
  }

  const isNotObject = typeof entry !== 'object';

  if (isNotObject) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const name = record['name'];
  const headerValue = record['value'];
  const isName = typeof name === 'string';

  if (!isName) {
    return null;
  }

  const isHeaderValue = typeof headerValue === 'string';

  if (!isHeaderValue) {
    return null;
  }

  return { name, value: headerValue };
}

function pickEditable(resources: readonly AppleResource[]): AppleResource | null {
  function isEditable(resource: AppleResource): boolean {
    const state = readAttribute(resource, 'state');
    const isPrepare = state === 'PREPARE_FOR_SUBMISSION';

    if (isPrepare) {
      return true;
    }

    const appStoreState = readAttribute(resource, 'appStoreState');

    return appStoreState === 'PREPARE_FOR_SUBMISSION';
  }

  const editable = resources.find(isEditable);
  const isMissing = editable == null;

  if (isMissing) {
    const first = resources[0];
    const isFirstMissing = first == null;

    if (isFirstMissing) {
      return null;
    }

    return first;
  }

  return editable;
}

function pickEnglish(resources: readonly AppleResource[]): AppleResource | null {
  function isEnglish(resource: AppleResource): boolean {
    return readAttribute(resource, 'locale') === 'en-US';
  }

  const english = resources.find(isEnglish);
  const isMissing = english == null;

  if (isMissing) {
    const first = resources[0];
    const isFirstMissing = first == null;

    if (isFirstMissing) {
      return null;
    }

    return first;
  }

  return english;
}

async function fileByteLength(filePath: string): Promise<number> {
  const fileStat = await stat(filePath);

  return fileStat.size;
}

async function md5File(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);

  return createHash('md5').update(bytes).digest('hex');
}

async function putAssetChunks(
  operations: readonly AppleUploadOperation[],
  ipaPath: string,
  fileSize: number,
): Promise<void> {
  const batchSize = 4;
  let batchStart = 0;

  await putNextBatch();

  async function putNextBatch(): Promise<void> {
    const isDone = batchStart >= operations.length;

    if (isDone) {
      return;
    }

    const batch = operations.slice(batchStart, batchStart + batchSize);
    batchStart += batchSize;
    await Promise.all(batch.map(putOne));
    await putNextBatch();
  }

  function putOne(operation: AppleUploadOperation): Promise<void> {
    return putAssetChunk(operation, ipaPath, fileSize);
  }
}

async function putAssetChunk(
  operation: AppleUploadOperation,
  ipaPath: string,
  fileSize: number,
): Promise<void> {
  const offset = operation.offset == null ? 0 : operation.offset;
  const length = operation.length == null ? fileSize - offset : operation.length;

  const chunk = await readFileRange(ipaPath, offset, length);
  const headers: Record<string, string> = {};

  for (const header of operation.requestHeaders) {
    headers[header.name] = header.value;
  }

  const method = operation.method == null ? 'PUT' : operation.method;

  const appleReply = await fetch(operation.url, { method, headers, body: chunk });
  const isOk = appleReply.ok;

  if (!isOk) {
    throw new Error(`App Store Connect IPA upload failed (${appleReply.status}).`);
  }
}

async function readFileRange(filePath: string, offset: number, length: number): Promise<Buffer> {
  const file = await open(filePath, 'r');
  var chunk: Buffer;

  try {
    chunk = Buffer.alloc(length);
    await file.read(chunk, 0, length, offset);
  } finally {
    await file.close();
  }

  return chunk;
}
