// Supabase artifact storage through its HTTP object API.

import { FileSystem, HttpClient, HttpClientRequest, Path } from '@effect/platform';
import { Effect, Redacted, Schema } from 'effect';
import { LaunchEnvironment } from '@core/services/environment.js';
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

const INDEX_OBJECT_KEY = 'artifacts/index.json';

const resolveServiceKey = Effect.gen(function* () {
  const environment = yield* LaunchEnvironment;
  const secretStore = yield* LaunchSecretStore;
  let serviceKey = yield* secretStore.readSecret('storage-supabase-service-key');
  if (environment.values.supabaseServiceKey !== undefined) {
    serviceKey = Redacted.value(environment.values.supabaseServiceKey);
  }
  if (serviceKey === null) {
    return yield* Effect.fail(
      makeProviderInputFailure({
        provider: 'supabase-storage',
        message:
          'No Supabase service key found. Set LAUNCH_SUPABASE_SERVICE_KEY or store account storage-supabase-service-key with `launch creds`.',
      }),
    );
  }
  if (serviceKey === '') {
    return yield* Effect.fail(
      makeProviderInputFailure({
        provider: 'supabase-storage',
        message:
          'No Supabase service key found. Set LAUNCH_SUPABASE_SERVICE_KEY or store account storage-supabase-service-key with `launch creds`.',
      }),
    );
  }
  return serviceKey;
});

const joinPublicUrl = (publicBaseUrl: string, objectKey: string): string =>
  `${publicBaseUrl.replace(/\/+$/, '')}/${objectKey.replace(/^\/+/, '')}`;

/** Acquire HTTP, secret-store, filesystem, and path services for one Supabase bucket. */
export const makeSupabaseStorageProvider = (storageConfig: StorageConfig) =>
  Effect.gen(function* () {
    if (storageConfig.supabaseUrl === undefined) {
      return yield* Effect.fail(
        makeProviderInputFailure({
          provider: 'supabase-storage',
          message:
            'The "supabase" storage provider needs storageConfig.supabaseUrl in launch.config.ts.',
        }),
      );
    }
    type ServiceKeyRequirements = Effect.Effect.Context<typeof resolveServiceKey>;
    const secretServices = yield* Effect.context<ServiceKeyRequirements>();
    const readServiceKey = () => resolveServiceKey.pipe(Effect.provide(secretServices));
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const httpClient = yield* HttpClient.HttpClient;
    const projectUrl = storageConfig.supabaseUrl;
    const objectEndpoint = (objectKey: string): string =>
      `${projectUrl.replace(/\/+$/, '')}/storage/v1/object/${storageConfig.bucket}/${objectKey}`;
    const publicUrl = (objectKey: string): string =>
      joinPublicUrl(storageConfig.publicBaseUrl, objectKey);

    const upload = (
      objectKey: string,
      objectContents: Buffer | string,
      contentType: string,
    ): Effect.Effect<StoredArtifact, unknown> =>
      Effect.gen(function* () {
        const serviceKey = yield* readServiceKey();
        let uploadRequest = HttpClientRequest.post(objectEndpoint(objectKey)).pipe(
          HttpClientRequest.setHeaders({
            Authorization: `Bearer ${serviceKey}`,
            'x-upsert': 'true',
          }),
        );
        if (typeof objectContents === 'string') {
          uploadRequest = HttpClientRequest.bodyText(uploadRequest, objectContents, contentType);
        } else {
          uploadRequest = HttpClientRequest.bodyUint8Array(
            uploadRequest,
            objectContents,
            contentType,
          );
        }
        const uploadReply = yield* httpClient.execute(uploadRequest);
        let uploadFailed = uploadReply.status < 200;
        if (!uploadFailed) uploadFailed = uploadReply.status >= 300;
        if (uploadFailed) {
          const failureDetail = yield* uploadReply.text;
          return yield* Effect.fail(
            makeProviderInputFailure({
              provider: 'supabase-storage',
              message: `Supabase upload of ${objectKey} failed (${uploadReply.status}): ${failureDetail}`,
            }),
          );
        }
        return { id: objectKey, location: publicUrl(objectKey) };
      });

    const readIndex = (): Effect.Effect<BuildArtifact[], unknown> =>
      Effect.gen(function* () {
        const serviceKey = yield* readServiceKey();
        const indexRequest = HttpClientRequest.get(objectEndpoint(INDEX_OBJECT_KEY)).pipe(
          HttpClientRequest.setHeader('Authorization', `Bearer ${serviceKey}`),
        );
        const indexReply = yield* httpClient.execute(indexRequest);
        if (indexReply.status < 200) return [];
        if (indexReply.status >= 300) return [];
        const indexText = yield* indexReply.text;
        return yield* Schema.decodeUnknown(Schema.parseJson(ArtifactIndexSchema))(indexText).pipe(
          Effect.catchAll(() => Effect.succeed([])),
        );
      });

    const storageProvider: StorageProvider = {
      name: 'supabase',
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
        Effect.gen(function* () {
          const serviceKey = yield* readServiceKey();
          const objectRequest = HttpClientRequest.get(objectEndpoint(objectKey)).pipe(
            HttpClientRequest.setHeader('Authorization', `Bearer ${serviceKey}`),
          );
          const objectReply = yield* httpClient.execute(objectRequest);
          if (objectReply.status < 200) return null;
          if (objectReply.status >= 300) return null;
          return Buffer.from(yield* objectReply.arrayBuffer);
        }),
      publicUrl,
    };
    return storageProvider;
  });

type SupabaseStorageRequirements = Effect.Effect.Context<
  ReturnType<typeof makeSupabaseStorageProvider>
>;

/** Capture shared services once and defer Supabase configuration until this provider is selected. */
export const makeSupabaseStorageProviderResolver = () =>
  Effect.gen(function* () {
    const providerServices = yield* Effect.context<SupabaseStorageRequirements>();
    return {
      name: 'supabase',
      resolveStorageProvider: (providerOptions) => {
        if (providerOptions.storageConfig === undefined) {
          return Effect.fail(
            makeProviderInputFailure({
              provider: 'supabase',
              message:
                'Storage "supabase" needs a storageConfig block in launch.config.ts (bucket + publicBaseUrl).',
            }),
          );
        }
        return makeSupabaseStorageProvider(providerOptions.storageConfig).pipe(
          Effect.provide(providerServices),
        );
      },
    } satisfies StorageProviderResolver;
  });
