import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import { makeFakeAscClient } from '@testkit/storeClients.testkit.js';
import { makeStatsCredentialsTest } from '../stats/statsCredentials.js';
import type { PortfolioFile, PortfolioLoadMode } from '../types/portfolio.js';
import type { StatsCredentialsShape } from '../types/stats.js';
import { loadPortfolioApps } from './loadPortfolioApps.js';

const ACCOUNTS_FILE = JSON.stringify({
  active: 'KEYA',
  accounts: [
    { keyId: 'KEYA', issuerId: 'issuer-a', label: 'alpha', addedAt: 't' },
    { keyId: 'KEYB', issuerId: 'issuer-b', label: 'beta', addedAt: 't' },
  ],
});

const CACHED_FILE: PortfolioFile = {
  version: 1,
  discoveredAt: '2026-10-01T00:00:00.000Z',
  apps: [
    {
      key: 'ios-1',
      platform: 'ios',
      storeId: '1',
      name: 'Cached One',
      bundleId: null,
      packageName: null,
      accountKeyId: 'KEYA',
      accountLabel: 'alpha',
    },
    {
      key: 'ios-2',
      platform: 'ios',
      storeId: '2',
      name: 'Cached Two',
      bundleId: null,
      packageName: null,
      accountKeyId: 'KEYB',
      accountLabel: 'beta',
    },
  ],
  tags: [{ appKey: 'ios-1', owner: 'mine', ga4PropertyId: null }],
  playReportsBucket: null,
};

describe('loadPortfolioApps', () => {
  let homeDirectory: string;
  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE);
  });
  afterEach(() => {
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const load = (mode: PortfolioLoadMode, credentials: Partial<StatsCredentialsShape>) =>
    Effect.runPromise(
      loadPortfolioApps(mode).pipe(
        Effect.provide(makeStatsCredentialsTest(credentials)),
        Effect.provide(makeLaunchHomeTest(homeDirectory)),
      ),
    );
  const readSavedFile = (): PortfolioFile =>
    JSON.parse(readFileSync(join(homeDirectory, '.launch', 'portfolio.json'), 'utf8'));
  const answerWithFreshApps: Partial<StatsCredentialsShape> = {
    ascClientForAccount: (keyId) =>
      Effect.succeed(
        makeFakeAscClient([
          { id: keyId === 'KEYA' ? '1' : '2', name: `Fresh ${keyId}`, bundleId: null },
        ]),
      ),
  };

  test('cache-first uses the saved file without asking the stores', async () => {
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', JSON.stringify(CACHED_FILE));

    const portfolioLoad = await load('cache-first', {});

    expect(portfolioLoad.isFromCache).toBe(true);
    expect(portfolioLoad.apps.map((app) => app.name)).toEqual(['Cached One', 'Cached Two']);
    expect(portfolioLoad.apps[0]?.owner).toBe('mine');
  });

  test('cache-first discovers and saves when there is no saved file', async () => {
    const portfolioLoad = await load('cache-first', answerWithFreshApps);

    expect(portfolioLoad.isFromCache).toBe(false);
    expect(readSavedFile().apps.map((app) => app.name)).toEqual(['Fresh KEYA', 'Fresh KEYB']);
  });

  test('discover saves the fresh apps and keeps the tags', async () => {
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', JSON.stringify(CACHED_FILE));

    const portfolioLoad = await load('discover', answerWithFreshApps);

    expect(portfolioLoad.isFromCache).toBe(false);
    expect(portfolioLoad.apps.map((app) => [app.name, app.owner])).toEqual([
      ['Fresh KEYA', 'mine'],
      ['Fresh KEYB', null],
    ]);
    expect(readSavedFile().discoveredAt).not.toBe(CACHED_FILE.discoveredAt);
    expect(readSavedFile().tags).toEqual(CACHED_FILE.tags);
  });

  test('discover keeps the cached apps of an account that failed and warns', async () => {
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', JSON.stringify(CACHED_FILE));

    const portfolioLoad = await load('discover', {
      ascClientForAccount: (keyId) => {
        if (keyId === 'KEYB') return Effect.succeed(makeFakeAscClient(new Error('401')));
        return Effect.succeed(makeFakeAscClient([{ id: '1', name: 'Fresh One', bundleId: null }]));
      },
    });

    expect(portfolioLoad.apps.map((app) => app.name)).toEqual(['Fresh One', 'Cached Two']);
    expect(portfolioLoad.warnings.map((warning) => warning.accountLabel)).toEqual(['beta']);
    expect(portfolioLoad.isFromCache).toBe(false);
  });

  test('discover answers from the saved file and does not overwrite it when every store fails', async () => {
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', JSON.stringify(CACHED_FILE));

    const portfolioLoad = await load('discover', {
      ascClientForAccount: () => Effect.succeed(makeFakeAscClient(new Error('offline'))),
    });

    expect(portfolioLoad.isFromCache).toBe(true);
    expect(portfolioLoad.warnings).toHaveLength(2);
    expect(portfolioLoad.apps.map((app) => app.name)).toEqual(['Cached One', 'Cached Two']);
    expect(readSavedFile()).toEqual(CACHED_FILE);
  });

  test('discover with every store failing and no saved file returns no apps', async () => {
    const portfolioLoad = await load('discover', {});

    expect(portfolioLoad).toMatchObject({ apps: [], isFromCache: true });
    expect(portfolioLoad.warnings).toHaveLength(2);
  });

  test('discover with no accounts at all saves an empty portfolio', async () => {
    writeLaunchHomeFile(
      homeDirectory,
      'accounts.json',
      JSON.stringify({ active: null, accounts: [] }),
    );

    const portfolioLoad = await load('discover', {});

    expect(portfolioLoad).toMatchObject({ apps: [], warnings: [], isFromCache: false });
    expect(readSavedFile().apps).toEqual([]);
  });
});
