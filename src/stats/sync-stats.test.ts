import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home-testkit.ts';
import { makeFakeAscClient } from '../testkit/store-clients-testkit.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import type { PortfolioFile } from '../types/portfolio.ts';
import type { AppCoverage, FeedFetchReply, StatsFeedFailure } from '../types/stats.ts';
import type { StatsCredentialsApi } from './stats-credentials.ts';
import { makeStatsCredentialsTest, useStatsCredentials } from './stats-credentials.ts';
import { syncStats } from './sync-stats.ts';
import type { AppFeedSyncReport } from '../types/stats.ts';

const fakeFeed = vi.hoisted(function hoistFakeFeed() {
  return {
    reply: null as unknown,
    askedRanges: [] as unknown[],
  };
});

vi.mock('./feed-registry.ts', function mockFeedRegistry() {
  function isTaggedFailure(reply: unknown): boolean {
    if (reply == null) {
      return false;
    }

    if (typeof reply != 'object') {
      return false;
    }

    return '_tag' in reply;
  }

  const iosFeed = {
    feed: 'app-store' as const,
    isApplicable(app: { platform: string }) {
      return app.platform == 'ios';
    },
    async fetchDays(request: { range: unknown }) {
      fakeFeed.askedRanges.push(request.range);

      const reply = fakeFeed.reply;

      if (isTaggedFailure(reply)) {
        throw reply;
      }

      return reply;
    },
  };
  const androidFeed = {
    feed: 'google-play' as const,
    isApplicable(app: { platform: string }) {
      return app.platform == 'android';
    },
    async fetchDays() {
      return { status: 'skipped' as const, reason: 'not built yet' };
    },
  };

  return { STATS_FEED_PLUGINS: [iosFeed, androidFeed] };
});

const accountsFile = JSON.stringify({
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
  playReportsBucket: null,
};

const FETCHED_REPLY: FeedFetchReply = {
  status: 'fetched',
  stats: [{ date: '2026-10-01', feed: 'app-store', metric: 'downloads', value: 7, currency: null }],
  coveredThrough: '2026-10-28',
  notes: [],
};

function describeSyncStats() {
  let homeDirectory: string;

  function prepareSyncStats() {
    homeDirectory = createTemporaryHomeDirectory();

    const workPath = join(homeDirectory, 'work');

    useLaunchDirectories({
      homeDirectory,
      workingDirectory: workPath,
    });
    writeLaunchHomeFile(homeDirectory, 'accounts.json', accountsFile);

    const serialized = JSON.stringify(PORTFOLIO_FILE);

    writeLaunchHomeFile(homeDirectory, 'portfolio.json', serialized);
    fakeFeed.reply = FETCHED_REPLY;
    fakeFeed.askedRanges = [];
  }

  beforeEach(prepareSyncStats);

  function cleanupSyncStats() {
    useStatsCredentials(null);
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  }

  afterEach(cleanupSyncStats);

  function sync(
    appName: string | null,
    days: number,
    credentials: Partial<StatsCredentialsApi> = {},
  ) {
    makeStatsCredentialsTest(credentials);

    return syncStats({ appName, days });
  }

  function readCoverage(appKey: string): AppCoverage {
    const coveragePath = join(homeDirectory, '.launch', 'stats', appKey, 'coverage.json');
    const loadedFile = readFileSync(coveragePath, 'utf8');
    return JSON.parse(loadedFile);
  }

  async function writesTheFetchedDaysAndRecordsTheCoverage() {
    const report = await sync('cal friend', 30);

    expect(report.appFeeds).toEqual([
      { appKey: 'ios-1', feed: 'app-store', status: 'synced', statsWritten: 1, message: null },
    ]);

    const joinedPath = join(homeDirectory, '.launch', 'stats', 'ios-1', '2026-10.json');
    const loadedFile = readFileSync(joinedPath, 'utf8');
    const monthFile = JSON.parse(loadedFile);

    expect(monthFile.stats).toHaveLength(1);

    const coverage = readCoverage('ios-1');

    expect(coverage.feeds['app-store']).toMatchObject({
      coveredThrough: '2026-10-28',
      lastError: null,
      lastSyncedAt: report.syncedAt,
    });
  }

  test(
    'writes the fetched days and records the coverage',
    writesTheFetchedDaysAndRecordsTheCoverage,
  );

  async function syncsEveryAppWhenNoNameIsGivenAndReportsTheSkippedFeed() {
    const report = await sync(null, 5);

    function readAppKeyAndStatus(appFeed: AppFeedSyncReport) {
      return [appFeed.appKey, appFeed.status];
    }

    expect(report.appFeeds.map(readAppKeyAndStatus)).toEqual([
      ['ios-1', 'synced'],
      ['android-com.fit', 'skipped'],
    ]);
    expect(report.appFeeds[1]?.message).toBe('not built yet');
  }

  test(
    'syncs every app when no name is given and reports the skipped feed',
    syncsEveryAppWhenNoNameIsGivenAndReportsTheSkippedFeed,
  );

  async function joinsTheFeedNotesIntoTheReportMessage() {
    fakeFeed.reply = { ...FETCHED_REPLY, notes: ['month 2026-09 missing', 'currency mixed'] };

    const report = await sync('cal friend', 30);

    expect(report.appFeeds[0]?.message).toBe('month 2026-09 missing; currency mixed');

    const coverage = readCoverage('ios-1');

    expect(coverage.feeds['app-store']?.lastNote).toBe('month 2026-09 missing; currency mixed');
  }

  test('joins the feed notes into the report message', joinsTheFeedNotesIntoTheReportMessage);

  async function recordsASkippedFeedAsCheckedSoTheNextReadDoesNotSyncAgain() {
    const report = await sync('fit', 5);

    expect(report.appFeeds[0]?.status).toBe('skipped');

    const coverage = readCoverage('android-com.fit');

    expect(coverage.feeds['google-play']).toMatchObject({
      lastSyncedAt: report.syncedAt,
      lastError: null,
      lastNote: 'not built yet',
    });
  }

  test(
    'records a skipped feed as checked so the next read does not sync again',
    recordsASkippedFeedAsCheckedSoTheNextReadDoesNotSyncAgain,
  );

  async function asksOnlyForTheDaysThatAreNotCoveredYetOnTheSecondRun() {
    await sync('cal friend', 30);
    fakeFeed.askedRanges = [];

    const secondReport = await sync('cal friend', 30);

    expect(fakeFeed.askedRanges).toHaveLength(1);
    expect(secondReport.appFeeds[0]?.status).toBe('synced');
  }

  test(
    'asks only for the days that are not covered yet on the second run',
    asksOnlyForTheDaysThatAreNotCoveredYetOnTheSecondRun,
  );

  async function reportsUpToDateAndDoesNotCallTheFeedWhenEverythingIsCovered() {
    const coverage: AppCoverage = {
      version: 1,
      appKey: 'ios-1',
      feeds: {
        'app-store': {
          lastSyncedAt: '2026-10-29T00:00:00.000Z',
          coveredFrom: '2000-01-01',
          coveredThrough: '2999-01-01',
          lastError: null,
          lastNote: null,
        },
      },
    };
    const serialized = JSON.stringify(coverage);

    writeLaunchHomeFile(homeDirectory, 'stats/ios-1/coverage.json', serialized);

    const report = await sync('cal friend', 3);

    expect(report.appFeeds[0]).toMatchObject({ status: 'up-to-date', statsWritten: 0 });
    expect(fakeFeed.askedRanges).toHaveLength(0);
  }

  test(
    'reports up-to-date and does not call the feed when everything is covered',
    reportsUpToDateAndDoesNotCallTheFeedWhenEverythingIsCovered,
  );

  async function recordsAFailingFeedAsFailedWithItsMessageAndKeepsGoing() {
    fakeFeed.reply = {
      _tag: 'StatsFeedFailure',
      feed: 'app-store',
      appKey: 'ios-1',
      message: 'report not ready',
      cause: null,
    } satisfies StatsFeedFailure;

    const report = await sync(null, 5);

    function readStatus(appFeed: AppFeedSyncReport) {
      return appFeed.status;
    }

    expect(report.appFeeds.map(readStatus)).toEqual(['failed', 'skipped']);
    expect(report.appFeeds[0]?.message).toBe('report not ready');

    const coverage = readCoverage('ios-1');

    expect(coverage.feeds['app-store']?.lastError).toBe('report not ready');
  }

  test(
    'records a failing feed as failed with its message and keeps going',
    recordsAFailingFeedAsFailedWithItsMessageAndKeepsGoing,
  );

  async function findsAnAppThatIsNotInTheSavedPortfolioByDiscoveringAgain() {
    const serialized = JSON.stringify({ ...PORTFOLIO_FILE, apps: [] });

    writeLaunchHomeFile(homeDirectory, 'portfolio.json', serialized);

    const report = await sync('fresh', 5, {
      async ascClientForAccount() {
        return makeFakeAscClient([{ id: '9', name: 'Fresh App', bundleId: null }]);
      },
    });

    function readAppKey(appFeed: AppFeedSyncReport) {
      return appFeed.appKey;
    }

    expect(report.appFeeds.map(readAppKey)).toEqual(['ios-9']);
  }

  test(
    'finds an app that is not in the saved portfolio by discovering again',
    findsAnAppThatIsNotInTheSavedPortfolioByDiscoveringAgain,
  );

  async function failsWithTheKnownAppNamesWhenTheAppDoesNotExistAnywhere() {
    makeStatsCredentialsTest();

    var failure: unknown;

    try {
      await syncStats({ appName: 'zzz', days: 5 });
      throw new Error('expected a failure');
    } catch (cause) {
      failure = cause;
    }

    expect(failure).toMatchObject({ _tag: 'StatsAppNotFoundFailure' });
    expect((failure as { message: string }).message).toContain('No app matched "zzz".');
  }

  test(
    'fails with the known app names when the app does not exist anywhere',
    failsWithTheKnownAppNamesWhenTheAppDoesNotExistAnywhere,
  );
}

describe('syncStats', describeSyncStats);
