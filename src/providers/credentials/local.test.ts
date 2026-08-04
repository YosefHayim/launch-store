import { Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AppleCredentialAccountStatus,
  LocalCredentialsStore,
  type LocalCredentialsStoreService,
} from '@core/services/localCredentialsStore.js';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { AscKey } from '@core/types/credentials.js';
import type { CredentialsProvider } from '@core/types/providers.js';
import { makeLocalCredentialsProvider } from './local.js';

type LocalCredentialsTestState = {
  appleKeys: Map<string, AscKey>;
  activeAppleKeyId: string | null;
  appleAccountStatuses: readonly AppleCredentialAccountStatus[];
};

const KEY_A: AscKey = { keyId: 'AAAA1111', issuerId: 'issuer-a', p8: 'pem-a' };
const KEY_B: AscKey = { keyId: 'BBBB2222', issuerId: 'issuer-b', p8: 'pem-b' };

let credentialState: LocalCredentialsTestState = {
  appleKeys: new Map(),
  activeAppleKeyId: null,
  appleAccountStatuses: [],
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
  loadPlayServiceAccount: () => Effect.succeed(null),
  loadAndroidKeystore: () => Effect.succeed(null),
  listAppleAccountStatuses: () => Effect.succeed(credentialState.appleAccountStatuses),
  readAndroidCredentialStatus: () =>
    Effect.succeed({ keystoreAlias: null, hasServiceAccount: false }),
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
  const buildContext: ResolvedBuildContext = {
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
});
