import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import { makeFakeAscClient, makeFakePlayReportingClient } from '@testkit/storeClients.testkit.js';
import { AppleStoreClientService } from '../services/appleStoreClient.js';
import { makeLaunchEnvironmentTest } from '../services/environment.js';
import { makeGoogleAccessTokenTest } from '../services/googleAccessToken.js';
import { GoogleReportingClientService } from '../services/googleReportingClient.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';
import type { ServiceAccount } from '../types/credentials.js';
import {
  makeStatsCredentialsTest,
  StatsCredentials,
  StatsCredentialsLive,
} from './statsCredentials.js';

const SERVICE_ACCOUNT: ServiceAccount = {
  clientEmail: 'robot@project.iam.gserviceaccount.com',
  privateKey: 'not-a-real-key',
  tokenUri: 'http://127.0.0.1:1/token',
};

const ACCOUNTS_FILE = JSON.stringify({
  active: 'KEYA',
  accounts: [
    { keyId: 'KEYA', issuerId: 'issuer-a', label: 'alpha', addedAt: 't', vendorNumber: '111' },
    { keyId: 'KEYB', issuerId: 'issuer-b', label: 'beta', addedAt: 't' },
  ],
});

describe('makeStatsCredentialsTest', () => {
  const readCredentials = (overrides = {}) =>
    Effect.runPromise(StatsCredentials.pipe(Effect.provide(makeStatsCredentialsTest(overrides))));

  test('answers null for every method by default', async () => {
    const credentials = await readCredentials();

    expect(await Effect.runPromise(credentials.ascClientForAccount('KEYA'))).toBeNull();
    expect(await Effect.runPromise(credentials.vendorNumberForAccount('KEYA'))).toBeNull();
    expect(await Effect.runPromise(credentials.playServiceAccount())).toBeNull();
    expect(await Effect.runPromise(credentials.playReportingClient())).toBeNull();
    expect(await Effect.runPromise(credentials.playReportsBucket())).toBeNull();
    expect(await Effect.runPromise(credentials.googleAccessToken(['scope']))).toBeNull();
  });

  test('uses the answer a test passes in', async () => {
    const playClient = makeFakePlayReportingClient([]);

    const credentials = await readCredentials({
      playReportingClient: () => Effect.succeed(playClient),
    });

    expect(await Effect.runPromise(credentials.playReportingClient())).toBe(playClient);
  });
});

describe('StatsCredentialsLive', () => {
  let homeDirectory: string;
  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE);
  });
  afterEach(() => {
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const ascClient = makeFakeAscClient([]);
  const playClient = makeFakePlayReportingClient([]);

  const readCredentials = (
    storedSecrets: Map<string, string>,
    environmentVariables: Record<string, string | undefined> = {},
  ) => {
    const dependencies = Layer.mergeAll(
      makeLaunchHomeTest(homeDirectory),
      makeLaunchSecretStoreTest(storedSecrets),
      makeLaunchEnvironmentTest(environmentVariables),
      makeGoogleAccessTokenTest(SERVICE_ACCOUNT, 'token-1'),
      Layer.succeed(AppleStoreClientService, {
        createClient: () => Effect.die('unused'),
        createEffectClient: () => Effect.succeed(ascClient),
        createReleaseAttributesClient: () => Effect.die('unused'),
      }),
      Layer.succeed(GoogleReportingClientService, {
        createClient: () => Effect.succeed(playClient),
      }),
    );
    return Effect.runPromise(
      StatsCredentials.pipe(Effect.provide(StatsCredentialsLive), Effect.provide(dependencies)),
    );
  };
  const encodedP8 = Buffer.from(
    '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
  ).toString('base64');

  test('builds the App Store client of the account that owns the key id', async () => {
    const credentials = await readCredentials(new Map([['asc-p8:KEYB', encodedP8]]));

    const builtClient = await Effect.runPromise(credentials.ascClientForAccount('KEYB'));

    expect(builtClient).toBe(ascClient);
  });

  test('answers null for an account with no saved key and for an unknown account', async () => {
    const credentials = await readCredentials(new Map());

    expect(await Effect.runPromise(credentials.ascClientForAccount('KEYA'))).toBeNull();
    expect(await Effect.runPromise(credentials.ascClientForAccount('NOPE'))).toBeNull();
  });

  test('reads the vendor number of the account, then the environment, then null', async () => {
    const withEnvironment = await readCredentials(new Map(), { ASC_VENDOR_NUMBER: '999' });
    const withoutEnvironment = await readCredentials(new Map());

    expect(await Effect.runPromise(withEnvironment.vendorNumberForAccount('KEYA'))).toBe('111');
    expect(await Effect.runPromise(withEnvironment.vendorNumberForAccount('KEYB'))).toBe('999');
    expect(await Effect.runPromise(withoutEnvironment.vendorNumberForAccount('KEYB'))).toBeNull();
  });

  test('has no Play account, client or token when no service account is saved', async () => {
    const credentials = await readCredentials(new Map());

    expect(await Effect.runPromise(credentials.playServiceAccount())).toBeNull();
    expect(await Effect.runPromise(credentials.playReportingClient())).toBeNull();
    expect(await Effect.runPromise(credentials.googleAccessToken(['scope']))).toBeNull();
  });

  test('reads the Play account, builds the reporting client and gets a token when one is saved', async () => {
    const credentials = await readCredentials(
      new Map([['play-service-account', JSON.stringify(SERVICE_ACCOUNT)]]),
    );

    expect(await Effect.runPromise(credentials.playServiceAccount())).toEqual(SERVICE_ACCOUNT);
    expect(await Effect.runPromise(credentials.playReportingClient())).toBe(playClient);
    expect(await Effect.runPromise(credentials.googleAccessToken(['scope']))).toBe('token-1');
  });

  test('reads the Play reports bucket from portfolio.json, or null when none is saved', async () => {
    const credentials = await readCredentials(new Map());
    const bucketBefore = await Effect.runPromise(credentials.playReportsBucket());
    writeLaunchHomeFile(
      homeDirectory,
      'portfolio.json',
      JSON.stringify({
        version: 1,
        discoveredAt: null,
        apps: [],
        tags: [],
        playReportsBucket: 'pubsite_prod_rev_123',
      }),
    );

    const bucketAfter = await Effect.runPromise(credentials.playReportsBucket());

    expect(bucketBefore).toBeNull();
    expect(bucketAfter).toBe('pubsite_prod_rev_123');
  });
});
