import { FileSystem, Path } from '@effect/platform';
import { Clock, Data, Effect, Random, Schema } from 'effect';
import type { CodeSigner } from '../credentials/codeSign.js';
import type { Logger } from '../services/logger.js';
import type { StorageProvider } from '../types/providers.js';
import {
  assembleManifest,
  contentTypeFor,
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
  type ManifestAsset,
} from './otaManifest.js';
import { clearRollbackDirective, recordPublish } from './updateHistory.js';

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

const ExportMetadataSchema: Schema.Schema<ExportMetadata> = Schema.mutable(
  Schema.Struct({
    fileMetadata: Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.mutable(
          Schema.Struct({
            bundle: Schema.String,
            assets: Schema.mutable(
              Schema.Array(
                Schema.mutable(
                  Schema.Struct({
                    path: Schema.String,
                    ext: Schema.String,
                  }),
                ),
              ),
            ),
          }),
        ),
      }),
    ),
  }),
);

/** Expo export metadata is missing or does not match the expected contract. */
export type OtaPublishFailure = Readonly<{
  readonly _tag: 'OtaPublishFailure';
  readonly message: string;
}>;

export const makeOtaPublishFailure = Data.tagged<OtaPublishFailure>('OtaPublishFailure');

/** Read and validate metadata.json from an Expo export directory. */
export const readExportMetadata = (
  exportDirectory: string,
): Effect.Effect<ExportMetadata, OtaPublishFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const metadataFilePath = pathService.join(exportDirectory, 'metadata.json');
    const metadataExists = yield* fileSystem
      .exists(metadataFilePath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!metadataExists) {
      return yield* Effect.fail(
        makeOtaPublishFailure({
          message: `No metadata.json in ${exportDirectory}; Expo export may not have completed.`,
        }),
      );
    }

    const metadataText = yield* fileSystem.readFileString(metadataFilePath).pipe(
      Effect.mapError(() =>
        makeOtaPublishFailure({
          message: `Could not read ${metadataFilePath}.`,
        }),
      ),
    );
    return yield* Effect.try(() => JSON.parse(metadataText)).pipe(
      Effect.flatMap(Schema.decodeUnknown(ExportMetadataSchema)),
      Effect.mapError(() =>
        makeOtaPublishFailure({
          message: `${metadataFilePath} does not contain valid Expo export metadata.`,
        }),
      ),
    );
  });

/** Inputs required to publish one platform update. */
export type OtaPublishInput = Readonly<{
  readonly storage: StorageProvider;
  readonly distDir: string;
  readonly metadata: ExportMetadata;
  readonly platform: 'ios' | 'android';
  readonly channel: string;
  readonly runtimeVersion: string;
  readonly signer: CodeSigner | null;
}>;

/** Details produced by one platform publish. */
export type OtaPublishResult = Readonly<{
  readonly published: boolean;
  readonly manifestId?: string;
  readonly createdAt?: string;
  readonly assetCount: number;
  readonly prefix: string;
}>;

/** Create an injectable RFC 4122 version-4 identifier. */
const randomUpdateId = (): Effect.Effect<string> =>
  Effect.gen(function* () {
    const byteOffsets = Array.from({ length: 16 }, (_, byteOffset) => byteOffset);
    const randomBytes = yield* Effect.forEach(byteOffsets, () => Random.nextIntBetween(0, 256), {
      concurrency: 1,
    });
    const versionByte = randomBytes[6];
    const variantByte = randomBytes[8];
    if (versionByte === undefined)
      return yield* Effect.dieMessage('UUID version byte is unavailable');
    if (variantByte === undefined)
      return yield* Effect.dieMessage('UUID variant byte is unavailable');
    randomBytes[6] = (versionByte & 0x0f) | 0x40;
    randomBytes[8] = (variantByte & 0x3f) | 0x80;
    const hexadecimalId = randomBytes
      .map((randomByte) => randomByte.toString(16).padStart(2, '0'))
      .join('');
    return [
      hexadecimalId.slice(0, 8),
      hexadecimalId.slice(8, 12),
      hexadecimalId.slice(12, 16),
      hexadecimalId.slice(16, 20),
      hexadecimalId.slice(20),
    ].join('-');
  });

/** Publish one platform bundle, its assets, active manifest, and history snapshot. */
export const publishOtaPlatform = (
  input: OtaPublishInput,
  logger: Logger,
): Effect.Effect<OtaPublishResult, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const { storage, distDir, metadata, platform, channel, runtimeVersion, signer } = input;
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const objectPrefix = `updates/${channel}/${platform}/${runtimeVersion}`;
    const platformMetadata = metadata.fileMetadata[platform];
    if (platformMetadata === undefined) {
      yield* logger.warn(`No ${platform} bundle in the export; skipping.`);
      return { published: false, assetCount: 0, prefix: objectPrefix };
    }

    const uploadExportFile = (
      relativeFilePath: string,
      fileExtension?: string,
    ): Effect.Effect<ManifestAsset, unknown, Path.Path> =>
      Effect.gen(function* () {
        const objectKey = `${objectPrefix}/${relativeFilePath}`;
        const assetBytes = yield* fileSystem.readFile(pathService.join(distDir, relativeFilePath));
        const contentType = yield* contentTypeFor(relativeFilePath);
        yield* storage.putObject(objectKey, Buffer.from(assetBytes), contentType);
        const manifestAsset: ManifestAsset = {
          key: relativeFilePath,
          contentType,
          url: storage.publicUrl(objectKey),
        };
        if (fileExtension === undefined) return manifestAsset;
        return { ...manifestAsset, fileExtension: `.${fileExtension}` };
      });

    const launchAsset = yield* uploadExportFile(platformMetadata.bundle);
    const manifestAssets = yield* Effect.forEach(
      platformMetadata.assets,
      (exportedAsset) => uploadExportFile(exportedAsset.path, exportedAsset.ext),
      { concurrency: 'unbounded' },
    );
    const manifestId = yield* randomUpdateId();
    const epochMilliseconds = yield* Clock.currentTimeMillis;
    const createdAt = new Date(epochMilliseconds).toISOString();
    const updateManifest = assembleManifest({
      id: manifestId,
      createdAt,
      runtimeVersion,
      launchAsset,
      assets: manifestAssets,
    });
    const manifestText = JSON.stringify(updateManifest);
    yield* storage.putObject(
      manifestKey(channel, platform, runtimeVersion),
      manifestText,
      'application/json',
    );
    yield* storage.putObject(
      historySnapshotKey(channel, platform, runtimeVersion, manifestId),
      manifestText,
      'application/json',
    );
    if (signer !== null) {
      yield* storage.putObject(
        manifestSignatureKey(channel, platform, runtimeVersion),
        signer.sign(manifestText),
        'text/plain',
      );
    }
    yield* recordPublish(storage, channel, platform, {
      id: manifestId,
      runtimeVersion,
      createdAt,
      active: true,
      signed: signer !== null,
      kind: 'publish',
    });
    yield* clearRollbackDirective(storage, channel, platform, runtimeVersion);
    yield* logger.step(
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
  });
