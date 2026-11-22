import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home-testkit.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import type { PortfolioFile } from '../types/portfolio.ts';
import type { AppCoverage } from '../types/stats.ts';
import { ensureFreshStats } from './ensure-fresh-stats.ts';
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

const portfolioFile: PortfolioFile = {
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

describe('ensureFreshStats', () => {
  let homeDirectory: string;

  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    const workPath = join(homeDirectory, 'work');
    useLaunchDirectories({
      homeDirectory,
      workingDirectory: workPath,
    });
    const serialized = JSON.stringify(portfolioFile);
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', serialized);
    makeStatsCredentialsTest();
    fakeFeed.isFailing = false;
  });

  afterEach(() => {
    useStatsCredentials(null);
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const ensure = (appName: string | null) => ensureFreshStats(appName);

  const writeCoverage = (lastSyncedAt: string, lastError: string | null) => {
    const coverage: AppCoverage = {
      version: 1,
      appKey: 'ios-1',
      feeds: {
        'app-store': {
          lastSyncedAt,
          coveredFrom: '2026-10-01',
          coveredThrough: '2026-10-28',
          lastError,
          lastNote: null,
        },
      },
    };
    const serialized = JSON.stringify(coverage);
    writeLaunchHomeFile(homeDirectory, 'stats/ios-1/coverage.json', serialized);
  };

  test('does not sync when every feed was synced recently', async () => {
    writeCoverage(new Date().toISOString(), null);

    const freshness = await ensure('cal friend');

    expect(freshness).toEqual({ isStale: false, report: null });
  });

  test('syncs a feed that was never synced and is fresh when the feed only skips', async () => {
    const freshness = await ensure('cal friend');

    expect(freshness.isStale).toBe(false);
    expect(freshness.report?.appFeeds.map((appFeed) => appFeed.status)).toEqual(['skipped']);
  });

  test('does not sync again right after a feed was skipped', async () => {
    await ensure('cal friend');

    const freshness = await ensure('cal friend');

    expect(freshness).toEqual({ isStale: false, report: null });
  });

  test('syncs a feed that was synced more than 12 hours ago', async () => {
    writeCoverage('2020-01-01T00:00:00.000Z', null);

    const freshness = await ensure(null);

    expect(freshness.report).not.toBeNull();
  });

  test('checks only apps that match the name and ignores feeds that do not apply', async () => {
    const freshness = await ensure('fit');

    expect(freshness).toEqual({ isStale: false, report: null });
  });

  test('reports stale with the report when a feed failed', async () => {
    fakeFeed.isFailing = true;

    const freshness = await ensure('cal friend');

    expect(freshness.isStale).toBe(true);
    expect(freshness.report?.appFeeds[0]?.status).toBe('failed');
  });

  test('reports stale without a report when the sync could not run', async () => {
    writeLaunchHomeFile(homeDirectory, 'stats/sync.lock', new Date().toISOString());

    const freshness = await ensure('cal friend');

    expect(freshness).toEqual({ isStale: true, report: null });
  });

  test('reports stale when the saved coverage cannot be read', async () => {
    writeLaunchHomeFile(homeDirectory, 'stats/ios-1/coverage.json', '{not json');

    const freshness = await ensure('cal friend');

    expect(freshness.isStale).toBe(true);
  });

  test('reports stale without a report when the portfolio cannot be loaded', async () => {
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', '{not json');

    const freshness = await ensure('cal friend');

    expect(freshness).toEqual({ isStale: true, report: null });
  });
});
