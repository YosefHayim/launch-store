// Stores build artifacts in Amazon S3 and reads them back for a later release.

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { readLaunchEnvironment } from '@/services/platform/environment.js';
import { errorMessage } from '@/services/platform/error-message.js';
import { requireOptional } from '@/services/platform/optional-dep.js';
import { LaunchSecretStore } from '@/services/credentials/secret-store.js';
import type { BuildArtifact, StoredArtifact } from '@/types/artifacts.js';
import type { Platform } from '@/types/app.js';
import type { StorageConfig } from '@/types/config.js';
import {
  makeProviderInputFailure,
  type StorageProvider,
  type StorageProviderResolver,
} from '@/types/providers.js';
import { readPlainObject } from '@/services/platform/plain-object.js';

type S3Module = typeof import('@aws-sdk/client-s3');

type S3Client = InstanceType<S3Module['S3Client']>;

type S3ClientOptions = ConstructorParameters<S3Module['S3Client']>[0];

type ObjectBody = {
  transformToString(): Promise<string>;

  transformToByteArray(): Promise<Uint8Array>;
};

type ObjectReply = {
  Body?: ObjectBody;
};

const INDEX_OBJECT_KEY = 'artifacts/index.json';

function loadS3Module(): Promise<S3Module> {
  return requireOptional(
    'Cloud artifact storage (S3/R2/B2)',
    'pnpm add @aws-sdk/client-s3',
    function importS3() {
      return import('@aws-sdk/client-s3');
    },
  );
}

function isMissingS3Object(failure: unknown): boolean {
  const failureObject = readPlainObject(failure);

  if (failureObject == null) {
    return false;
  }

  if (failureObject['name'] == 'NoSuchKey') {
    return true;
  }

  const metadata = failureObject['$metadata'];

  const metadataObject = readPlainObject(metadata);

  if (metadataObject == null) {
    return false;
  }

  return metadataObject['httpStatusCode'] == 404;
}

function s3Failure(action: string, failure: unknown): unknown {
  const failureObject = readPlainObject(failure);

  if (failureObject != null) {
    const isParseError = failureObject['_tag'] == 'ParseError';

    if (isParseError) {
      return failureObject;
    }
  }

  const reasonMessage = errorMessage(failure);

  return makeProviderInputFailure({
    provider: 's3',
    message: `S3 ${action} failed: ${reasonMessage}`,
  });
}

function parseFailure(message: string): { _tag: 'ParseError'; message: string } {
  return { _tag: 'ParseError', message };
}

function readRequiredString(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];

  if (typeof field != 'string') {
    throw parseFailure(`Artifact index field ${fieldName} must be a string.`);
  }

  return field;
}

function readPlatform(record: Record<string, unknown>): Platform {
  const field = record['platform'];

  if (typeof field != 'string') {
    throw parseFailure('Artifact index platform is not a known platform.');
  }

  const isKnownPlatform = ['ios', 'android', 'tvos', 'macos', 'visionos'].includes(
    field as Platform,
  );

  if (isKnownPlatform) {
    return field as Platform;
  }

  throw parseFailure('Artifact index platform is not a known platform.');
}

function readSizeReport(record: Record<string, unknown>): BuildArtifact['sizeReport'] {
  const sizeReport = record['sizeReport'];

  const sizeReportObject = readPlainObject(sizeReport);

  if (sizeReportObject == null) {
    throw parseFailure('Artifact index size report is missing.');
  }

  if (typeof sizeReportObject['artifactBytes'] != 'number') {
    throw parseFailure('Artifact index size report is missing artifactBytes.');
  }

  if (Array.isArray(sizeReportObject['entries']) == false) {
    throw parseFailure('Artifact index size report entries are missing.');
  }

  const entries: BuildArtifact['sizeReport']['entries'] = [];

  for (const entry of sizeReportObject['entries']) {
    const entryObject = readPlainObject(entry);

    if (entryObject == null) {
      throw parseFailure('Artifact index size report entry is malformed.');
    }

    if (typeof entryObject['device'] != 'string') {
      throw parseFailure('Artifact index size report entry is malformed.');
    }

    if (typeof entryObject['downloadBytes'] != 'number') {
      throw parseFailure('Artifact index size report entry is malformed.');
    }

    if (typeof entryObject['installBytes'] != 'number') {
      throw parseFailure('Artifact index size report entry is malformed.');
    }

    entries.push({
      device: entryObject['device'],
      downloadBytes: entryObject['downloadBytes'],
      installBytes: entryObject['installBytes'],
    });
  }

  return { artifactBytes: sizeReportObject['artifactBytes'], entries };
}

function readBuildArtifact(candidate: unknown): BuildArtifact {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    throw parseFailure('Artifact index entry must be an object.');
  }

  const artifact: BuildArtifact = {
    path: readRequiredString(candidateObject, 'path'),
    platform: readPlatform(candidateObject),
    appName: readRequiredString(candidateObject, 'appName'),
    profile: readRequiredString(candidateObject, 'profile'),
    version: readRequiredString(candidateObject, 'version'),
    buildNumber: readBuildNumber(candidateObject),
    sizeReport: readSizeReport(candidateObject),
    clean: readClean(candidateObject),
    createdAt: readRequiredString(candidateObject, 'createdAt'),
  };
  const prunedAt = readOptionalString(candidateObject, 'prunedAt');

  if (prunedAt != null) {
    return { ...artifact, prunedAt };
  }

  return artifact;
}

function readBuildNumber(record: Record<string, unknown>): number {
  if (typeof record['buildNumber'] != 'number') {
    throw parseFailure('Artifact index buildNumber must be a number.');
  }

  return record['buildNumber'];
}

function readClean(record: Record<string, unknown>): boolean {
  if (typeof record['clean'] != 'boolean') {
    throw parseFailure('Artifact index clean must be a boolean.');
  }

  return record['clean'];
}

function readOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
): string | null | undefined {
  if (Object.hasOwn(record, fieldName) == false) {
    return undefined;
  }

  const field = record[fieldName];

  if (typeof field == 'string') {
    return field;
  }

  return null;
}

export function decodeArtifactIndex(indexText: string): BuildArtifact[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(indexText);
  } catch (cause) {
    const failureMessage = errorMessage(cause);
    throw parseFailure(failureMessage);
  }

  if (Array.isArray(parsed) == false) {
    throw parseFailure('Artifact index must be an array.');
  }

  const artifacts: BuildArtifact[] = [];

  for (const candidate of parsed) {
    const artifact = readBuildArtifact(candidate);
    const candidateObject = readPlainObject(candidate);
    let prunedAt: string | null | undefined;

    if (candidateObject != null) {
      prunedAt = readOptionalString(candidateObject, 'prunedAt');
    }

    const prunedAtIsAbsent = typeof prunedAt == 'undefined';

    if (prunedAtIsAbsent) {
      artifacts.push(artifact);
      continue;
    }

    const prunedAtIsInvalid = prunedAt == null;

    if (prunedAtIsInvalid) {
      throw parseFailure('Artifact index prunedAt must be a string.');
    }

    artifacts.push(artifact);
  }

  return artifacts;
}

async function resolveS3Credentials(): Promise<{
  accessKeyId: string;
  secretAccessKey: string;
} | null> {
  const environment = readLaunchEnvironment();
  let accessKeyId = await LaunchSecretStore.readSecret('storage-s3-access-key-id');
  let secretAccessKey = await LaunchSecretStore.readSecret('storage-s3-secret-access-key');

  if (environment.values.s3AccessKeyId != null) {
    accessKeyId = environment.values.s3AccessKeyId;
  }

  if (environment.values.s3SecretAccessKey != null) {
    secretAccessKey = environment.values.s3SecretAccessKey;
  }

  if (accessKeyId == null) {
    return null;
  }

  if (accessKeyId == '') {
    return null;
  }

  if (secretAccessKey == null) {
    return null;
  }

  if (secretAccessKey == '') {
    return null;
  }

  return { accessKeyId, secretAccessKey };
}

function joinPublicUrl(publicBaseUrl: string, objectKey: string): string {
  return `${publicBaseUrl.replace(/\/+$/, '')}/${objectKey.replace(/^\/+/, '')}`;
}

function artifactObjectKey(artifact: BuildArtifact): string {
  return `artifacts/${artifact.appName}-${artifact.version}-${artifact.buildNumber}-${artifact.platform}${extname(artifact.path)}`;
}

export async function makeS3StorageProvider(
  storageConfig: StorageConfig,
): Promise<StorageProvider> {
  const s3Module = await loadS3Module();
  const credentials = await resolveS3Credentials();
  let region = storageConfig.region;

  if (region == null) {
    region = 'auto';
  }

  const clientOptions: S3ClientOptions = { region };

  if (storageConfig.endpoint != null) {
    clientOptions.endpoint = storageConfig.endpoint;
    clientOptions.forcePathStyle = true;
  }

  if (credentials != null) {
    clientOptions.credentials = credentials;
  }

  const s3Client: S3Client = new s3Module.S3Client(clientOptions);

  function publicUrl(objectKey: string): string {
    return joinPublicUrl(storageConfig.publicBaseUrl, objectKey);
  }

  async function upload(
    objectKey: string,
    objectContents: Buffer | string,
    contentType: string,
  ): Promise<StoredArtifact> {
    try {
      await s3Client.send(
        new s3Module.PutObjectCommand({
          Bucket: storageConfig.bucket,
          Key: objectKey,
          Body: objectContents,
          ContentType: contentType,
        }),
      );
    } catch (cause) {
      throw s3Failure(`upload of ${objectKey}`, cause);
    }

    return { id: objectKey, location: publicUrl(objectKey) };
  }

  async function readIndex(): Promise<BuildArtifact[]> {
    let indexReply: ObjectReply;

    try {
      indexReply = (await s3Client.send(
        new s3Module.GetObjectCommand({
          Bucket: storageConfig.bucket,
          Key: INDEX_OBJECT_KEY,
        }),
      )) as ObjectReply;
    } catch (cause) {
      if (isMissingS3Object(cause)) {
        return [];
      }

      throw s3Failure(`read of ${INDEX_OBJECT_KEY}`, cause);
    }

    const indexObjectStream = indexReply.Body;

    if (indexObjectStream == null) {
      throw makeProviderInputFailure({
        provider: 's3',
        message: 'Artifact index response has no body.',
      });
    }

    const indexText = await indexObjectStream.transformToString();

    return decodeArtifactIndex(indexText);
  }

  async function putArtifact(artifact: BuildArtifact): Promise<StoredArtifact> {
    const objectKey = artifactObjectKey(artifact);
    const artifactBytes = await readFile(artifact.path);
    const uploadedArtifact = await upload(objectKey, artifactBytes, 'application/octet-stream');
    const artifactIndex = await readIndex();

    artifactIndex.unshift({ ...artifact, path: uploadedArtifact.location });

    const serialized = JSON.stringify(artifactIndex, null, 2);

    await upload(INDEX_OBJECT_KEY, serialized, 'application/json');

    return uploadedArtifact;
  }

  async function locateArtifact(artifactId: string): Promise<string> {
    let objectKey = artifactId;

    if (objectKey.startsWith('artifacts/') == false) {
      objectKey = `artifacts/${objectKey}`;
    }

    return publicUrl(objectKey);
  }

  async function getObject(objectKey: string): Promise<Buffer | null> {
    let objectReply: ObjectReply;

    try {
      objectReply = (await s3Client.send(
        new s3Module.GetObjectCommand({ Bucket: storageConfig.bucket, Key: objectKey }),
      )) as ObjectReply;
    } catch (cause) {
      if (isMissingS3Object(cause)) {
        return null;
      }

      throw s3Failure(`read of ${objectKey}`, cause);
    }

    const objectStream = objectReply.Body;

    if (objectStream == null) {
      throw makeProviderInputFailure({
        provider: 's3',
        message: `Object ${objectKey} response has no body.`,
      });
    }

    const objectBytes = await objectStream.transformToByteArray();

    return Buffer.from(objectBytes);
  }

  return {
    name: 's3',
    put: putArtifact,
    list: readIndex,
    url: locateArtifact,
    putObject: upload,
    getObject,
    publicUrl,
  };
}

export function makeS3StorageProviderResolver(): StorageProviderResolver {
  return {
    name: 's3',
    resolveStorageProvider(providerOptions) {
      if (providerOptions.storageConfig == null) {
        const makeProviderFailure = makeProviderInputFailure({
          provider: 's3',
          message:
            'Storage "s3" needs a storageConfig block in launch.config.ts (bucket + publicBaseUrl).',
        });

        return Promise.reject(makeProviderFailure);
      }

      return makeS3StorageProvider(providerOptions.storageConfig);
    },
  };
}
