import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetSecretStore, useSecretStore } from '../services/credentials/secret-store.ts';
import { createLogger } from '../services/platform/logger.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import {
  adoptLegacyAndroidCredentials,
  ensureUploadKeystore,
  loadCachedKeystore,
  loadServiceAccount,
} from './android-keystore-assets.ts';

const directories: string[] = [];

afterEach(() => {
  resetLaunchDirectories();
  resetSecretStore();

  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function setup() {
  const systemTemporaryDirectory = tmpdir();
  const launchAdoptTestPath = join(systemTemporaryDirectory, 'launch-adopt-test-');
  const directory = mkdtempSync(launchAdoptTestPath);

  directories.push(directory);

  const legacyDirectory = join(directory, '.launch', 'credentials');

  mkdirSync(legacyDirectory, { recursive: true });

  const path = join(legacyDirectory, 'upload.keystore');

  execFileSync(
    'keytool',
    [
      '-genkeypair',
      '-noprompt',
      '-keystore',
      path,
      '-storetype',
      'JKS',
      '-alias',
      'upload',
      '-storepass',
      'storepass',
      '-keypass',
      'keypass',
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '1',
      '-dname',
      'CN=Test',
    ],
    { stdio: 'ignore' },
  );
  const androidPath = join(legacyDirectory, 'android.json');
  const serialized = JSON.stringify({ keystore: { path, alias: 'upload' } });
  writeFileSync(androidPath, serialized);

  const account = JSON.stringify({ client_email: 'test@example.invalid', private_key: 'dummy' });
  const secrets = new Map([
    ['play-service-account', Buffer.from(account).toString('base64')],
    ['android-keystore-store-password', 'storepass'],
    ['android-keystore-key-password', 'keypass'],
  ]);

  useLaunchDirectories({ homeDirectory: directory, workingDirectory: directory });
  useSecretStore(secrets);

  return { secrets, path, account };
}

function allowPlayAccess(): Promise<void> {
  return Promise.resolve();
}

describe('legacy Android credential adoption', () => {
  it('validates and copies both assets without removing the originals', async () => {
    const sandbox = setup();
    const calls: string[] = [];

    await adoptLegacyAndroidCredentials(
      'com.example.app',
      false,
      function recordAccess(account, name) {
        calls.push(account, name);

        return Promise.resolve();
      },
    );

    expect(calls).toEqual([sandbox.account, 'com.example.app']);
    const serviceAccount = await loadServiceAccount('com.example.app');
    expect(serviceAccount).toBe(sandbox.account);

    const adopted = await loadCachedKeystore('com.example.app');

    expect(adopted?.keyPassword).toBe('keypass');

    if (adopted == null) {
      throw new Error('Expected an adopted keystore');
    }

    const loadedFile = readFileSync(adopted.path);
    const fileSync = readFileSync(sandbox.path);
    expect(loadedFile).toEqual(fileSync);
    expect(sandbox.secrets.has('play-service-account')).toBe(true);
    const legacyAndroidCredentials = adoptLegacyAndroidCredentials(
      'com.example.app',
      false,
      allowPlayAccess,
    );
    await expect(legacyAndroidCredentials).rejects.toMatchObject({
      message: expect.stringMatching(/--yes/),
    });
  }, 30_000);

  it('rejects an incorrect private key password before copying anything', async () => {
    const sandbox = setup();

    sandbox.secrets.set('android-keystore-key-password', 'wrongpass');

    const legacyAndroidCredentials = adoptLegacyAndroidCredentials(
      'com.example.app',
      false,
      allowPlayAccess,
    );
    await expect(legacyAndroidCredentials).rejects.toMatchObject({
      message: expect.stringMatching(/Could not open/),
    });
    const serviceAccount = await loadServiceAccount('com.example.app');
    expect(serviceAccount).toBeNull();
    const cachedKeystore = await loadCachedKeystore('com.example.app');
    expect(cachedKeystore).toBeNull();
  }, 30_000);

  it('does not copy when the Play key cannot read the package', async () => {
    setup();

    const legacyAndroidCredentials = adoptLegacyAndroidCredentials(
      'com.example.app',
      false,
      function denyAccess() {
        return Promise.reject(new Error('denied'));
      },
    );
    await expect(legacyAndroidCredentials).rejects.toThrow(/denied/);
    const serviceAccount = await loadServiceAccount('com.example.app');
    expect(serviceAccount).toBeNull();
    const cachedKeystore = await loadCachedKeystore('com.example.app');
    expect(cachedKeystore).toBeNull();
  }, 30_000);

  it('rejects a wrong key password when importing a keystore', async () => {
    const sandbox = setup();

    const logger = createLogger(false);
    const uploadKeystore = ensureUploadKeystore({
      appName: 'demo',
      packageName: 'com.example.app',
      log: logger,
      dryRun: false,
      confirmCreate: function declineCreate() {
        return Promise.resolve(false);
      },
      import: {
        path: sandbox.path,
        alias: 'upload',
        storePassword: 'storepass',
        keyPassword: 'wrongpass',
      },
    });
    await expect(uploadKeystore).rejects.toMatchObject({
      message: expect.stringMatching(/Could not open keystore/),
    });
    const cachedKeystore = await loadCachedKeystore('com.example.app');
    expect(cachedKeystore).toBeNull();
  }, 30_000);
});
