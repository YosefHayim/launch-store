import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home-testkit.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import {
  makeStatsCredentialsTest,
  useStatsCredentials,
  type AppStoreStatsClient,
  type StatsCredentialsApi,
} from '../stats/stats-credentials.ts';
import type { PortfolioFile, PortfolioLoad, PortfolioLoadMode } from '../types/portfolio.ts';
import { loadPortfolioApps } from './load-portfolio-apps.ts';

const accountsFile = JSON.stringify({
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

interface FakeAscApp {
  readonly id: string;
  readonly name: string;
  readonly bundleId: string | null;
}

function makeAscClient(appsOrFailure: readonly FakeAscApp[] | Error): AppStoreStatsClient {
  const client = {
    async listApps() {
      if (appsOrFailure instanceof Error) {
        throw appsOrFailure;
      }

      return appsOrFailure;
    },
  };

  return client as unknown as AppStoreStatsClient;
}

function freshStoreId(keyId: string): string {
  if (keyId == 'KEYA') {
    return '1';
  }

  return '2';
}

async function ascClientForFreshApps(keyId: string): Promise<AppStoreStatsClient | null> {
  const storeId = freshStoreId(keyId);

  return makeAscClient([{ id: storeId, name: `Fresh ${keyId}`, bundleId: null }]);
}

const answerWithFreshApps: Partial<StatsCredentialsApi> = {
  ascClientForAccount: ascClientForFreshApps,
};

describe('loadPortfolioApps', () => {
  let homeDirectory: string;

  beforeEach(function setPortfolioHome() {
    homeDirectory = createTemporaryHomeDirectory();
    const workPath = join(homeDirectory, 'work');
    useLaunchDirectories({
      homeDirectory,
      workingDirectory: workPath,
    });
    writeLaunchHomeFile(homeDirectory, 'accounts.json', accountsFile);
  });

  afterEach(function resetPortfolioHome() {
    useStatsCredentials(null);
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  });

  async function load(
    mode: PortfolioLoadMode,
    credentials: Partial<StatsCredentialsApi>,
  ): Promise<PortfolioLoad> {
    makeStatsCredentialsTest(credentials);

    return loadPortfolioApps(mode);
  }

  function readSavedFile(): PortfolioFile {
    const portfolioPath = join(homeDirectory, '.launch', 'portfolio.json');
    const loadedFile = readFileSync(portfolioPath, 'utf8');
    return JSON.parse(loadedFile);
  }

  test('cache-first uses the saved file without asking the stores', async () => {
    const serialized = JSON.stringify(CACHED_FILE);
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', serialized);

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
    const serialized = JSON.stringify(CACHED_FILE);
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', serialized);

    const portfolioLoad = await load('discover', answerWithFreshApps);

    expect(portfolioLoad.isFromCache).toBe(false);
    expect(portfolioLoad.apps.map((app) => [app.name, app.owner])).toEqual([
      ['Fresh KEYA', 'mine'],
      ['Fresh KEYB', null],
    ]);
    const savedFile = readSavedFile();
    expect(savedFile.discoveredAt).not.toBe(CACHED_FILE.discoveredAt);
    expect(readSavedFile().tags).toEqual(CACHED_FILE.tags);
  });

  test('discover keeps the cached apps of an account that failed and warns', async () => {
    const serialized = JSON.stringify(CACHED_FILE);
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', serialized);

    async function ascClientForAccount(keyId: string): Promise<AppStoreStatsClient | null> {
      if (keyId == 'KEYB') {
        return makeAscClient(new Error('401'));
      }

      return makeAscClient([{ id: '1', name: 'Fresh One', bundleId: null }]);
    }

    const portfolioLoad = await load('discover', { ascClientForAccount });

    expect(portfolioLoad.apps.map((app) => app.name)).toEqual(['Fresh One', 'Cached Two']);
    expect(portfolioLoad.warnings.map((warning) => warning.accountLabel)).toEqual(['beta']);
    expect(portfolioLoad.isFromCache).toBe(false);
  });

  test('discover answers from the saved file and does not overwrite it when every store fails', async () => {
    const serialized = JSON.stringify(CACHED_FILE);
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', serialized);

    async function ascClientForAccount(): Promise<AppStoreStatsClient | null> {
      return makeAscClient(new Error('offline'));
    }

    const portfolioLoad = await load('discover', { ascClientForAccount });

    expect(portfolioLoad.isFromCache).toBe(true);
    expect(portfolioLoad.warnings).toHaveLength(2);
    expect(portfolioLoad.apps.map((app) => app.name)).toEqual(['Cached One', 'Cached Two']);
    const savedFile = readSavedFile();
    expect(savedFile).toEqual(CACHED_FILE);
  });

  test('discover with every store failing and no saved file returns no apps', async () => {
    const portfolioLoad = await load('discover', {});

    expect(portfolioLoad).toMatchObject({ apps: [], isFromCache: true });
    expect(portfolioLoad.warnings).toHaveLength(2);
  });

  test('discover with no accounts at all saves an empty portfolio', async () => {
    const serialized = JSON.stringify({ active: null, accounts: [] });
    writeLaunchHomeFile(homeDirectory, 'accounts.json', serialized);

    const portfolioLoad = await load('discover', {});

    expect(portfolioLoad).toMatchObject({ apps: [], warnings: [], isFromCache: false });
    const savedFile = readSavedFile();
    expect(savedFile.apps).toEqual([]);
  });
});
