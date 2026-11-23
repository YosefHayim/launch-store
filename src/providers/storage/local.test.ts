import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StorageProvider } from '../../types/providers.ts';
import { makeLocalStorageProviderResolver } from './local.ts';

const temporaryRoots: string[] = [];

async function withStorage(
  check: (storage: StorageProvider, directory: string) => Promise<void>,
): Promise<void> {
  const systemTemporaryDirectory = tmpdir();
  const launchStorageSecurityPath = join(systemTemporaryDirectory, 'launch-storage-security-');
  const directory = mkdtempSync(launchStorageSecurityPath);
  temporaryRoots.push(directory);
  const storageResolver = makeLocalStorageProviderResolver();
  const storagePath = join(directory, 'storage');
  const storage = await storageResolver.resolveStorageProvider({
    artifactDirectory: storagePath,
  });
  await check(storage, directory);
}
function cleanup() {
  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}

afterEach(cleanup);

describe('local storage containment', () => {
  it('round-trips normal nested keys and returns null for a missing object', async () => {
    await withStorage(async (storage) => {
      await storage.putObject('updates/production/manifest.json', 'safe', 'application/json');
      const storedObject = await storage.getObject('updates/production/manifest.json');
      expect(storedObject?.toString()).toBe('safe');
      expect(await storage.getObject('updates/missing')).toBeNull();
    });
  });

  it('writes and reads back a key with an at sign, a space and a version string', async () => {
    await withStorage(async (storage) => {
      const objectKey = 'builds/My App@1.0.0/app.ipa';
      await storage.putObject(objectKey, 'built', 'application/octet-stream');
      const storedObject = await storage.getObject(objectKey);
      expect(storedObject?.toString()).toBe('built');
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
      await expect(storage.putObject(objectKey, 'unsafe', 'text/plain')).rejects.toThrow();
      await expect(storage.getObject(objectKey)).rejects.toThrow();
      expect(storage.publicUrl(objectKey)).toBe('about:blank#invalid-storage-key');
    });
  });

  it('rejects existing and dangling symlinks without reading or overwriting outside files', async () => {
    await withStorage(async (storage, directory) => {
      const outside = join(directory, 'outside');
      const objects = join(directory, 'storage', 'objects');
      mkdirSync(outside);
      mkdirSync(objects, { recursive: true });
      const secretPath = join(outside, 'secret');
      writeFileSync(secretPath, 'unchanged');
      const linkedPath = join(objects, 'linked');
      symlinkSync(outside, linkedPath);
      const newSecretPath = join(outside, 'new-secret');
      const danglingPath = join(objects, 'dangling');
      symlinkSync(newSecretPath, danglingPath);
      await expect(storage.getObject('linked/secret')).rejects.toThrow();
      await expect(storage.putObject('linked/secret', 'unsafe', 'text/plain')).rejects.toThrow();
      await expect(storage.putObject('dangling', 'unsafe', 'text/plain')).rejects.toThrow();
      const joinedPath = join(outside, 'secret');
      const loadedFile = readFileSync(joinedPath, 'utf8');
      expect(loadedFile).toBe('unchanged');
    });
  });
});
