import { Effect, Layer } from 'effect';
import { NodeContext } from '@effect/platform-node';
import { makeLaunchPathsTest } from '@core/services/paths.js';
import { LaunchEnvironmentTest } from '@core/services/environment.js';
import { makeLaunchSecretStoreTest } from '@core/services/secretStore.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AppleCredentialAccountStatus,
  LocalCredentialsStore,
  LocalCredentialsStoreLive,
  type LocalCredentialsStoreService,
} from '@core/services/localCredentialsStore.js';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { AscKey } from '@core/types/credentials.js';
import type { CredentialsProvider } from '@core/types/providers.js';
import { makeLocalCredentialsProvider } from './local.js';
import type { MutableDeep } from '@core/types/mutable.js';

type LocalCredentialsTestState = {
  appleKeys: Map<string, AscKey>;
  activeAppleKeyId: string | null;
  appleAccountStatuses: readonly AppleCredentialAccountStatus[];
  androidStatuses: Readonly<
    Record<string, { keystoreAlias: string | null; hasServiceAccount: boolean }>
  >;
};

const KEY_A: AscKey = { keyId: 'AAAA1111', issuerId: 'issuer-a', p8: 'pem-a' };
const KEY_B: AscKey = { keyId: 'BBBB2222', issuerId: 'issuer-b', p8: 'pem-b' };

let credentialState: LocalCredentialsTestState = {
  appleKeys: new Map(),
  activeAppleKeyId: null,
  appleAccountStatuses: [],
  androidStatuses: {},
};

const LocalCredentialsStoreTest = Layer.succeed(LocalCredentialsStore, {
  loadAppleKey: (keyId) =>
    Effect.sync(() => {
      let selectedKeyId: string | null = credentialState.activeAppleKeyId;
      if (keyId !== undefined) selectedKeyId = keyId;
      if (selectedKeyId === null) return null;
      const selectedKey = credentialState.appleKeys.get(selectedKeyId);
      if (selectedKey === undefined) return null;
      return selectedKey;
    }),
  loadAppleSigningAssets: () => Effect.succeed(null),
  missingPlayServiceAccountMessage: () => Effect.succeed('No Play service account.'),
  loadPlayServiceAccount: () => Effect.succeed(null),
  loadAndroidKeystore: () => Effect.succeed(null),
  listAppleAccountStatuses: () => Effect.succeed(credentialState.appleAccountStatuses),
  readAndroidCredentialStatus: (packageName) => {
    if (packageName === undefined) {
      return Effect.succeed({ keystoreAlias: null, hasServiceAccount: false });
    }
    const storedStatus = credentialState.androidStatuses[packageName];
    if (storedStatus === undefined) {
      return Effect.succeed({ keystoreAlias: null, hasServiceAccount: false });
    }
    return Effect.succeed(storedStatus);
  },
} satisfies LocalCredentialsStoreService);

const runWithLocalCredentials = <Success, Failure>(
  useProvider: (provider: CredentialsProvider) => Effect.Effect<Success, Failure>,
): Promise<Success> =>
  Effect.runPromise(
    makeLocalCredentialsProvider().pipe(
      Effect.flatMap(useProvider),
      Effect.provide(LocalCredentialsStoreTest),
    ),
  );

/** Build context containing only the fields the local credentials provider reads. */
const iosContext = (account?: string): ResolvedBuildContext => {
  const buildContext: MutableDeep<ResolvedBuildContext> = {
    platform: 'ios',
    app: {
      name: 'sampleapp',
      dir: '/tmp/sampleapp',
      configPath: '/tmp/sampleapp/app.json',
      bundleId: 'com.x.sampleapp',
    },
    profile: { name: 'production' },
    env: {},
    explain: false,
    dryRun: false,
    forceClean: false,
  };
  if (account !== undefined) buildContext.account = account;
  return buildContext;
};

describe('localCredentialsProvider.resolveBuildCredentials (iOS account selection)', () => {
  beforeEach(() => {
    credentialState = {
      appleKeys: new Map([
        ['AAAA1111', KEY_A],
        ['BBBB2222', KEY_B],
      ]),
      activeAppleKeyId: 'AAAA1111',
      appleAccountStatuses: [],
      androidStatuses: {},
    };
  });

  it("loads the active account's key when the context names none", async () => {
    const buildCredentials = await runWithLocalCredentials((provider) =>
      provider.resolveBuildCredentials(iosContext()),
    );
    expect(buildCredentials.platform).toBe('ios');
    if (buildCredentials.platform === 'ios') expect(buildCredentials.ascKey).toEqual(KEY_A);
  });

  it("loads the context's named account, overriding the active one", async () => {
    const buildCredentials = await runWithLocalCredentials((provider) =>
      provider.resolveBuildCredentials(iosContext('BBBB2222')),
    );
    if (buildCredentials.platform === 'ios') expect(buildCredentials.ascKey).toEqual(KEY_B);
  });

  it('returns an actionable failure when no account is available', async () => {
    credentialState.activeAppleKeyId = null;
    const credentialResolution = await Effect.runPromise(
      makeLocalCredentialsProvider().pipe(
        Effect.flatMap((provider) => provider.resolveBuildCredentials(iosContext())),
        Effect.either,
        Effect.provide(LocalCredentialsStoreTest),
      ),
    );
    expect(credentialResolution).toMatchObject({
      _tag: 'Left',
      left: {
        _tag: 'MissingCredentialsFailure',
        platform: 'apple',
        message: 'No App Store Connect API key found. Import one with: launch creds set-key',
      },
    });
  });
});

describe('localCredentialsProvider.status', () => {
  beforeEach(() => {
    credentialState.appleAccountStatuses = [
      {
        keyId: 'AAAA1111',
        label: 'Personal',
        summary: 'team TEAM1 - key AAAA1111',
        active: true,
        unresolved: false,
        certificateSerial: null,
        profileCount: 0,
      },
    ];
    credentialState.androidStatuses = {};
  });

  it('lists each account with the active one marked', async () => {
    const status = await runWithLocalCredentials((provider) => provider.status());
    expect(status).toContain('iOS accounts (1):');
    expect(status).toContain('Personal <- active');
    expect(status).toContain('team TEAM1');
  });

  it("surfaces the account's apps with a +N overflow", async () => {
    credentialState.appleAccountStatuses = [
      {
        keyId: 'AAAA1111',
        label: 'Personal',
        summary: 'Larkspur, Beacon, Cypress +2 - team TEAM1 - key AAAA1111',
        active: true,
        unresolved: false,
        certificateSerial: null,
        profileCount: 0,
      },
    ];
    const status = await runWithLocalCredentials((provider) => provider.status());
    expect(status).toContain('Larkspur, Beacon, Cypress +2');
  });

  it('flags an unresolved account so the fix is one command away', async () => {
    credentialState.appleAccountStatuses = [
      {
        keyId: 'AAAA1111',
        label: 'Personal',
        summary: 'key AAAA1111',
        active: true,
        unresolved: true,
        certificateSerial: null,
        profileCount: 0,
      },
    ];
    const status = await runWithLocalCredentials((provider) => provider.status());
    expect(status).toContain('unresolved - run `launch creds refresh`');
  });

  it('reports an empty registry plainly', async () => {
    credentialState.appleAccountStatuses = [];
    const status = await runWithLocalCredentials((provider) => provider.status());
    expect(status).toContain('no Apple account imported');
  });

  it('checks Android credentials against each configured app package', async () => {
    credentialState.androidStatuses = {
      'com.x.sampleapp': { keystoreAlias: 'upload-key', hasServiceAccount: true },
    };
    const status = await runWithLocalCredentials((provider) =>
      provider.status(['com.x.sampleapp']),
    );
    expect(status).toContain(
      'com.x.sampleapp: Android: service account present; upload keystore (alias upload-key).',
    );
  });
});

describe('legacy Android build guidance', () => {
  it('tells a legacy-only user how to adopt for the selected app', async () => {
    const legacyAccount = Buffer.from(
      JSON.stringify({ client_email: 'robot@example.invalid', private_key: 'dummy' }),
    ).toString('base64');
    const context: ResolvedBuildContext = {
      ...iosContext(),
      platform: 'android',
      app: {
        name: 'demo',
        dir: '/tmp/launch-legacy-guidance',
        configPath: '/tmp/launch-legacy-guidance/app.json',
        packageName: 'com.example.demo',
      },
    };
    const outcome = await Effect.runPromise(
      makeLocalCredentialsProvider().pipe(
        Effect.flatMap((provider) => provider.resolveBuildCredentials(context)),
        Effect.either,
        Effect.provide(LocalCredentialsStoreLive),
        Effect.provide(LaunchEnvironmentTest),
        Effect.provide(NodeContext.layer),
        Effect.provide(
          makeLaunchPathsTest('/tmp/launch-legacy-guidance', '/tmp/launch-legacy-guidance'),
        ),
        Effect.provide(
          makeLaunchSecretStoreTest(new Map([['play-service-account', legacyAccount]])),
        ),
      ),
    );
    expect(outcome._tag).toBe('Left');
    if (outcome._tag !== 'Left') throw new Error('Expected missing credentials');
    expect(JSON.stringify(outcome.left)).toContain(
      'launch creds adopt --platform android --app <name>',
    );
  });
});
