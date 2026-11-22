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
    installCredentialReader();
  });

  afterEach(() => {
    useCredentialsReader(null);
  });

  it("loads the active account's key when the context names none", async () => {
    const provider = makeLocalCredentialsProvider();
    const buildCredentials = await provider.resolveBuildCredentials(iosContext());

    expect(buildCredentials.platform).toBe('ios');

    if (buildCredentials.platform == 'ios') {
      expect(buildCredentials.ascKey).toEqual(KEY_A);
    }
  });

  it("loads the context's named account, overriding the active one", async () => {
    const provider = makeLocalCredentialsProvider();
    const buildCredentials = await provider.resolveBuildCredentials(iosContext('BBBB2222'));

    if (buildCredentials.platform == 'ios') {
      expect(buildCredentials.ascKey).toEqual(KEY_B);
    }
  });

  it('returns an actionable failure when no account is available', async () => {
    credentialState.activeAppleKeyId = null;
    const provider = makeLocalCredentialsProvider();

    await expect(provider.resolveBuildCredentials(iosContext())).rejects.toMatchObject({
      _tag: 'MissingCredentialsFailure',
      platform: 'apple',
      message: 'No App Store Connect API key found. Import one with: launch creds set-key',
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
    installCredentialReader();
  });

  afterEach(() => {
    useCredentialsReader(null);
  });

  it('lists each account with the active one marked', async () => {
    const provider = makeLocalCredentialsProvider();
    const status = await provider.status();

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
    const provider = makeLocalCredentialsProvider();
    const status = await provider.status();

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
    const provider = makeLocalCredentialsProvider();
    const status = await provider.status();

    expect(status).toContain('unresolved - run `launch creds refresh`');
  });

  it('reports an empty registry plainly', async () => {
    credentialState.appleAccountStatuses = [];
    const provider = makeLocalCredentialsProvider();
    const status = await provider.status();

    expect(status).toContain('no Apple account imported');
  });

  it('checks Android credentials against each configured app package', async () => {
    credentialState.androidStatuses = {
      'com.x.sampleapp': { keystoreAlias: 'upload-key', hasServiceAccount: true },
    };
    const provider = makeLocalCredentialsProvider();
    const status = await provider.status(['com.x.sampleapp']);

    expect(status).toContain(
      'com.x.sampleapp: Android: service account present; upload keystore (alias upload-key).',
    );
  });
});

describe('legacy Android build guidance', () => {
  let homeDirectory: string;

  beforeEach(() => {
    homeDirectory = mkdtempSync(join(tmpdir(), 'launch-legacy-guidance-'));
    useCredentialsReader(null);
    useLaunchDirectories({ homeDirectory, workingDirectory: homeDirectory });
    useLaunchEnvironment({});
    const legacyAccount = Buffer.from(
      JSON.stringify({ client_email: 'robot@example.invalid', private_key: 'dummy' }),
    ).toString('base64');
    useSecretStore(new Map([['play-service-account', legacyAccount]]));
  });

  afterEach(() => {
    useCredentialsReader(null);
    resetLaunchDirectories();
    resetLaunchEnvironment();
    resetSecretStore();
    rmSync(homeDirectory, { recursive: true, force: true });
  });

  it('tells a legacy-only user how to adopt for the selected app', async () => {
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
  });
});
