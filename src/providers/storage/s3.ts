// S3-compatible artifact storage. The SDK stays lazy until this provider is selected.

import { FileSystem, Path } from '@effect/platform';
import { Effect, Redacted, Schema } from 'effect';
import { LaunchEnvironment } from '@core/services/environment.js';
import { requireOptional } from '@core/services/optionalDep.js';
import { LaunchSecretStore } from '@core/services/secretStore.js';
import {
  ArtifactIndexSchema,
  type BuildArtifact,
  type StoredArtifact,
} from '@core/types/artifacts.js';
import type { StorageConfig } from '@core/types/config.js';
import {
  makeProviderInputFailure,
  type StorageProvider,
  type StorageProviderResolver,
} from '@core/types/providers.js';

type S3Module = typeof import('@aws-sdk/client-s3');
type S3Client = InstanceType<S3Module['S3Client']>;
type S3ClientOptions = ConstructorParameters<S3Module['S3Client']>[0];

const INSTALL_HINT = 'pnpm add @aws-sdk/client-s3';
const INDEX_OBJECT_KEY = 'artifacts/index.json';

const loadS3Module = () =>
  requireOptional('Cloud artifact storage (S3/R2/B2)', INSTALL_HINT, () =>
    Effect.tryPromise(() => import('@aws-sdk/client-s3')),
  );

const resolveS3Credentials = Effect.gen(function* () {
  const environment = yield* LaunchEnvironment;
  const secretStore = yield* LaunchSecretStore;
  let accessKeyId = yield* secretStore.readSecret('storage-s3-access-key-id');
  let secretAccessKey = yield* secretStore.readSecret('storage-s3-secret-access-key');

  if (environment.values.s3AccessKeyId !== undefined) {
    accessKeyId = Redacted.value(environment.values.s3AccessKeyId);
  }
  if (environment.values.s3SecretAccessKey !== undefined) {
    secretAccessKey = Redacted.value(environment.values.s3SecretAccessKey);
  }
  if (accessKeyId === null) return null;
  if (accessKeyId === '') return null;
  if (secretAccessKey === null) return null;
  if (secretAccessKey === '') return null;
  return { accessKeyId, secretAccessKey };
});

const joinPublicUrl = (publicBaseUrl: string, objectKey: string): string =>
  `${publicBaseUrl.replace(/\/+$/, '')}/${objectKey.replace(/^\/+/, '')}`;

/** Acquire S3, secret-store, filesystem, and path services for one configured bucket. */
export const makeS3StorageProvider = (storageConfig: StorageConfig) =>
  Effect.gen(function* () {
    const s3Module = yield* loadS3Module();
    const credentials = yield* resolveS3Credentials;
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    let region = storageConfig.region;
    if (region === undefined) region = 'auto';
    const clientOptions: S3ClientOptions = { region };
    if (storageConfig.endpoint !== undefined) {
      clientOptions.endpoint = storageConfig.endpoint;
      clientOptions.forcePathStyle = true;
    }
    if (credentials !== null) clientOptions.credentials = credentials;
    const s3Client: S3Client = new s3Module.S3Client(clientOptions);
    const publicUrl = (objectKey: string): string =>
      joinPublicUrl(storageConfig.publicBaseUrl, objectKey);

    const upload = (
      objectKey: string,
      objectContents: Buffer | string,
      contentType: string,
    ): Effect.Effect<StoredArtifact, unknown> =>
      Effect.tryPromise(() =>
        s3Client.send(
          new s3Module.PutObjectCommand({
            Bucket: storageConfig.bucket,
            Key: objectKey,
            Body: objectContents,
            ContentType: contentType,
          }),
        ),
      ).pipe(Effect.as({ id: objectKey, location: publicUrl(objectKey) }));

    const readIndex = (): Effect.Effect<BuildArtifact[], never> =>
      Effect.tryPromise(() =>
        s3Client.send(
          new s3Module.GetObjectCommand({
            Bucket: storageConfig.bucket,
            Key: INDEX_OBJECT_KEY,
          }),
        ),
      ).pipe(
        Effect.flatMap((indexReply) => {
          const indexObjectStream = indexReply.Body;
          if (indexObjectStream === undefined) return Effect.succeed([]);
          return Effect.tryPromise(() => indexObjectStream.transformToString()).pipe(
            Effect.flatMap((indexText) => {
              if (indexText === '') return Effect.succeed([]);
              return Schema.decodeUnknown(Schema.parseJson(ArtifactIndexSchema))(indexText);
            }),
          );
        }),
        Effect.catchAll(() => Effect.succeed([])),
      );

    const storageProvider: StorageProvider = {
      name: 's3',
      put: (artifact: BuildArtifact) =>
        Effect.gen(function* () {
          const objectKey = `artifacts/${artifact.appName}-${artifact.version}-${artifact.buildNumber}-${artifact.platform}${pathService.extname(artifact.path)}`;
          const artifactBytes = yield* fileSystem.readFile(artifact.path);
          const uploadedArtifact = yield* upload(
            objectKey,
            Buffer.from(artifactBytes),
            'application/octet-stream',
          );
          const artifactIndex = yield* readIndex();
          artifactIndex.unshift({ ...artifact, path: uploadedArtifact.location });
          yield* upload(
            INDEX_OBJECT_KEY,
            JSON.stringify(artifactIndex, null, 2),
            'application/json',
          );
          return uploadedArtifact;
        }),
      list: readIndex,
      url: (artifactId: string) => {
        let objectKey = artifactId;
        if (!objectKey.startsWith('artifacts/')) objectKey = `artifacts/${objectKey}`;
        return Effect.succeed(publicUrl(objectKey));
      },
      putObject: upload,
      getObject: (objectKey: string) =>
        Effect.tryPromise(() =>
          s3Client.send(
            new s3Module.GetObjectCommand({ Bucket: storageConfig.bucket, Key: objectKey }),
          ),
        ).pipe(
          Effect.flatMap((objectReply) => {
            const objectStream = objectReply.Body;
            if (objectStream === undefined) return Effect.succeed(null);
            return Effect.tryPromise(() => objectStream.transformToByteArray()).pipe(
              Effect.map((objectBytes) => Buffer.from(objectBytes)),
            );
          }),
          Effect.catchAll(() => Effect.succeed(null)),
        ),
      publicUrl,
    };
    return storageProvider;
  });

type S3StorageRequirements = Effect.Effect.Context<ReturnType<typeof makeS3StorageProvider>>;

/** Capture shared services once and defer S3 client creation until this provider is selected. */
export const makeS3StorageProviderResolver = () =>
  Effect.gen(function* () {
    const providerServices = yield* Effect.context<S3StorageRequirements>();
    return {
      name: 's3',
      resolveStorageProvider: (providerOptions) => {
        if (providerOptions.storageConfig === undefined) {
          return Effect.fail(
            makeProviderInputFailure({
              provider: 's3',
              message:
                'Storage "s3" needs a storageConfig block in launch.config.ts (bucket + publicBaseUrl).',
            }),
          );
        }
        return makeS3StorageProvider(providerOptions.storageConfig).pipe(
          Effect.provide(providerServices),
        );
      },
    } satisfies StorageProviderResolver;
  });
