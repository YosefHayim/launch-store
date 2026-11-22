import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home-testkit.ts';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import type { PortfolioFile } from '../types/portfolio.ts';
import { makeStatsCredentialsTest, useStatsCredentials } from './stats-credentials.ts';
import { parseDaysFlag, statsSyncProgram } from './stats-sync-command.ts';

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
  ],
  tags: [],
  playReportsBucket: null,
};

type CommandOutcome =
  | { readonly _tag: 'Right' }
  | { readonly _tag: 'Left'; readonly left: unknown };

function readDaysFailure(daysFlag: string): unknown {
  try {
    parseDaysFlag(daysFlag);

    throw new Error('expected a failure');
  } catch (cause) {
    return cause;
  }
}

describe('parseDaysFlag', () => {
  test('uses 30 days when the flag is absent', () => {
    expect(parseDaysFlag(undefined)).toBe(30);
  });

  test('accepts whole numbers from 1 to 365', () => {
    expect(parseDaysFlag('1')).toBe(1);
    expect(parseDaysFlag('365')).toBe(365);
  });

  test('rejects zero, too many, and text that is not a whole number', () => {
    const invalidDaysFlags = ['0', '366', '2.5', '-3', 'abc', ''];
    const failures = invalidDaysFlags.map(readDaysFailure);

    expect(failures.map((failure) => (failure as { message: string }).message)).toEqual(
      invalidDaysFlags.map(() => '--days must be a whole number from 1 to 365.'),
    );
  });
});

describe('statsSyncProgram', () => {
  let homeDirectory: string;

  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    useLaunchDirectories({
      homeDirectory,
      workingDirectory: join(homeDirectory, 'work'),
    });
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', JSON.stringify(portfolioFile));
    makeStatsCredentialsTest();
    fakeFeed.isFailing = false;
  });

  afterEach(() => {
    useStatsCredentials(null);
    resetLogger();
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const run = async (request: {
    app: string | undefined;
    days: string | undefined;
    isJson: boolean;
  }) => {
    const lines: string[] = [];
    useLoggerSink(function writeLine(text: string) {
      lines.push(text);
    });

    var outcome: CommandOutcome;

    try {
      await statsSyncProgram(request);
      outcome = { _tag: 'Right' };
    } catch (left) {
      outcome = { _tag: 'Left', left };
    }

    return { outcome, lines };
  };

  test('prints one JSON object with the feed reports with --json', async () => {
    const { outcome, lines } = await run({ app: 'cal friend', days: '3', isJson: true });

    expect(outcome._tag).toBe('Right');
    expect(lines).toHaveLength(1);
    const report = JSON.parse(lines[0] ?? '');
    expect(report.ok).toBe(true);
    expect(report.appFeeds).toEqual([
      {
        appKey: 'ios-1',
        feed: 'app-store',
        status: 'skipped',
        statsWritten: 0,
        message: 'not built yet',
      },
    ]);
  });

  test('prints one line per feed without --json, syncing every app when no name is given', async () => {
    const { lines } = await run({ app: undefined, days: undefined, isJson: false });

    expect(lines).toEqual(['ios-1 app-store: skipped (not built yet)\n']);
  });

  test('exits 1 when a feed failed', async () => {
    fakeFeed.isFailing = true;

    const { outcome, lines } = await run({ app: undefined, days: '3', isJson: false });

    expect(outcome).toMatchObject({ _tag: 'Left', left: { _tag: 'CommandExit', exitCode: 1 } });
    expect(lines).toEqual(['ios-1 app-store: failed (report not ready)\n']);
  });

  test('exits 2 with a JSON error for a bad --days', async () => {
    const { outcome, lines } = await run({ app: undefined, days: '0', isJson: true });

    expect(outcome).toMatchObject({ _tag: 'Left', left: { exitCode: 2 } });
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      ok: false,
      error: '--days must be a whole number from 1 to 365.',
    });
  });

  test('exits 2 when the app name matches nothing', async () => {
    const { outcome } = await run({ app: 'zzz', days: undefined, isJson: false });

    expect(outcome).toMatchObject({ _tag: 'Left', left: { exitCode: 2 } });
  });
});
