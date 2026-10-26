import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaunchEnvironmentTest } from '../services/environment.js';
import { createLogger, makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';
import {
  ensureUploadKeystore,
  loadCachedKeystore,
  loadServiceAccount,
  storeServiceAccount,
} from './androidKeystore.js';

vi.mock('../services/exec.js', () => ({
  captureCommandOutput: () => Effect.succeed('verified dummy keystore'),
}));
const temporaryRoots: string[] = [];
afterEach(() => {
  for (const directory of temporaryRoots.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const makeCredentialSandbox = () => {
  const directory = mkdtempSync(join(tmpdir(), 'launch-android-isolation-'));
  temporaryRoots.push(directory);
  const secrets = new Map<string, string>();
  const run = <Success, Failure>(
    program: Effect.Effect<
      Success,
      Failure,
      Effect.Effect.Context<ReturnType<typeof ensureUploadKeystore>>
    >,
  ) =>
    Effect.runPromise(
      program.pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(LaunchEnvironmentTest),
        Effect.provide(makeLaunchPathsTest(directory, join(directory, 'project'))),
        Effect.provide(makeLaunchSecretStoreTest(secrets)),
      ),
    );
  return { directory, secrets, run };
};

const serviceAccount = (label: string) =>
  JSON.stringify({ client_email: `${label}@example.invalid`, private_key: `dummy-${label}` });

describe('Android package credential isolation', () => {
  it('isolates Play accounts and never falls back to an unscoped account', async () => {
    const sandbox = makeCredentialSandbox();
    await sandbox.run(storeServiceAccount(serviceAccount('legacy')));
    await sandbox.run(storeServiceAccount(serviceAccount('alpha'), 'com.example.alpha'));
    expect(await sandbox.run(loadServiceAccount('com.example.alpha'))).toBe(
      serviceAccount('alpha'),
    );
    expect(await sandbox.run(loadServiceAccount('com.example.beta'))).toBeNull();
    expect(await sandbox.run(loadServiceAccount())).toBe(serviceAccount('legacy'));
  });
  it('imports different app keys concurrently and honors an explicit replacement before the cache', async () => {
    const sandbox = makeCredentialSandbox();
    const alphaInput = join(sandbox.directory, 'alpha.jks');
    const betaInput = join(sandbox.directory, 'beta.jks');
    writeFileSync(alphaInput, 'dummy alpha key');
    writeFileSync(betaInput, 'dummy beta key');
    const importForPackage = (packageName: string, inputPath: string, password: string) =>
      Effect.gen(function* () {
        const logger = yield* createLogger(false);
        return yield* ensureUploadKeystore({
          appName: 'same-display-name',
          packageName,
          log: logger,
          dryRun: false,
          confirmCreate: () => Effect.dieMessage('must not generate a new upload key'),
          import: {
            path: inputPath,
            alias: packageName,
            storePassword: password,
            keyPassword: password,
          },
        });
      }).pipe(Effect.provide(makeLaunchLoggerTest([])));
    const [alpha, beta] = await sandbox.run(
      Effect.all(
        [
          importForPackage('com.example.alpha', alphaInput, 'alpha-password'),
          importForPackage('com.example.beta', betaInput, 'beta-password'),
        ],
        { concurrency: 'unbounded' },
      ),
    );
    expect(alpha.path).not.toBe(beta.path);
    expect(readFileSync(alpha.path, 'utf8')).toBe('dummy alpha key');
    expect(readFileSync(beta.path, 'utf8')).toBe('dummy beta key');
    expect((await sandbox.run(loadCachedKeystore('com.example.alpha')))?.storePassword).toBe(
      'alpha-password',
    );
    expect((await sandbox.run(loadCachedKeystore('com.example.beta')))?.storePassword).toBe(
      'beta-password',
    );
    expect(await sandbox.run(loadCachedKeystore('com.example.gamma'))).toBeNull();
    const replacement = await sandbox.run(
      importForPackage('com.example.alpha', betaInput, 'replacement-password'),
    );
    expect(replacement.storePassword).toBe('replacement-password');
    expect(readFileSync(replacement.path, 'utf8')).toBe('dummy beta key');
    expect((await sandbox.run(loadCachedKeystore('com.example.beta')))?.storePassword).toBe(
      'beta-password',
    );
  });
});
