import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resetLaunchEnvironment,
  useLaunchEnvironment,
} from '../../services/platform/environment.ts';
import { resetSecretStore, useSecretStore } from '../../services/credentials/secret-store.ts';
import { makeS3StorageProvider } from './s3.ts';
import { makeSupabaseStorageProvider } from './supabase.ts';

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

  if (address == null) {
    throw new Error('Missing test server address');
  }

  if (typeof address == 'string') {
    throw new Error('Expected TCP address');
  }

  try {
    await checkStorage(`http://127.0.0.1:${address.port}`);
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
};

const storedArtifact = {
  path: 'artifacts/app.ipa',
  platform: 'ios',
  appName: 'App',
  profile: 'production',
  version: '1.0.0',
  buildNumber: 7,
  sizeReport: { artifactBytes: 1024, entries: [] },
  clean: true,
  createdAt: '2026-10-20T00:00:00.000Z',
};

const storageProviders = [makeS3StorageProvider, makeSupabaseStorageProvider];

function useStorageSecrets(): void {
  useLaunchEnvironment({
    LAUNCH_S3_ACCESS_KEY_ID: 'test-access',
    LAUNCH_S3_SECRET_ACCESS_KEY: 'test-secret',
    LAUNCH_SUPABASE_SERVICE_KEY: 'test-service-key',
  });
  useSecretStore(new Map());
}

afterEach(() => {
  resetLaunchEnvironment();
  resetSecretStore();
});

for (const createProvider of storageProviders) {
  describe(createProvider.name, () => {
    async function readStorage(endpoint: string, objectKey?: string) {
      useStorageSecrets();
      const storage = await createProvider({
        bucket: 'test-bucket',
        region: 'us-east-1',
        endpoint,
        supabaseUrl: endpoint,
        publicBaseUrl: endpoint,
      });

      if (objectKey != null) {
        return storage.getObject(objectKey);
      }

      return storage.list();
    }

    it('returns empty history only for a missing index', async () => {
      await withStorageReply(404, '<Error><Code>NoSuchKey</Code></Error>', async (endpoint) => {
        const history = await readStorage(endpoint);
        expect(history).toEqual([]);
      });
    });

    it('rejects denied index reads', async () => {
      await withStorageReply(403, '<Error><Code>AccessDenied</Code></Error>', async (endpoint) => {
        await expect(readStorage(endpoint)).rejects.toThrow(
          /read of artifacts\/index\.json failed/,
        );
      });
    });

    it('rejects malformed index contents as a parse failure, not a failed read', async () => {
      await withStorageReply(200, '{broken', async (endpoint) => {
        await expect(readStorage(endpoint)).rejects.toMatchObject({ _tag: 'ParseError' });
      });
    });

    it('reads a missing object as absent', async () => {
      await withStorageReply(404, '<Error><Code>NoSuchKey</Code></Error>', async (endpoint) => {
        const objectBytes = await readStorage(endpoint, 'manifest.json');
        expect(objectBytes).toBeNull();
      });
    });

    it('decodes a valid index', async () => {
      await withStorageReply(200, JSON.stringify([storedArtifact]), async (endpoint) => {
        const artifacts = await readStorage(endpoint);
        expect(artifacts).toEqual([storedArtifact]);
      });
    });

    it('does not disguise denied object reads as absent objects', async () => {
      await withStorageReply(403, '<Error><Code>AccessDenied</Code></Error>', async (endpoint) => {
        await expect(readStorage(endpoint, 'manifest.json')).rejects.toThrow(
          /read of manifest\.json failed/,
        );
      });
    });
  });
}
