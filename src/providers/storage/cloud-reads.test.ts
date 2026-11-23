import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { resetLaunchEnvironment, useLaunchEnvironment } from '@/services/platform/environment.js';
import { resetSecretStore, useSecretStore } from '@/services/credentials/secret-store.js';
import { makeS3StorageProvider } from './s3.ts';
import { makeSupabaseStorageProvider } from './supabase.ts';

async function withStorageReply(
  status: number,
  replyText: string,
  checkStorage: (endpoint: string) => Promise<void>,
) {
  function createServerRequest(
    _request: import('http').IncomingMessage,
    storageReply: import('http').ServerResponse<import('http').IncomingMessage> & {
      req: import('http').IncomingMessage;
    },
  ) {
    storageReply.writeHead(status);
    storageReply.end(replyText);
  }

  const server = createServer(createServerRequest);

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
}

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
function cleanup() {
  resetLaunchEnvironment();
  resetSecretStore();
}

afterEach(cleanup);

for (const createProvider of storageProviders) {
  function describeSuite() {
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
    async function returnsEmptyHistoryOnlyForAMissingIndex() {
      async function withStorageReplyEndpoint(endpoint: string) {
        const history = await readStorage(endpoint);
        expect(history).toEqual([]);
      }

      await withStorageReply(
        404,
        '<Error><Code>NoSuchKey</Code></Error>',
        withStorageReplyEndpoint,
      );
    }

    it('returns empty history only for a missing index', returnsEmptyHistoryOnlyForAMissingIndex);

    async function rejectsDeniedIndexReads() {
      async function withStorageReplyEndpoint2(endpoint: string) {
        const storage = readStorage(endpoint);
        await expect(storage).rejects.toThrow(/read of artifacts\/index\.json failed/);
      }

      await withStorageReply(
        403,
        '<Error><Code>AccessDenied</Code></Error>',
        withStorageReplyEndpoint2,
      );
    }

    it('rejects denied index reads', rejectsDeniedIndexReads);

    async function rejectsMalformedIndexContentsAsAParseFailureNotAFailedRead() {
      async function withStorageReplyEndpoint3(endpoint: string) {
        const storage = readStorage(endpoint);
        await expect(storage).rejects.toMatchObject({ _tag: 'ParseError' });
      }

      await withStorageReply(200, '{broken', withStorageReplyEndpoint3);
    }

    it(
      'rejects malformed index contents as a parse failure, not a failed read',
      rejectsMalformedIndexContentsAsAParseFailureNotAFailedRead,
    );

    async function readsAMissingObjectAsAbsent() {
      async function withStorageReplyEndpoint4(endpoint: string) {
        const objectBytes = await readStorage(endpoint, 'manifest.json');
        expect(objectBytes).toBeNull();
      }

      await withStorageReply(
        404,
        '<Error><Code>NoSuchKey</Code></Error>',
        withStorageReplyEndpoint4,
      );
    }

    it('reads a missing object as absent', readsAMissingObjectAsAbsent);

    async function decodesAValidIndex() {
      const serialized = JSON.stringify([storedArtifact]);

      async function withStorageReplyEndpoint5(endpoint: string) {
        const artifacts = await readStorage(endpoint);
        expect(artifacts).toEqual([storedArtifact]);
      }

      await withStorageReply(200, serialized, withStorageReplyEndpoint5);
    }

    it('decodes a valid index', decodesAValidIndex);

    async function doesNotDisguiseDeniedObjectReadsAsAbsentObjects() {
      async function withStorageReplyEndpoint6(endpoint: string) {
        const storage = readStorage(endpoint, 'manifest.json');
        await expect(storage).rejects.toThrow(/read of manifest\.json failed/);
      }

      await withStorageReply(
        403,
        '<Error><Code>AccessDenied</Code></Error>',
        withStorageReplyEndpoint6,
      );
    }

    it(
      'does not disguise denied object reads as absent objects',
      doesNotDisguiseDeniedObjectReadsAsAbsentObjects,
    );
  }

  describe(createProvider.name, describeSuite);
}
