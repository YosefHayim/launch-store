import { NodeContext } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import {
  AppStoreIdentityService,
  type AppStoreIdentityService as AppStoreIdentity,
} from '../services/appStoreIdentity.js';
import {
  AppleCredentialsClientFactory,
  type AppleCredentialsClientFactory as AppleCredentialsFactory,
} from '../services/appleCredentialsClient.js';
import { LaunchEnvironmentTest } from '../services/environment.js';
import { makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { makeLaunchPromptTest } from '../services/prompt.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';
import {
  credentialSearchDirectories,
  credentialsCommandProgram,
  CredentialsCommandInputSchema,
  isCredentialDiscoveryFile,
  type CredentialsCommandFailure,
} from './command.js';

const discoveryFixture = (filePath: string) =>
  Effect.gen(function* () {
    const searchDirectories = yield* credentialSearchDirectories(
      '/Users/example',
      '/workspace/app',
    );
    return yield* isCredentialDiscoveryFile(filePath, searchDirectories);
  }).pipe(Effect.provide(NodeContext.layer));

const unusedIdentity: AppStoreIdentity = {
  verifyCredentials: () =>
    Effect.fail({
      _tag: 'AppleTransportFailure',
      message: 'identity stub is not used by pure validation tests',
      cause: 'unused',
      status: 500,
    }),
  resolveIdentity: () => Effect.succeed({ teamId: null, apps: [] }),
};

const unusedCredentialsFactory: AppleCredentialsFactory = {
  createClient: () => Effect.die('credentials client stub is not used by pure validation tests'),
};

/** Run a credentials command with testkit layers; pure validation fails before live Apple/Play. */
const runCredentialsFailure = (commandInput: unknown): Promise<CredentialsCommandFailure> =>
  Effect.runPromise(
    credentialsCommandProgram(commandInput).pipe(
      Effect.flip,
      Effect.provide(NodeContext.layer),
      Effect.provide(LaunchEnvironmentTest),
      Effect.provide(
        makeLaunchPathsTest('/tmp/launch-creds-command-test', '/tmp/launch-creds-command-test'),
      ),
      Effect.provide(makeLaunchLoggerTest([])),
      Effect.provide(makeLaunchPromptTest()),
      Effect.provide(makeLaunchSecretStoreTest()),
      Effect.provideService(AppStoreIdentityService, unusedIdentity),
      Effect.provideService(AppleCredentialsClientFactory, unusedCredentialsFactory),
    ),
  );

describe('credential discovery directories', () => {
  it('matches a key directly inside Downloads', async () => {
    await expect(
      Effect.runPromise(discoveryFixture('/Users/example/Downloads/AuthKey_ABC123.p8')),
    ).resolves.toBe(true);
  });

  it('matches a service-account key directly inside the working directory', async () => {
    await expect(
      Effect.runPromise(discoveryFixture('/workspace/app/service-account.json')),
    ).resolves.toBe(true);
  });

  it('leaves a deliberately placed key outside discovery directories untouched', async () => {
    await expect(
      Effect.runPromise(discoveryFixture('/Users/example/vault/AuthKey_ABC123.p8')),
    ).resolves.toBe(false);
  });

  it('does not match a key nested below a discovery directory', async () => {
    await expect(
      Effect.runPromise(discoveryFixture('/Users/example/Downloads/keys/AuthKey_ABC123.p8')),
    ).resolves.toBe(false);
  });
});

describe('CredentialsCommandInputSchema', () => {
  it('decodes the Commander boundary into a known credential action', () => {
    expect(
      Schema.decodeUnknownSync(CredentialsCommandInputSchema)({
        action: 'setup',
        options: { platform: 'android', yes: true },
      }),
    ).toEqual({
      action: 'setup',
      options: { platform: 'android', yes: true },
    });
  });

  it('rejects an unknown credential action before orchestration', () => {
    expect(() =>
      Schema.decodeUnknownSync(CredentialsCommandInputSchema)({
        action: 'erase-everything',
        options: {},
      }),
    ).toThrow();
  });

  it('accepts logout as a remove alias at the schema boundary', () => {
    expect(
      Schema.decodeUnknownSync(CredentialsCommandInputSchema)({
        action: 'logout',
        firstArgument: 'acme',
        options: { yes: true },
      }),
    ).toEqual({
      action: 'logout',
      firstArgument: 'acme',
      options: { yes: true },
    });
  });
});

describe('credentialsCommandProgram validation', () => {
  it('preserves the rename operation tag when arguments are missing', async () => {
    const failure = await runCredentialsFailure({
      action: 'rename',
      options: { yes: true },
    });
    expect(failure._tag).toBe('CredentialsCommandFailure');
    expect(failure.operation).toBe('rename Apple account');
    expect(failure.message).toContain('launch creds rename');
  });

  it('preserves the remove operation tag when the account selector is missing', async () => {
    const failure = await runCredentialsFailure({
      action: 'remove',
      options: { yes: true },
    });
    expect(failure._tag).toBe('CredentialsCommandFailure');
    expect(failure.operation).toBe('remove Apple account');
    expect(failure.message).toContain('launch creds remove');
  });

  it('requires an account selector for non-interactive use', async () => {
    const failure = await runCredentialsFailure({
      action: 'use',
      options: { yes: true },
    });
    expect(failure._tag).toBe('CredentialsCommandFailure');
    expect(failure.operation).toBe('use Apple account');
    expect(failure.message).toContain('account label or Key ID');
  });

  it('rejects an unknown push-key subcommand without touching the vault', async () => {
    const failure = await runCredentialsFailure({
      action: 'push-key',
      firstArgument: 'rotate',
      options: { yes: true },
    });
    expect(failure._tag).toBe('CredentialsCommandFailure');
    expect(failure.operation).toBe('run APNs command');
    expect(failure.message).toContain('import, status, or export');
  });

  it('requires a Key ID for non-interactive APNs export', async () => {
    const failure = await runCredentialsFailure({
      action: 'push-key',
      firstArgument: 'export',
      options: { yes: true },
    });
    expect(failure._tag).toBe('CredentialsCommandFailure');
    expect(failure.operation).toBe('export APNs key');
    expect(failure.message).toContain('push-key export');
  });
});

describe('set-vendor-number action', () => {
  let homeDirectory: string;
  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    writeLaunchHomeFile(
      homeDirectory,
      'accounts.json',
      JSON.stringify({
        active: 'KEYA',
        accounts: [{ keyId: 'KEYA', issuerId: 'issuer-a', label: 'alpha', addedAt: 't' }],
      }),
    );
  });
  afterEach(() => {
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const runInTemporaryHome = (options: Record<string, unknown>) => {
    const lines: string[] = [];
    const finished = Effect.runPromise(
      credentialsCommandProgram({ action: 'set-vendor-number', options }).pipe(
        Effect.either,
        Effect.provide(makeLaunchHomeTest(homeDirectory)),
        Effect.provide(LaunchEnvironmentTest),
        Effect.provide(makeLaunchLoggerTest(lines)),
        Effect.provide(makeLaunchPromptTest()),
        Effect.provide(makeLaunchSecretStoreTest()),
        Effect.provideService(AppStoreIdentityService, unusedIdentity),
        Effect.provideService(AppleCredentialsClientFactory, unusedCredentialsFactory),
      ),
    );
    return finished.then((outcome) => ({ outcome, lines }));
  };

  it('saves the vendor number on the matching account', async () => {
    const { outcome, lines } = await runInTemporaryHome({
      account: 'alpha',
      vendorNumber: ' 12345678 ',
    });

    expect(outcome._tag).toBe('Right');
    expect(lines.some((line) => line.includes('alpha'))).toBe(true);
    const savedFile = JSON.parse(
      readFileSync(join(homeDirectory, '.launch', 'accounts.json'), 'utf8'),
    );
    expect(savedFile.accounts[0].vendorNumber).toBe('12345678');
  });

  it('asks for both flags', async () => {
    const withoutAccount = await runInTemporaryHome({ vendorNumber: '1' });
    const withoutNumber = await runInTemporaryHome({ account: 'alpha' });

    expect(withoutAccount.outcome._tag).toBe('Left');
    expect(withoutNumber.outcome._tag).toBe('Left');
  });

  it('rejects a vendor number that is not digits', async () => {
    const { outcome } = await runInTemporaryHome({ account: 'alpha', vendorNumber: 'abc' });

    expect(outcome).toMatchObject({
      _tag: 'Left',
      left: { message: expect.stringContaining('digits only') },
    });
  });
});
