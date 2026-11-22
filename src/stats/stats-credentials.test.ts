import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home-testkit.ts';
import { makeFakeAscClient } from '../testkit/store-clients-testkit.ts';
import { PlayReportingClient } from '../google/play-reporting.ts';
import { resetSecretStore, useSecretStore } from '../services/credentials/secret-store.ts';
import { resetLaunchEnvironment, useLaunchEnvironment } from '../services/platform/environment.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { useAppleStoreClientFactory } from '../services/stores/apple-store-client.ts';
import {
  resetGoogleAccessToken,
  useGoogleAccessTokenFixture,
} from '../services/stores/google-access-token.ts';
import type { ServiceAccount } from '../types/credentials.ts';
import type { PlayVitalsReader } from './stats-credentials.ts';
import {
  makeStatsCredentialsTest,
  StatsCredentialsLive,
  useStatsCredentials,
} from './stats-credentials.ts';

const SERVICE_ACCOUNT: ServiceAccount = {
  clientEmail: 'robot@project.iam.gserviceaccount.com',
  privateKey: 'not-a-real-key',
  tokenUri: 'http://127.0.0.1:1/token',
};

const accountsFile = JSON.stringify({
  active: 'KEYA',
  accounts: [
    { keyId: 'KEYA', issuerId: 'issuer-a', label: 'alpha', addedAt: 't', vendorNumber: '111' },
    { keyId: 'KEYB', issuerId: 'issuer-b', label: 'beta', addedAt: 't' },
  ],
});

function createServiceAccountJson(): string {
  const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const exportedKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const privateKey = exportedKey.toString();

  return JSON.stringify({
    client_email: 'robot@project.iam.gserviceaccount.com',
    private_key: privateKey,
    token_uri: 'http://127.0.0.1:1/token',
  });
}

describe('makeStatsCredentialsTest', () => {
  afterEach(() => {
    useStatsCredentials(null);
  });

  test('answers null for every method by default', async () => {
    const credentials = makeStatsCredentialsTest();

    expect(await credentials.ascClientForAccount('KEYA')).toBeNull();
    expect(await credentials.vendorNumberForAccount('KEYA')).toBeNull();
    expect(await credentials.playServiceAccount('com.example.app')).toBeNull();
    expect(await credentials.playReportingClient('com.example.app')).toBeNull();
    expect(await credentials.playReportsBucket()).toBeNull();
    expect(await credentials.googleAccessToken(['scope'], 'com.example.app')).toBeNull();
  });

  test('uses the answer a test passes in', async () => {
    const playClient: PlayVitalsReader = {
      async vitalsTimeline() {
        throw new Error('unused');
      },
    };
    const credentials = makeStatsCredentialsTest({
      async playReportingClient() {
        return playClient;
      },
    });

    expect(await credentials.playReportingClient('com.example.app')).toBe(playClient);
  });
});

describe('StatsCredentialsLive', () => {
  let homeDirectory: string;
  const ascClient = makeFakeAscClient([]);

  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    const workPath = join(homeDirectory, 'work');
    useLaunchDirectories({
      homeDirectory,
      workingDirectory: workPath,
    });
    writeLaunchHomeFile(homeDirectory, 'accounts.json', accountsFile);
    useStatsCredentials(null);
  });

  afterEach(() => {
    useStatsCredentials(null);
    useAppleStoreClientFactory(null);
    resetGoogleAccessToken();
    resetSecretStore();
    resetLaunchEnvironment();
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  });

  function installLiveFixtures(
    storedSecrets: Map<string, string>,
    environmentVariables: Record<string, string | undefined> = {},
  ): void {
    useSecretStore(storedSecrets);
    useLaunchEnvironment(environmentVariables);
    useGoogleAccessTokenFixture(SERVICE_ACCOUNT, 'token-1');
    useAppleStoreClientFactory(function createAscClient() {
      return ascClient;
    });
  }

  const encodedP8 = Buffer.from(
    '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
  ).toString('base64');

  test('builds the App Store client of the account that owns the key id', async () => {
    installLiveFixtures(new Map([['asc-p8:KEYB', encodedP8]]));

    const builtClient = await StatsCredentialsLive.ascClientForAccount('KEYB');

    expect(builtClient).toBe(ascClient);
  });

  test('answers null for an account with no saved key and for an unknown account', async () => {
    installLiveFixtures(new Map());

    expect(await StatsCredentialsLive.ascClientForAccount('KEYA')).toBeNull();
    expect(await StatsCredentialsLive.ascClientForAccount('NOPE')).toBeNull();
  });

  test('reads the vendor number of the account, then the environment, then null', async () => {
    installLiveFixtures(new Map(), { ASC_VENDOR_NUMBER: '999' });

    expect(await StatsCredentialsLive.vendorNumberForAccount('KEYA')).toBe('111');
    expect(await StatsCredentialsLive.vendorNumberForAccount('KEYB')).toBe('999');

    useLaunchEnvironment({});

    expect(await StatsCredentialsLive.vendorNumberForAccount('KEYB')).toBeNull();
  });

  test('has no Play account, client or token when no service account is saved', async () => {
    installLiveFixtures(new Map());

    expect(await StatsCredentialsLive.playServiceAccount('com.example.app')).toBeNull();
    expect(await StatsCredentialsLive.playReportingClient('com.example.app')).toBeNull();
    expect(await StatsCredentialsLive.googleAccessToken(['scope'], 'com.example.app')).toBeNull();
  });

  test('reads the Play account, builds the reporting client and gets a token when one is saved', async () => {
    const createServiceAccount = createServiceAccountJson();
    installLiveFixtures(new Map([['play-service-account:com.example.app', createServiceAccount]]));

    expect(await StatsCredentialsLive.playServiceAccount('com.example.app')).toEqual(
      SERVICE_ACCOUNT,
    );
    expect(await StatsCredentialsLive.playReportingClient('com.example.app')).toBeInstanceOf(
      PlayReportingClient,
    );
    expect(await StatsCredentialsLive.googleAccessToken(['scope'], 'com.example.app')).toBe(
      'token-1',
    );
  });

  test('uses only the requested app slot and ignores an unscoped key', async () => {
    const serialized = JSON.stringify(SERVICE_ACCOUNT);
    installLiveFixtures(
      new Map([
        ['play-service-account:com.example.app', serialized],
        ['play-service-account', JSON.stringify(SERVICE_ACCOUNT)],
      ]),
    );

    expect(await StatsCredentialsLive.playServiceAccount('com.example.app')).toEqual(
      SERVICE_ACCOUNT,
    );
    expect(await StatsCredentialsLive.playServiceAccount('com.example.other')).toBeNull();
    expect(await StatsCredentialsLive.playServiceAccount(null)).toBeNull();
  });

  test('maps an iOS app to its uniquely matched configured Android package', async () => {
    installLiveFixtures(new Map());
    const project = join(homeDirectory, 'work');
    mkdirSync(project, { recursive: true });
    const appPath = join(project, 'app.json');
    const serialized = JSON.stringify({
      expo: {
        slug: 'demo',
        ios: { bundleIdentifier: 'com.example.ios' },
        android: { package: 'com.example.android' },
      },
    });
    writeFileSync(appPath, serialized);
    const app = {
      key: 'ios-1',
      platform: 'ios' as const,
      storeId: '1',
      name: 'Demo',
      bundleId: 'com.example.ios',
      packageName: null,
      accountKeyId: null,
      accountLabel: 'test',
      owner: null,
      ga4PropertyId: null,
    };

    expect(await StatsCredentialsLive.googlePackageForApp(app)).toBe('com.example.android');
    expect(
      await StatsCredentialsLive.googlePackageForApp({ ...app, bundleId: 'unknown' }),
    ).toBeNull();
  });

  test('reads the Play reports bucket from portfolio.json, or null when none is saved', async () => {
    installLiveFixtures(new Map());
    const bucketBefore = await StatsCredentialsLive.playReportsBucket();
    const serialized = JSON.stringify({
      version: 1,
      discoveredAt: null,
      apps: [],
      tags: [],
      playReportsBucket: 'pubsite_prod_rev_123',
    });
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', serialized);

    const bucketAfter = await StatsCredentialsLive.playReportsBucket();

    expect(bucketBefore).toBeNull();
    expect(bucketAfter).toBe('pubsite_prod_rev_123');
  });
});
