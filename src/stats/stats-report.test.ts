import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home.testkit.ts';
import {
  readDateDaysAgo,
  STATS_PORTFOLIO_FILE,
  writeStatsMonthFiles,
} from '../testkit/stats-home.testkit.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import type { StatsReportRequest } from '../types/stats-report.ts';
import { createStatsReport } from './stats-report.ts';
import { makeStatsCredentialsTest, useStatsCredentials } from './stats-credentials.ts';

const fakeFeed = vi.hoisted(() => ({ isFailing: false }));

vi.mock('./feed-registry.ts', () => {
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

describe('createStatsReport', () => {
  let homeDirectory: string;

  function useTemporaryLaunchHome(): void {
    useLaunchDirectories({
      homeDirectory,
      workingDirectory: join(homeDirectory, 'work'),
    });
  }

  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    useTemporaryLaunchHome();
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', JSON.stringify(STATS_PORTFOLIO_FILE));
    writeStatsMonthFiles(homeDirectory, 'ios-1', [
      {
        date: readDateDaysAgo(1),
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
  });

  afterEach(() => {
    useStatsCredentials(null);
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const createReport = async (
    request: StatsReportRequest,
  ): Promise<ReportOutcome<Awaited<ReturnType<typeof createStatsReport>>>> => {
    try {
      const right = await createStatsReport(request);

      return { _tag: 'Right', right };
    } catch (left) {
      return { _tag: 'Left', left: left as { message?: string } };
    }
  };

  test('folds the saved numbers per app and ignores days outside the range', async () => {
    const outcome = await createReport(ALL_APPS_REQUEST);

    if (outcome._tag == 'Left') throw new Error('expected a report');
    const report = outcome.right;
    expect(report.isStale).toBe(false);
    expect(report.days).toBe(7);
    expect(report.apps.map((app) => app.name)).toEqual(['Cal Friend AI', 'Fit <Tracker>']);
    const iosApp = report.apps[0];
    expect(iosApp?.owner).toBe('mine');
    expect(iosApp?.totals.find((total) => total.metric == 'downloads')?.total).toBe(15);
    const proceeds = iosApp?.totals.filter((total) => total.metric == 'proceeds');
    expect(proceeds?.map((total) => [total.currency, total.total])).toEqual([
      ['EUR', 2],
      ['USD', 3],
    ]);
    const downloadSeries = iosApp?.series.find((series) => series.metric == 'downloads');
    expect(downloadSeries?.points.map((point) => point.amount)).toEqual([5, 10]);
  });

  test('narrows by platform and owner', async () => {
    const androidOutcome = await createReport({ ...ALL_APPS_REQUEST, platform: 'android' });
    const clientOutcome = await createReport({ ...ALL_APPS_REQUEST, owner: 'client' });

    expect(
      androidOutcome._tag == 'Right' && androidOutcome.right.apps.map((app) => app.key),
    ).toEqual(['android-com.fit']);
    expect(clientOutcome._tag == 'Right' && clientOutcome.right.apps).toEqual([]);
  });

  test('finds one app by part of its name', async () => {
    const outcome = await createReport({ ...ALL_APPS_REQUEST, appName: 'cal friend' });

    expect(outcome._tag == 'Right' && outcome.right.apps.map((app) => app.key)).toEqual(['ios-1']);
  });

  test('fails with the known app names when no app matches', async () => {
    const outcome = await createReport({ ...ALL_APPS_REQUEST, appName: 'nothing' });

    expect(outcome).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'StatsReportAppNotFoundFailure' },
    });
    expect(outcome._tag == 'Left' && 'message' in outcome.left && outcome.left.message).toContain(
      'Cal Friend AI, Fit <Tracker>',
    );
  });

  test('returns the saved numbers marked stale with the sync message when a feed failed', async () => {
    fakeFeed.isFailing = true;

    const outcome = await createReport(ALL_APPS_REQUEST);

    if (outcome._tag == 'Left') throw new Error('expected a report');
    expect(outcome.right.isStale).toBe(true);
    expect(outcome.right.apps[0]?.isStale).toBe(true);
    expect(outcome.right.apps[0]?.messages).toEqual(['app-store: report not ready']);
    expect(outcome.right.apps[1]?.isStale).toBe(false);
    expect(outcome.right.apps[0]?.totals.length).toBeGreaterThan(0);
  });

  test('shows the saved skip reason when the cache is fresh and no sync runs', async () => {
    await createReport(ALL_APPS_REQUEST);
    fakeFeed.isFailing = true;

    const outcome = await createReport(ALL_APPS_REQUEST);

    if (outcome._tag == 'Left') throw new Error('expected a report');
    expect(outcome.right.isStale).toBe(false);
    expect(outcome.right.apps[0]?.messages).toEqual(['app-store: not built yet']);
    expect(outcome.right.apps[1]?.messages).toEqual([]);
  });

  test('gives empty totals for an app with no saved numbers', async () => {
    removeTemporaryHomeDirectory(homeDirectory);
    homeDirectory = createTemporaryHomeDirectory();
    useTemporaryLaunchHome();
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', JSON.stringify(STATS_PORTFOLIO_FILE));

    const outcome = await createReport(ALL_APPS_REQUEST);

    if (outcome._tag == 'Left') throw new Error('expected a report');
    expect(outcome.right.apps.map((app) => app.totals)).toEqual([[], []]);
  });
});
