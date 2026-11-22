import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodeSigner } from '../credentials/codeSign.js';
import type { Logger } from '../services/platform/logger.js';
import { pathExists } from '../path-exists.js';
import type { StorageProvider } from '../types/providers.js';
import { assembleManifest, contentTypeFor, type ManifestAsset } from './otaManifest.js';
import { activateUpdate } from './updateHistory.js';

/** The part of Expo export metadata required to publish bundles and assets. */
export type ExportMetadata = {
  fileMetadata: Record<
    string,
    {
      bundle: string;
      assets: {
        path: string;
        ext: string;
      }[];
    }
  >;
};

export type OtaPublishFailure = Readonly<{
  readonly _tag: 'OtaPublishFailure';
  readonly message: string;
}>;

function makeOtaPublishFailure(message: string): OtaPublishFailure {
  return { _tag: 'OtaPublishFailure', message };
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (typeof candidate != 'object') {
    return false;
  }

  if (candidate == null) {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function decodeExportMetadata(metadataText: string, metadataFilePath: string): ExportMetadata {
  let parsed: unknown;

  try {
    parsed = JSON.parse(metadataText);
  } catch (cause) {
    const isUnreadable = cause != null;

    if (isUnreadable) {
      throw makeOtaPublishFailure(
        `${metadataFilePath} does not contain valid Expo export metadata.`,
      );
    }

    throw makeOtaPublishFailure(`${metadataFilePath} does not contain valid Expo export metadata.`);
  }

  if (isRecord(parsed) == false) {
    throw makeOtaPublishFailure(`${metadataFilePath} does not contain valid Expo export metadata.`);
  }

  if (isRecord(parsed['fileMetadata']) == false) {
    throw makeOtaPublishFailure(`${metadataFilePath} does not contain valid Expo export metadata.`);
  }

  const fileMetadata: ExportMetadata['fileMetadata'] = {};

  for (const platformName of Object.keys(parsed['fileMetadata'])) {
    const platformMetadata = parsed['fileMetadata'][platformName];

    if (isRecord(platformMetadata) == false) {
      throw makeOtaPublishFailure(
        `${metadataFilePath} does not contain valid Expo export metadata.`,
      );
    }

    if (typeof platformMetadata['bundle'] != 'string') {
      throw makeOtaPublishFailure(
        `${metadataFilePath} does not contain valid Expo export metadata.`,
      );
    }

    if (Array.isArray(platformMetadata['assets']) == false) {
      throw makeOtaPublishFailure(
        `${metadataFilePath} does not contain valid Expo export metadata.`,
      );
    }

    const assets: ExportMetadata['fileMetadata'][string]['assets'] = [];

    for (const asset of platformMetadata['assets']) {
      if (isRecord(asset) == false) {
        throw makeOtaPublishFailure(
          `${metadataFilePath} does not contain valid Expo export metadata.`,
        );
      }

      if (typeof asset['path'] != 'string') {
        throw makeOtaPublishFailure(
          `${metadataFilePath} does not contain valid Expo export metadata.`,
        );
      }

      if (typeof asset['ext'] != 'string') {
        throw makeOtaPublishFailure(
          `${metadataFilePath} does not contain valid Expo export metadata.`,
        );
      }

      assets.push({ path: asset['path'], ext: asset['ext'] });
    }

    fileMetadata[platformName] = { bundle: platformMetadata['bundle'], assets };
  }

  return { fileMetadata };
}

/** Read and validate metadata.json from an Expo export directory. */
export async function readExportMetadata(exportDirectory: string): Promise<ExportMetadata> {
  const metadataFilePath = join(exportDirectory, 'metadata.json');
  const metadataExists = await pathExists(metadataFilePath);

  if (metadataExists == false) {
    throw makeOtaPublishFailure(
      `No metadata.json in ${exportDirectory}; Expo export may not have completed.`,
    );
  }

  try {
    const metadataText = await readFile(metadataFilePath, 'utf8');

    return decodeExportMetadata(metadataText, metadataFilePath);
  } catch (cause) {
    if (isOtaPublishFailure(cause)) {
      throw cause;
    }

    throw makeOtaPublishFailure(`Could not read ${metadataFilePath}.`);
  }
}

function isOtaPublishFailure(cause: unknown): cause is OtaPublishFailure {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'OtaPublishFailure';
}

type OtaPublishInput = Readonly<{
  readonly storage: StorageProvider;
  readonly distDir: string;
  readonly metadata: ExportMetadata;
  readonly platform: 'ios' | 'android';
  readonly channel: string;
  readonly runtimeVersion: string;
  readonly signer: CodeSigner | null;
}>;

type OtaPublishDetails = Readonly<{
  readonly published: boolean;
  readonly manifestId?: string;
  readonly createdAt?: string;
  readonly assetCount: number;
  readonly prefix: string;
}>;

async function uploadExportFile(
  publishInput: OtaPublishInput,
  relativeFilePath: string,
  fileExtension?: string,
): Promise<ManifestAsset> {
  const objectPrefix = `updates/${publishInput.channel}/${publishInput.platform}/${publishInput.runtimeVersion}`;
  const objectKey = `${objectPrefix}/${relativeFilePath}`;
  const assetBytes = await readFile(join(publishInput.distDir, relativeFilePath));
  const contentType = contentTypeFor(relativeFilePath);

  await publishInput.storage.putObject(objectKey, assetBytes, contentType);

  const manifestAsset: ManifestAsset = {
    key: relativeFilePath,
    contentType,
    url: publishInput.storage.publicUrl(objectKey),
  };

  if (fileExtension == null) {
    return manifestAsset;
  }

  return { ...manifestAsset, fileExtension: `.${fileExtension}` };
}

/** Publish one platform bundle, its assets, active manifest, and history snapshot. */
export async function publishOtaPlatform(
  publishInput: OtaPublishInput,
  logger: Logger,
): Promise<OtaPublishDetails> {
  const { storage, metadata, platform, channel, runtimeVersion, signer } = publishInput;
  const objectPrefix = `updates/${channel}/${platform}/${runtimeVersion}`;
  const platformMetadata = metadata.fileMetadata[platform];

  if (platformMetadata == null) {
    logger.warn(`No ${platform} bundle in the export; skipping.`);

    return { published: false, assetCount: 0, prefix: objectPrefix };
  }

  const launchAsset = await uploadExportFile(publishInput, platformMetadata.bundle);

  function uploadAsset(exportedAsset: { path: string; ext: string }): Promise<ManifestAsset> {
    return uploadExportFile(publishInput, exportedAsset.path, exportedAsset.ext);
  }

  const manifestAssets = await Promise.all(platformMetadata.assets.map(uploadAsset));

  const manifestId = randomUUID();
  const createdAt = new Date().toISOString();
  const updateManifest = assembleManifest({
    id: manifestId,
    createdAt,
    runtimeVersion,
    launchAsset,
    assets: manifestAssets,
  });

  await activateUpdate({
    storage,
    channel,
    platform,
    updateManifest,
    kind: 'publish',
    signer,
  });
  logger.step(
    'update',
    `${platform} - ${manifestAssets.length} asset(s) -> ${objectPrefix}/`,
    'ota-update',
  );

  return {
    published: true,
    manifestId,
    createdAt,
    assetCount: manifestAssets.length,
    prefix: objectPrefix,
  };
}
