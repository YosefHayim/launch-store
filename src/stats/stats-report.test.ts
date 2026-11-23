import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home-testkit.ts';
import {
  readDateDaysAgo,
  STATS_PORTFOLIO_FILE,
  writeStatsMonthFiles,
} from '../testkit/stats-home-testkit.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import type { StatsReportRequest } from '../types/stats-report.ts';
import { createStatsReport } from './stats-report.ts';
import { makeStatsCredentialsTest, useStatsCredentials } from './stats-credentials.ts';
import type {
  AppStatsReport,
  DailyPoint,
  MetricSeries,
  MetricTotal,
} from '../types/stats-report.ts';

const fakeFeed = vi.hoisted(function hoistFakeFeed() {
  return { isFailing: false };
});

vi.mock('./feed-registry.ts', function mockFeedRegistry() {
  const iosFeed = {
    feed: 'app-store' as const,
    isApplicable(app: { platform: string }) {
      return app.platform == 'ios';
    },
    async fetchDays() {
      if (fakeFeed.isFailing) {
        throw {
          _tag: 'StatsFeedFailure',
          feed: 'app-store',
          appKey: 'ios-1',
          message: 'report not ready',
          cause: null,
        };
      }

      return { status: 'skipped' as const, reason: 'not built yet' };
    },
  };

  return { STATS_FEED_PLUGINS: [iosFeed] };
});

const ALL_APPS_REQUEST: StatsReportRequest = {
  platform: null,
  owner: null,
  appName: null,
  days: 7,
};

type ReportOutcome<Report> =
  | { readonly _tag: 'Right'; readonly right: Report }
  | { readonly _tag: 'Left'; readonly left: { readonly message?: string } };
function describeCreateStatsReport() {
  let homeDirectory: string;

  function useTemporaryLaunchHome(): void {
    const workPath = join(homeDirectory, 'work');

    useLaunchDirectories({
      homeDirectory,
      workingDirectory: workPath,
    });
  }
  function prepareCreateStatsReport() {
    homeDirectory = createTemporaryHomeDirectory();
    useTemporaryLaunchHome();

    const serialized = JSON.stringify(STATS_PORTFOLIO_FILE);

    writeLaunchHomeFile(homeDirectory, 'portfolio.json', serialized);

    const dateDaysAgo = readDateDaysAgo(1);

    writeStatsMonthFiles(homeDirectory, 'ios-1', [
      {
        date: dateDaysAgo,
        feed: 'app-store',
        metric: 'downloads',
        value: 10,
        currency: null,
      },
      {
        date: readDateDaysAgo(2),
        feed: 'app-store',
        metric: 'downloads',
        value: 5,
        currency: null,
      },
      {
        date: readDateDaysAgo(1),
        feed: 'app-store',
        metric: 'proceeds',
        value: 3,
        currency: 'USD',
      },
      {
        date: readDateDaysAgo(1),
        feed: 'app-store',
        metric: 'proceeds',
        value: 2,
        currency: 'EUR',
      },
      {
        date: readDateDaysAgo(60),
        feed: 'app-store',
        metric: 'downloads',
        value: 99,
        currency: null,
      },
    ]);
    writeStatsMonthFiles(homeDirectory, 'android-com.fit', [
      {
        date: readDateDaysAgo(1),
        feed: 'google-play',
        metric: 'installs',
        value: 7,
        currency: null,
      },
    ]);
    makeStatsCredentialsTest();
    fakeFeed.isFailing = false;
  }

  beforeEach(prepareCreateStatsReport);

  function cleanupCreateStatsReport() {
    useStatsCredentials(null);
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  }

  afterEach(cleanupCreateStatsReport);

  async function createReport(
    request: StatsReportRequest,
  ): Promise<ReportOutcome<Awaited<ReturnType<typeof createStatsReport>>>> {
    try {
      const right = await createStatsReport(request);

      return { _tag: 'Right', right };
    } catch (left) {
      return { _tag: 'Left', left: left as { message?: string } };
    }
  }
  async function foldsTheSavedNumbersPerAppAndIgnoresDaysOutsideTheRange() {
    const outcome = await createReport(ALL_APPS_REQUEST);

    if (outcome._tag == 'Left') throw new Error('expected a report');

    const report = outcome.right;

    expect(report.isStale).toBe(false);
    expect(report.days).toBe(7);

    function readName(app: AppStatsReport) {
      return app.name;
    }

    expect(report.apps.map(readName)).toEqual(['Cal Friend AI', 'Fit <Tracker>']);

    const iosApp = report.apps[0];

    expect(iosApp?.owner).toBe('mine');

    function isDownloadsTotal(total: MetricTotal) {
      return total.metric == 'downloads';
    }

    expect(iosApp?.totals.find(isDownloadsTotal)?.total).toBe(15);

    function isProceedsTotal(total: MetricTotal) {
      return total.metric == 'proceeds';
    }

    const proceeds = iosApp?.totals.filter(isProceedsTotal);

    function readCurrencyTotal(total: MetricTotal) {
      return [total.currency, total.total];
    }

    expect(proceeds?.map(readCurrencyTotal)).toEqual([
      ['EUR', 2],
      ['USD', 3],
    ]);

    function isDownloadsSeries(series: MetricSeries) {
      return series.metric == 'downloads';
    }

    const downloadSeries = iosApp?.series.find(isDownloadsSeries);

    function readAmount(point: DailyPoint) {
      return point.amount;
    }

    expect(downloadSeries?.points.map(readAmount)).toEqual([5, 10]);
  }

  test(
    'folds the saved numbers per app and ignores days outside the range',
    foldsTheSavedNumbersPerAppAndIgnoresDaysOutsideTheRange,
  );

  async function narrowsByPlatformAndOwner() {
    const androidOutcome = await createReport({ ...ALL_APPS_REQUEST, platform: 'android' });
    const clientOutcome = await createReport({ ...ALL_APPS_REQUEST, owner: 'client' });

    function readKey(app: AppStatsReport) {
      return app.key;
    }

    expect(androidOutcome._tag == 'Right' && androidOutcome.right.apps.map(readKey)).toEqual([
      'android-com.fit',
    ]);
    expect(clientOutcome._tag == 'Right' && clientOutcome.right.apps).toEqual([]);
  }

  test('narrows by platform and owner', narrowsByPlatformAndOwner);

  async function findsOneAppByPartOfItsName() {
    const outcome = await createReport({ ...ALL_APPS_REQUEST, appName: 'cal friend' });

    function readKey2(app: AppStatsReport) {
      return app.key;
    }

    expect(outcome._tag == 'Right' && outcome.right.apps.map(readKey2)).toEqual(['ios-1']);
  }

  test('finds one app by part of its name', findsOneAppByPartOfItsName);

  async function failsWithTheKnownAppNamesWhenNoAppMatches() {
    const outcome = await createReport({ ...ALL_APPS_REQUEST, appName: 'nothing' });

    expect(outcome).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'StatsReportAppNotFoundFailure' },
    });
    expect(outcome._tag == 'Left' && 'message' in outcome.left && outcome.left.message).toContain(
      'Cal Friend AI, Fit <Tracker>',
    );
  }

  test(
    'fails with the known app names when no app matches',
    failsWithTheKnownAppNamesWhenNoAppMatches,
  );

  async function returnsTheSavedNumbersMarkedStaleWithTheSyncMessageWhenAFeedFailed() {
    fakeFeed.isFailing = true;

    const outcome = await createReport(ALL_APPS_REQUEST);

    if (outcome._tag == 'Left') throw new Error('expected a report');

    expect(outcome.right.isStale).toBe(true);
    expect(outcome.right.apps[0]?.isStale).toBe(true);
    expect(outcome.right.apps[0]?.messages).toEqual(['app-store: report not ready']);
    expect(outcome.right.apps[1]?.isStale).toBe(false);
    expect(outcome.right.apps[0]?.totals.length).toBeGreaterThan(0);
  }

  test(
    'returns the saved numbers marked stale with the sync message when a feed failed',
    returnsTheSavedNumbersMarkedStaleWithTheSyncMessageWhenAFeedFailed,
  );

  async function showsTheSavedSkipReasonWhenTheCacheIsFreshAndNoSyncRuns() {
    await createReport(ALL_APPS_REQUEST);
    fakeFeed.isFailing = true;

    const outcome = await createReport(ALL_APPS_REQUEST);

    if (outcome._tag == 'Left') throw new Error('expected a report');

    expect(outcome.right.isStale).toBe(false);
    expect(outcome.right.apps[0]?.messages).toEqual(['app-store: not built yet']);
    expect(outcome.right.apps[1]?.messages).toEqual([]);
  }

  test(
    'shows the saved skip reason when the cache is fresh and no sync runs',
    showsTheSavedSkipReasonWhenTheCacheIsFreshAndNoSyncRuns,
  );

  async function givesEmptyTotalsForAnAppWithNoSavedNumbers() {
    removeTemporaryHomeDirectory(homeDirectory);
    homeDirectory = createTemporaryHomeDirectory();
    useTemporaryLaunchHome();

    const serialized = JSON.stringify(STATS_PORTFOLIO_FILE);

    writeLaunchHomeFile(homeDirectory, 'portfolio.json', serialized);

    const outcome = await createReport(ALL_APPS_REQUEST);

    if (outcome._tag == 'Left') throw new Error('expected a report');

    function readTotals(app: AppStatsReport) {
      return app.totals;
    }

    expect(outcome.right.apps.map(readTotals)).toEqual([[], []]);
  }

  test(
    'gives empty totals for an app with no saved numbers',
    givesEmptyTotalsForAnAppWithNoSavedNumbers,
  );
}

describe('createStatsReport', describeCreateStatsReport);
