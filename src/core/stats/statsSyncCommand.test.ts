import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeHttpClientTest } from '@testkit/httpClient.testkit.js';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import { makeLaunchLoggerTest } from '../services/logger.js';
import type { PortfolioFile } from '../types/portfolio.js';
import type { StatsFeedFailure, StatsFeedPlugin } from '../types/stats.js';
import { makeStatsCredentialsTest } from './statsCredentials.js';
import { parseDaysFlag, statsSyncProgram } from './statsSyncCommand.js';

const fakeFeed = vi.hoisted(() => ({ isFailing: false }));

vi.mock('./feedRegistry.js', async () => {
  const { Effect: EffectModule } = await import('effect');
  const iosFeed: StatsFeedPlugin = {
    feed: 'app-store',
    isApplicable: (app) => app.platform === 'ios',
    fetchDays: () => {
      if (fakeFeed.isFailing) {
        return EffectModule.fail({
          _tag: 'StatsFeedFailure',
          feed: 'app-store',
          appKey: 'ios-1',
          message: 'report not ready',
          cause: null,
        } satisfies StatsFeedFailure);
      }
      return EffectModule.succeed({ status: 'skipped', reason: 'not built yet' });
    },
  };
  return { STATS_FEED_PLUGINS: [iosFeed] };
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
  ],
  tags: [],
};

describe('parseDaysFlag', () => {
  test('uses 30 days when the flag is absent', async () => {
    expect(await Effect.runPromise(parseDaysFlag(undefined))).toBe(30);
  });

  test('accepts whole numbers from 1 to 365', async () => {
    expect(await Effect.runPromise(parseDaysFlag('1'))).toBe(1);
    expect(await Effect.runPromise(parseDaysFlag('365'))).toBe(365);
  });

  test('rejects zero, too many, and text that is not a whole number', async () => {
    const invalidDaysFlags = ['0', '366', '2.5', '-3', 'abc', ''];

    const failures = await Promise.all(
      invalidDaysFlags.map((invalidDaysFlag) =>
        Effect.runPromise(parseDaysFlag(invalidDaysFlag).pipe(Effect.flip)),
      ),
    );

    expect(failures.map((failure) => failure.message)).toEqual(
      invalidDaysFlags.map(() => '--days must be a whole number from 1 to 365.'),
    );
  });
});

describe('statsSyncProgram', () => {
  let homeDirectory: string;
  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', JSON.stringify(PORTFOLIO_FILE));
    fakeFeed.isFailing = false;
  });
  afterEach(() => {
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const run = (request: { app: string | undefined; days: string | undefined; isJson: boolean }) => {
    const lines: string[] = [];
    const finished = Effect.runPromise(
      statsSyncProgram(request).pipe(
        Effect.either,
        Effect.provide(makeLaunchLoggerTest(lines)),
        Effect.provide(makeStatsCredentialsTest()),
        Effect.provide(makeHttpClientTest([])),
        Effect.provide(makeLaunchHomeTest(homeDirectory)),
      ),
    );
    return finished.then((outcome) => ({ outcome, lines }));
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
