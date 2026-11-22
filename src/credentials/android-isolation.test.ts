import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSecretStore, useSecretStore } from '../services/credentials/secret-store.ts';
import { createLogger } from '../services/platform/logger.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { captureCommandOutput } from '../services/platform/exec.ts';
import {
  ensureUploadKeystore,
  loadCachedKeystore,
  loadServiceAccount,
  listStoredAndroidPackages,
  storeServiceAccount,
} from './android-keystore-assets.ts';
vi.mock('../services/platform/exec.ts', () => ({
  captureCommandOutput: vi.fn(function verifyKeystore() {
    return Promise.resolve('verified dummy keystore');
  }),
}));

const temporaryRoots: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  resetLaunchDirectories();
  resetSecretStore();

  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeCredentialSandbox() {
  const systemTemporaryDirectory = tmpdir();
  const launchAndroidIsolationPath = join(systemTemporaryDirectory, 'launch-android-isolation-');
  const directory = mkdtempSync(launchAndroidIsolationPath);
  const secrets = new Map<string, string>();

  temporaryRoots.push(directory);
  const projectPath = join(directory, 'project');
  useLaunchDirectories({
    homeDirectory: directory,
    workingDirectory: projectPath,
  });
  useSecretStore(secrets);

  return { directory, secrets };
}

function serviceAccount(label: string): string {
  return JSON.stringify({
    client_email: `${label}@example.invalid`,
    private_key: `dummy-${label}`,
  });
}

function refuseCreate(): Promise<boolean> {
  return Promise.reject(new Error('must not generate a new upload key'));
}

function allowReplace(): Promise<boolean> {
  return Promise.resolve(true);
}

describe('Android package credential isolation', () => {
  it('isolates Play accounts and never falls back to an unscoped account', async () => {
    const sandbox = makeCredentialSandbox();

    sandbox.secrets.set(
      'play-service-account',
      Buffer.from(serviceAccount('legacy')).toString('base64'),
    );
    await storeServiceAccount(serviceAccount('alpha'), 'com.example.alpha');

    expect(await loadServiceAccount('com.example.alpha')).toBe(serviceAccount('alpha'));
    expect(await loadServiceAccount('com.example.beta')).toBeNull();
    expect(sandbox.secrets.has('play-service-account')).toBe(true);
    const storedAndroidPackages = await listStoredAndroidPackages();
    expect(storedAndroidPackages).toEqual(['com.example.alpha']);
  });

  it('imports different app keys concurrently and honors an explicit replacement before the cache', async () => {
    const sandbox = makeCredentialSandbox();
    const alphaInput = join(sandbox.directory, 'alpha.jks');
    const betaInput = join(sandbox.directory, 'beta.jks');

    writeFileSync(alphaInput, 'dummy alpha key');
    writeFileSync(betaInput, 'dummy beta key');

    async function importForPackage(packageName: string, inputPath: string, password: string) {
      const logger = createLogger(false);
      return ensureUploadKeystore({
        appName: 'same-display-name',
        packageName,
        log: logger,
        dryRun: false,
        confirmCreate: refuseCreate,
        confirmReplace: allowReplace,
        import: {
          path: inputPath,
          alias: packageName,
          storePassword: password,
          keyPassword: password,
        },
      });
    }

    const [alpha, beta] = await Promise.all([
      importForPackage('com.example.alpha', alphaInput, 'alpha-password'),
      importForPackage('com.example.beta', betaInput, 'beta-password'),
    ]);

    expect(alpha.path).not.toBe(beta.path);
    const loadedFile = readFileSync(alpha.path, 'utf8');
    expect(loadedFile).toBe('dummy alpha key');
    const fileSync = readFileSync(beta.path, 'utf8');
    expect(fileSync).toBe('dummy beta key');

    const verificationCalls = vi.mocked(captureCommandOutput).mock.calls.slice(0, 2);
    const firstPassword =
      verificationCalls[0]?.[2]?.environmentOverrides?.['LAUNCH_VERIFY_DEST_PASSWORD'];
    const secondPassword =
      verificationCalls[1]?.[2]?.environmentOverrides?.['LAUNCH_VERIFY_DEST_PASSWORD'];

    expect(firstPassword).toMatch(/^[a-f0-9]{64}$/);
    expect(secondPassword).toMatch(/^[a-f0-9]{64}$/);
    expect(firstPassword).not.toBe(secondPassword);
    expect(verificationCalls[0]?.[1].join(' ')).not.toContain(firstPassword);
    const cachedKeystore = await loadCachedKeystore('com.example.alpha');
    expect(cachedKeystore?.storePassword).toBe('alpha-password');
    expect((await loadCachedKeystore('com.example.beta'))?.storePassword).toBe('beta-password');
    expect(await loadCachedKeystore('com.example.gamma')).toBeNull();

    const replacement = await importForPackage(
      'com.example.alpha',
      betaInput,
      'replacement-password',
    );

    expect(replacement.storePassword).toBe('replacement-password');
    expect(readFileSync(replacement.path, 'utf8')).toBe('dummy beta key');
    expect((await loadCachedKeystore('com.example.beta'))?.storePassword).toBe('beta-password');
  });

  it('does not generate a replacement when an existing key has missing passwords', async () => {
    const sandbox = makeCredentialSandbox();
    const input = join(sandbox.directory, 'upload.jks');

    writeFileSync(input, 'existing key');

    async function request(withImport: boolean) {
      const keystoreOptions = {
        appName: 'alpha',
        packageName: 'com.example.alpha',
        log: createLogger(false),
        dryRun: false,
        confirmCreate: function refuseGeneration() {
          return Promise.reject(new Error('must not generate'));
        },
      };

      if (withImport) {
        return ensureUploadKeystore({
          ...keystoreOptions,
          import: {
            path: input,
            alias: 'upload',
            storePassword: 'password',
            keyPassword: 'password',
          },
        });
      }

      return ensureUploadKeystore(keystoreOptions);
    }

    await request(true);
    sandbox.secrets.clear();

    await expect(request(false)).rejects.toMatchObject({
      message: expect.stringMatching(/already exists/),
    });
  });

  it('requires explicit approval before replacing a saved keystore', async () => {
    const sandbox = makeCredentialSandbox();
    const first = join(sandbox.directory, 'first.jks');
    const replacement = join(sandbox.directory, 'replacement.jks');

    writeFileSync(first, 'first key');
    writeFileSync(replacement, 'replacement key');

    function provision(path: string, confirmReplace: () => Promise<boolean>) {
      const logger = createLogger(false);
      return ensureUploadKeystore({
        appName: 'demo',
        packageName: 'com.example.app',
        log: logger,
        dryRun: false,
        confirmCreate: function declineCreate() {
          return Promise.resolve(false);
        },
        confirmReplace,
        import: { path, alias: 'upload', storePassword: 'password', keyPassword: 'password' },
      });
    }

    const original = await provision(first, function declineReplace() {
      return Promise.resolve(false);
    });

    await expect(
      provision(replacement, function declineReplace() {
        return Promise.resolve(false);
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/not replaced/),
    });
    const loadedFile = readFileSync(original.path, 'utf8');
    expect(loadedFile).toBe('first key');
  });

  it('never reuses or regenerates when only a legacy keystore exists', async () => {
    const sandbox = makeCredentialSandbox();
    const legacyDirectory = join(sandbox.directory, '.launch', 'credentials');

    mkdirSync(legacyDirectory, { recursive: true });

    const legacyPath = join(legacyDirectory, 'upload.keystore');

    writeFileSync(legacyPath, 'legacy key');
    const androidPath = join(legacyDirectory, 'android.json');
    const serialized = JSON.stringify({ keystore: { path: legacyPath, alias: 'upload' } });
    writeFileSync(androidPath, serialized);
    sandbox.secrets.set('android-keystore-store-password', 'store-password');
    sandbox.secrets.set('android-keystore-key-password', 'key-password');

    const cachedKeystore = await loadCachedKeystore('com.example.app');
    expect(cachedKeystore).toBeNull();

    let offered = false;

    const logger = createLogger(false);
    const uploadKeystore = ensureUploadKeystore({
      appName: 'demo',
      packageName: 'com.example.app',
      log: logger,
      dryRun: false,
      confirmCreate: function noteOffer() {
        offered = true;

        return Promise.resolve(false);
      },
    });
    await expect(uploadKeystore).rejects.toMatchObject({
      message: expect.stringMatching(/launch creds adopt --platform android --app 'demo'/),
    });
    expect(offered).toBe(false);
    const loadedFile = readFileSync(legacyPath, 'utf8');
    expect(loadedFile).toBe('legacy key');
  });
});
