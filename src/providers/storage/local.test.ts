import { makeLaunchPathsTest } from '@core/services/paths.js';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactRetention } from '@core/services/artifactRetention.js';
import { makeLocalStorageProvider } from './local.js';

const temporaryRoots: string[] = [];
const withStorage = async (
  check: (
    storage: Effect.Effect.Success<ReturnType<typeof makeLocalStorageProvider>>,
    directory: string,
  ) => Promise<void>,
) => {
  const directory = mkdtempSync(join(tmpdir(), 'launch-storage-security-'));
  temporaryRoots.push(directory);
  const storage = await Effect.runPromise(
    makeLocalStorageProvider(join(directory, 'storage')).pipe(
      Effect.provideService(ArtifactRetention, {
        readIndex: () => Effect.succeed([]),
        writeIndex: () => Effect.void,
        prune: () => Effect.dieMessage('unused'),
      }),
      Effect.provide(NodeContext.layer),
      Effect.provide(makeLaunchPathsTest(directory, directory)),
    ),
  );
  await check(storage, directory);
};
afterEach(() => {
  for (const directory of temporaryRoots.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('local storage containment', () => {
  it('round-trips normal nested keys and returns null for a missing object', async () => {
    await withStorage(async (storage) => {
      await Effect.runPromise(
        storage.putObject('updates/production/manifest.json', 'safe', 'application/json'),
      );
      expect(
        (
          await Effect.runPromise(storage.getObject('updates/production/manifest.json'))
        )?.toString(),
      ).toBe('safe');
      expect(await Effect.runPromise(storage.getObject('updates/missing'))).toBeNull();
    });
  });
  it.each([
    '../escape',
    '../../escape',
    '/absolute',
    'C:\\escape',
    'nested/../escape',
    'nested\\escape',
    'nested//escape',
  ])('rejects read and write key %s', async (objectKey) => {
    await withStorage(async (storage) => {
      await expect(
        Effect.runPromise(storage.putObject(objectKey, 'unsafe', 'text/plain')),
      ).rejects.toThrow();
      await expect(Effect.runPromise(storage.getObject(objectKey))).rejects.toThrow();
      expect(storage.publicUrl(objectKey)).toBe('about:blank#invalid-storage-key');
    });
  });
  it('rejects existing and dangling symlinks without reading or overwriting outside files', async () => {
    await withStorage(async (storage, directory) => {
      const outside = join(directory, 'outside');
      const objects = join(directory, 'storage', 'objects');
      mkdirSync(outside);
      mkdirSync(objects, { recursive: true });
      writeFileSync(join(outside, 'secret'), 'unchanged');
      symlinkSync(outside, join(objects, 'linked'));
      symlinkSync(join(outside, 'new-secret'), join(objects, 'dangling'));
      await expect(Effect.runPromise(storage.getObject('linked/secret'))).rejects.toThrow();
      await expect(
        Effect.runPromise(storage.putObject('linked/secret', 'unsafe', 'text/plain')),
      ).rejects.toThrow();
      await expect(
        Effect.runPromise(storage.putObject('dangling', 'unsafe', 'text/plain')),
      ).rejects.toThrow();
      expect(readFileSync(join(outside, 'secret'), 'utf8')).toBe('unchanged');
    });
  });
});
