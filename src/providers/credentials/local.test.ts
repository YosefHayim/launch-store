import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resetLaunchEnvironment,
  useLaunchEnvironment,
} from '../../services/platform/environment.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../../services/platform/paths.ts';
import { resetSecretStore, useSecretStore } from '../../services/credentials/secret-store.ts';
import type { AppleCredentialAccountStatus } from '../../services/credentials/local-credentials-store.ts';
import type { ResolvedBuildContext } from '../../types/config.ts';
import type { AscKey } from '../../types/credentials.ts';
import type { MutableDeep } from '../../types/mutable.ts';
import { makeLocalCredentialsProvider, useCredentialsReader } from './local.ts';

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

function installCredentialReader(): void {
  useCredentialsReader({
    async loadAppleKey(keyId) {
      let selectedKeyId: string | null = credentialState.activeAppleKeyId;

      if (keyId != null) {
        selectedKeyId = keyId;
      }

      if (selectedKeyId == null) {
        return null;
      }

      const selectedKey = credentialState.appleKeys.get(selectedKeyId);

      if (selectedKey == null) {
        return null;
      }

      return selectedKey;
    },
    async loadAppleSigningAssets() {
      return null;
    },
    async describeMissingPlayServiceAccount() {
      return 'No Play service account.';
    },
    async loadPlayServiceAccount() {
      return null;
    },
    async loadAndroidKeystore() {
      return null;
    },
    async listAppleAccountStatuses() {
      return credentialState.appleAccountStatuses;
    },
    async readAndroidCredentialStatus(packageName) {
      const storedStatus = credentialState.androidStatuses[packageName];

      if (storedStatus == null) {
        return { keystoreAlias: null, hasServiceAccount: false };
      }

      return storedStatus;
    },
  });
}

function iosContext(account?: string): ResolvedBuildContext {
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

  if (account != null) {
    buildContext.account = account;
  }

  return buildContext;
}

function describeLocalCredentialsProviderResolveBuildCredentialsIOSAccountSelection() {
  function prepareLocalCredentialsProviderResolveBuildCredentialsIOSAccountSelection() {
    credentialState = {
      appleKeys: new Map([
        ['AAAA1111', KEY_A],
        ['BBBB2222', KEY_B],
      ]),
      activeAppleKeyId: 'AAAA1111',
      appleAccountStatuses: [],
      androidStatuses: {},
    };
    installCredentialReader();
  }

  beforeEach(prepareLocalCredentialsProviderResolveBuildCredentialsIOSAccountSelection);

  function cleanupLocalCredentialsProviderResolveBuildCredentialsIOSAccountSelection() {
    useCredentialsReader(null);
  }

  afterEach(cleanupLocalCredentialsProviderResolveBuildCredentialsIOSAccountSelection);

  async function loadsTheActiveAccountSKeyWhenThePieceNamesNone() {
    const provider = makeLocalCredentialsProvider();
    const ios = iosContext();
    const buildCredentials = await provider.resolveBuildCredentials(ios);

    expect(buildCredentials.platform).toBe('ios');

    if (buildCredentials.platform == 'ios') {
      expect(buildCredentials.ascKey).toEqual(KEY_A);
    }
  }

  it(
    "loads the active account's key when the context names none",
    loadsTheActiveAccountSKeyWhenThePieceNamesNone,
  );

  async function loadsThePieceSNamedAccountOverridingTheActiveOne() {
    const provider = makeLocalCredentialsProvider();
    const ios = iosContext('BBBB2222');
    const buildCredentials = await provider.resolveBuildCredentials(ios);

    if (buildCredentials.platform == 'ios') {
      expect(buildCredentials.ascKey).toEqual(KEY_B);
    }
  }

  it(
    "loads the context's named account, overriding the active one",
    loadsThePieceSNamedAccountOverridingTheActiveOne,
  );

  async function returnsAnActionableFailureWhenNoAccountIsAvailable() {
    credentialState.activeAppleKeyId = null;

    const provider = makeLocalCredentialsProvider();

    const ios = iosContext();

    await expect(provider.resolveBuildCredentials(ios)).rejects.toMatchObject({
      _tag: 'MissingCredentialsFailure',
      platform: 'apple',
      message: 'No App Store Connect API key found. Import one with: launch-store creds set-key',
    });
  }

  it(
    'returns an actionable failure when no account is available',
    returnsAnActionableFailureWhenNoAccountIsAvailable,
  );
}

describe(
  'localCredentialsProvider.resolveBuildCredentials (iOS account selection)',
  describeLocalCredentialsProviderResolveBuildCredentialsIOSAccountSelection,
);

function describeLocalCredentialsProviderStatus() {
  function prepareLocalCredentialsProviderStatus() {
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
    installCredentialReader();
  }

  beforeEach(prepareLocalCredentialsProviderStatus);

  function cleanupLocalCredentialsProviderStatus() {
    useCredentialsReader(null);
  }

  afterEach(cleanupLocalCredentialsProviderStatus);

  async function listsEachAccountWithTheActiveOneMarked() {
    const provider = makeLocalCredentialsProvider();
    const status = await provider.status();

    expect(status).toContain('iOS accounts (1):');
    expect(status).toContain('Personal <- active');
    expect(status).toContain('team TEAM1');
  }

  it('lists each account with the active one marked', listsEachAccountWithTheActiveOneMarked);

  async function surfacesTheAccountSAppsWithANOverflow() {
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

    const provider = makeLocalCredentialsProvider();
    const status = await provider.status();

    expect(status).toContain('Larkspur, Beacon, Cypress +2');
  }

  it("surfaces the account's apps with a +N overflow", surfacesTheAccountSAppsWithANOverflow);

  async function flagsAnUnresolvedAccountSoTheFixIsOneCommandAway() {
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

    const provider = makeLocalCredentialsProvider();
    const status = await provider.status();

    expect(status).toContain('unresolved - run `launch-store creds refresh`');
  }

  it(
    'flags an unresolved account so the fix is one command away',
    flagsAnUnresolvedAccountSoTheFixIsOneCommandAway,
  );

  async function reportsAnEmptyRegistryPlainly() {
    credentialState.appleAccountStatuses = [];

    const provider = makeLocalCredentialsProvider();
    const status = await provider.status();

    expect(status).toContain('no Apple account imported');
  }

  it('reports an empty registry plainly', reportsAnEmptyRegistryPlainly);

  async function checksAndroidCredentialsAgainstEachConfiguredAppPackage() {
    credentialState.androidStatuses = {
      'com.x.sampleapp': { keystoreAlias: 'upload-key', hasServiceAccount: true },
    };

    const provider = makeLocalCredentialsProvider();
    const status = await provider.status(['com.x.sampleapp']);

    expect(status).toContain(
      'com.x.sampleapp: Android: service account present; upload keystore (alias upload-key).',
    );
  }

  it(
    'checks Android credentials against each configured app package',
    checksAndroidCredentialsAgainstEachConfiguredAppPackage,
  );
}

describe('localCredentialsProvider.status', describeLocalCredentialsProviderStatus);

function describeLegacyAndroidBuildGuidance() {
  let homeDirectory: string;

  function prepareLegacyAndroidBuildGuidance() {
    const systemTemporaryDirectory = tmpdir();
    const launchLegacyGuidancePath = join(systemTemporaryDirectory, 'launch-legacy-guidance-');

    homeDirectory = mkdtempSync(launchLegacyGuidancePath);
    useCredentialsReader(null);
    useLaunchDirectories({ homeDirectory, workingDirectory: homeDirectory });
    useLaunchEnvironment({});

    const serialized = JSON.stringify({
      client_email: 'robot@example.invalid',
      private_key: 'dummy',
    });
    const legacyAccount = Buffer.from(serialized).toString('base64');

    useSecretStore(new Map([['play-service-account', legacyAccount]]));
  }

  beforeEach(prepareLegacyAndroidBuildGuidance);

  function cleanupLegacyAndroidBuildGuidance() {
    useCredentialsReader(null);
    resetLaunchDirectories();
    resetLaunchEnvironment();
    resetSecretStore();
    rmSync(homeDirectory, { recursive: true, force: true });
  }

  afterEach(cleanupLegacyAndroidBuildGuidance);

  async function tellsALegacyOnlyUserHowToAdoptForTheSelectedApp() {
    const provider = makeLocalCredentialsProvider();
    const context: ResolvedBuildContext = {
      ...iosContext(),
      platform: 'android',
      app: {
        name: 'demo',
        dir: homeDirectory,
        configPath: join(homeDirectory, 'app.json'),
        packageName: 'com.example.demo',
      },
    };

    await expect(provider.resolveBuildCredentials(context)).rejects.toMatchObject({
      _tag: 'MissingCredentialsFailure',
      platform: 'android',
    });
  }

  it(
    'tells a legacy-only user how to adopt for the selected app',
    tellsALegacyOnlyUserHowToAdoptForTheSelectedApp,
  );
}

describe('legacy Android build guidance', describeLegacyAndroidBuildGuidance);
