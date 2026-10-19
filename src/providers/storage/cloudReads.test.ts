import { createServer } from 'node:http';
import { once } from 'node:events';
import { FetchHttpClient } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeLaunchEnvironmentTest } from '@core/services/environment.js';
import { LaunchSecretStoreTest } from '@core/services/secretStore.js';
import { makeS3StorageProvider } from './s3.js';
import { makeSupabaseStorageProvider } from './supabase.js';

const withStorageReply = async (
  status: number,
  replyText: string,
  checkStorage: (endpoint: string) => Promise<void>,
) => {
  const server = createServer((_request, storageReply) => {
    storageReply.writeHead(status);
    storageReply.end(replyText);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null) throw new Error('Missing test server address');
  if (typeof address === 'string') throw new Error('Expected TCP address');
  try {
    await checkStorage(`http://127.0.0.1:${address.port}`);
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
};

const storageProviders = [makeS3StorageProvider, makeSupabaseStorageProvider];

for (const createProvider of storageProviders) {
  describe(createProvider.name, () => {
    const readStorage = (endpoint: string, objectKey?: string) =>
      Effect.gen(function* () {
        const storage = yield* createProvider({
          bucket: 'test-bucket',
          region: 'us-east-1',
          endpoint,
          supabaseUrl: endpoint,
          publicBaseUrl: endpoint,
        });
        if (objectKey !== undefined) return yield* storage.getObject(objectKey);
        return yield* storage.list();
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(FetchHttpClient.layer),
        Effect.provide(LaunchSecretStoreTest),
        Effect.provide(
          makeLaunchEnvironmentTest({
            LAUNCH_S3_ACCESS_KEY_ID: 'test-access',
            LAUNCH_S3_SECRET_ACCESS_KEY: 'test-secret',
            LAUNCH_SUPABASE_SERVICE_KEY: 'test-service-key',
          }),
        ),
      );

    it('returns empty history only for a missing index', async () => {
      await withStorageReply(404, '<Error><Code>NoSuchKey</Code></Error>', async (endpoint) => {
        const history = await Effect.runPromise(readStorage(endpoint));
        expect(history).toEqual([]);
      });
    });

    it('rejects denied index reads', async () => {
      await withStorageReply(403, '<Error><Code>AccessDenied</Code></Error>', async (endpoint) => {
        await expect(Effect.runPromise(readStorage(endpoint))).rejects.toThrow();
      });
    });

    it('rejects malformed index contents', async () => {
      await withStorageReply(200, '{broken', async (endpoint) => {
        await expect(Effect.runPromise(readStorage(endpoint))).rejects.toThrow();
      });
    });

    it('does not disguise denied object reads as absent objects', async () => {
      await withStorageReply(403, '<Error><Code>AccessDenied</Code></Error>', async (endpoint) => {
        await expect(Effect.runPromise(readStorage(endpoint, 'manifest.json'))).rejects.toThrow();
      });
    });
  });
}
