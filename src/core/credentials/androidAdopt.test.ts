import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LaunchEnvironmentTest } from '../services/environment.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { createLogger, makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';
import {
  adoptLegacyAndroidCredentials,
  loadCachedKeystore,
  loadServiceAccount,
  ensureUploadKeystore,
} from './androidKeystore.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const setup = () => {
  const directory = mkdtempSync(join(tmpdir(), 'launch-adopt-test-'));
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
  writeFileSync(
    join(legacyDirectory, 'android.json'),
    JSON.stringify({ keystore: { path, alias: 'upload' } }),
  );
  const account = JSON.stringify({ client_email: 'test@example.invalid', private_key: 'dummy' });
  const secrets = new Map([
    ['play-service-account', Buffer.from(account).toString('base64')],
    ['android-keystore-store-password', 'storepass'],
    ['android-keystore-key-password', 'keypass'],
  ]);
  const run = <A, E>(
    program: Effect.Effect<
      A,
      E,
      Effect.Effect.Context<ReturnType<typeof adoptLegacyAndroidCredentials>>
    >,
  ) =>
    Effect.runPromise(
      program.pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(LaunchEnvironmentTest),
        Effect.provide(makeLaunchPathsTest(directory, directory)),
        Effect.provide(makeLaunchSecretStoreTest(secrets)),
      ),
    );
  return { run, secrets, path, account };
};

describe('legacy Android credential adoption', () => {
  it('validates and copies both assets without removing the originals', async () => {
    const sandbox = setup();
    const calls: string[] = [];
    await sandbox.run(
      adoptLegacyAndroidCredentials('com.example.app', false, (account, name) =>
        Effect.sync(() => {
          calls.push(account, name);
        }),
      ),
    );
    expect(calls).toEqual([sandbox.account, 'com.example.app']);
    expect(await sandbox.run(loadServiceAccount('com.example.app'))).toBe(sandbox.account);
    const adopted = await sandbox.run(loadCachedKeystore('com.example.app'));
    expect(adopted?.keyPassword).toBe('keypass');
    if (adopted === null) throw new Error('Expected an adopted keystore');
    expect(readFileSync(adopted.path)).toEqual(readFileSync(sandbox.path));
    expect(sandbox.secrets.has('play-service-account')).toBe(true);
    await expect(
      sandbox.run(adoptLegacyAndroidCredentials('com.example.app', false, () => Effect.void)),
    ).rejects.toThrow(/--yes/);
  });
  it('rejects an incorrect private key password before copying anything', async () => {
    const sandbox = setup();
    sandbox.secrets.set('android-keystore-key-password', 'wrongpass');
    await expect(
      sandbox.run(adoptLegacyAndroidCredentials('com.example.app', false, () => Effect.void)),
    ).rejects.toThrow(/Could not open/);
    expect(await sandbox.run(loadServiceAccount('com.example.app'))).toBeNull();
    expect(await sandbox.run(loadCachedKeystore('com.example.app'))).toBeNull();
  });
  it('does not copy when the Play key cannot read the package', async () => {
    const sandbox = setup();
    await expect(
      sandbox.run(
        adoptLegacyAndroidCredentials('com.example.app', false, () =>
          Effect.fail(new Error('denied')),
        ),
      ),
    ).rejects.toThrow(/denied/);
    expect(await sandbox.run(loadServiceAccount('com.example.app'))).toBeNull();
    expect(await sandbox.run(loadCachedKeystore('com.example.app'))).toBeNull();
  });
  it('rejects a wrong key password when importing a keystore', async () => {
    const sandbox = setup();
    const attempt = Effect.gen(function* () {
      const logger = yield* createLogger(false);
      return yield* ensureUploadKeystore({
        appName: 'demo',
        packageName: 'com.example.app',
        log: logger,
        dryRun: false,
        confirmCreate: () => Effect.succeed(false),
        import: {
          path: sandbox.path,
          alias: 'upload',
          storePassword: 'storepass',
          keyPassword: 'wrongpass',
        },
      });
    }).pipe(Effect.provide(makeLaunchLoggerTest([])));
    await expect(sandbox.run(attempt)).rejects.toThrow(/Could not open keystore/);
    expect(await sandbox.run(loadCachedKeystore('com.example.app'))).toBeNull();
  });
});
