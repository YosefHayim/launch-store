import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeHttpClientTest } from '@testkit/httpClient.testkit.js';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import { makeFakeAscClient } from '@testkit/storeClients.testkit.js';
import type { PortfolioFile } from '../types/portfolio.js';
import type {
  AppCoverage,
  FeedFetchReply,
  StatsCredentialsShape,
  StatsFeedFailure,
  StatsFeedPlugin,
} from '../types/stats.js';
import { makeStatsCredentialsTest } from './statsCredentials.js';
import { syncStats } from './syncStats.js';

const fakeFeed = vi.hoisted(() => ({
  reply: null as unknown,
  askedRanges: [] as unknown[],
}));

vi.mock('./feedRegistry.js', async () => {
  const { Effect: EffectModule } = await import('effect');
  const iosFeed: StatsFeedPlugin = {
    feed: 'app-store',
    isApplicable: (app) => app.platform === 'ios',
    fetchDays: (request) => {
      fakeFeed.askedRanges.push(request.range);
      const reply = fakeFeed.reply as FeedFetchReply | StatsFeedFailure;
      if ('_tag' in reply) return EffectModule.fail(reply);
      return EffectModule.succeed(reply);
    },
  };
  const androidFeed: StatsFeedPlugin = {
    feed: 'google-play',
    isApplicable: (app) => app.platform === 'android',
    fetchDays: () => EffectModule.succeed({ status: 'skipped', reason: 'not built yet' }),
  };
  return { STATS_FEED_PLUGINS: [iosFeed, androidFeed] };
});

const ACCOUNTS_FILE = JSON.stringify({
  active: 'KEYA',
  accounts: [{ keyId: 'KEYA', issuerId: 'issuer-a', label: 'alpha', addedAt: 't' }],
});

const PORTFOLIO_FILE: PortfolioFile = {
  version: 1,
  discoveredAt: '2026-10-01T00:00:00.000Z',
  apps: [
    {
      key: 'ios-1',
      platform: 'ios',
      storeId: '1',
      name: 'Cal Friend AI',
      bundleId: null,
      packageName: null,
      accountKeyId: 'KEYA',
      accountLabel: 'alpha',
    },
    {
      key: 'android-com.fit',
      platform: 'android',
      storeId: 'com.fit',
      name: 'Fit',
      bundleId: null,
      packageName: 'com.fit',
      accountKeyId: null,
      accountLabel: 'google-play',
    },
  ],
  tags: [],
};

const FETCHED_REPLY: FeedFetchReply = {
  status: 'fetched',
  stats: [{ date: '2026-10-01', feed: 'app-store', metric: 'downloads', value: 7, currency: null }],
  coveredThrough: '2026-10-28',
  notes: [],
};

describe('syncStats', () => {
  let homeDirectory: string;
  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE);
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', JSON.stringify(PORTFOLIO_FILE));
    fakeFeed.reply = FETCHED_REPLY;
    fakeFeed.askedRanges = [];
  });
  afterEach(() => {
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const sync = (
    appName: string | null,
    days: number,
    credentials: Partial<StatsCredentialsShape> = {},
  ) =>
    Effect.runPromise(
      syncStats({ appName, days }).pipe(
        Effect.provide(makeStatsCredentialsTest(credentials)),
        Effect.provide(makeHttpClientTest([])),
        Effect.provide(makeLaunchHomeTest(homeDirectory)),
      ),
    );
  const readCoverage = (appKey: string): AppCoverage =>
    JSON.parse(
      readFileSync(join(homeDirectory, '.launch', 'stats', appKey, 'coverage.json'), 'utf8'),
    );

  test('writes the fetched days and records the coverage', async () => {
    const report = await sync('cal friend', 30);

    expect(report.appFeeds).toEqual([
      { appKey: 'ios-1', feed: 'app-store', status: 'synced', statsWritten: 1, message: null },
    ]);
    const monthFile = JSON.parse(
      readFileSync(join(homeDirectory, '.launch', 'stats', 'ios-1', '2026-10.json'), 'utf8'),
    );
    expect(monthFile.stats).toHaveLength(1);
    expect(readCoverage('ios-1').feeds['app-store']).toMatchObject({
      coveredThrough: '2026-10-28',
      lastError: null,
      lastSyncedAt: report.syncedAt,
    });
  });

  test('syncs every app when no name is given and reports the skipped feed', async () => {
    const report = await sync(null, 5);

    expect(report.appFeeds.map((appFeed) => [appFeed.appKey, appFeed.status])).toEqual([
      ['ios-1', 'synced'],
      ['android-com.fit', 'skipped'],
    ]);
    expect(report.appFeeds[1]?.message).toBe('not built yet');
  });

  test('joins the feed notes into the report message', async () => {
    fakeFeed.reply = { ...FETCHED_REPLY, notes: ['month 2026-09 missing', 'currency mixed'] };

    const report = await sync('cal friend', 30);

    expect(report.appFeeds[0]?.message).toBe('month 2026-09 missing; currency mixed');
  });

  test('records a skipped feed as checked so the next read does not sync again', async () => {
    const report = await sync('fit', 5);

    expect(report.appFeeds[0]?.status).toBe('skipped');
    expect(readCoverage('android-com.fit').feeds['google-play']).toMatchObject({
      lastSyncedAt: report.syncedAt,
      lastError: null,
    });
  });

  test('asks only for the days that are not covered yet on the second run', async () => {
    await sync('cal friend', 30);
    fakeFeed.askedRanges = [];

    const secondReport = await sync('cal friend', 30);

    expect(fakeFeed.askedRanges).toHaveLength(1);
    expect(secondReport.appFeeds[0]?.status).toBe('synced');
  });

  test('reports up-to-date and does not call the feed when everything is covered', async () => {
    const coverage: AppCoverage = {
      version: 1,
      appKey: 'ios-1',
      feeds: {
        'app-store': {
          lastSyncedAt: '2026-10-29T00:00:00.000Z',
          coveredFrom: '2000-01-01',
          coveredThrough: '2999-01-01',
          lastError: null,
        },
      },
    };
    writeLaunchHomeFile(homeDirectory, 'stats/ios-1/coverage.json', JSON.stringify(coverage));

    const report = await sync('cal friend', 3);

    expect(report.appFeeds[0]).toMatchObject({ status: 'up-to-date', statsWritten: 0 });
    expect(fakeFeed.askedRanges).toHaveLength(0);
  });

  test('records a failing feed as failed with its message and keeps going', async () => {
    fakeFeed.reply = {
      _tag: 'StatsFeedFailure',
      feed: 'app-store',
      appKey: 'ios-1',
      message: 'report not ready',
      cause: null,
    } satisfies StatsFeedFailure;

    const report = await sync(null, 5);

    expect(report.appFeeds.map((appFeed) => appFeed.status)).toEqual(['failed', 'skipped']);
    expect(report.appFeeds[0]?.message).toBe('report not ready');
    expect(readCoverage('ios-1').feeds['app-store']?.lastError).toBe('report not ready');
  });

  test('finds an app that is not in the saved portfolio by discovering again', async () => {
    writeLaunchHomeFile(
      homeDirectory,
      'portfolio.json',
      JSON.stringify({ ...PORTFOLIO_FILE, apps: [] }),
    );

    const report = await sync('fresh', 5, {
      ascClientForAccount: () =>
        Effect.succeed(makeFakeAscClient([{ id: '9', name: 'Fresh App', bundleId: null }])),
    });

    expect(report.appFeeds.map((appFeed) => appFeed.appKey)).toEqual(['ios-9']);
  });

  test('fails with the known app names when the app does not exist anywhere', async () => {
    const failure = await Effect.runPromise(
      syncStats({ appName: 'zzz', days: 5 }).pipe(
        Effect.flip,
        Effect.provide(makeStatsCredentialsTest()),
        Effect.provide(makeHttpClientTest([])),
        Effect.provide(makeLaunchHomeTest(homeDirectory)),
      ),
    );

    expect(failure).toMatchObject({ _tag: 'StatsAppNotFoundFailure' });
    expect(failure.message).toContain('No app matched "zzz".');
  });
});
