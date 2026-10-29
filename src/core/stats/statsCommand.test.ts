import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeHttpClientTest } from '@testkit/httpClient.testkit.js';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import {
  readDateDaysAgo,
  STATS_PORTFOLIO_FILE,
  writeStatsMonthFiles,
} from '@testkit/statsHome.testkit.js';
import { makeLaunchLoggerTest } from '../services/logger.js';
import type { StatsFeedFailure, StatsFeedPlugin } from '../types/stats.js';
import { makeStatsCredentialsTest } from './statsCredentials.js';
import { statsReportProgram, type StatsCommandRequest } from './statsCommand.js';

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

const ALL_APPS_REQUEST: StatsCommandRequest = {
  platform: undefined,
  owner: undefined,
  app: undefined,
  days: undefined,
  json: false,
};

describe('statsReportProgram', () => {
  let homeDirectory: string;
  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', JSON.stringify(STATS_PORTFOLIO_FILE));
    writeStatsMonthFiles(homeDirectory, 'ios-1', [
      {
        date: readDateDaysAgo(1),
        feed: 'app-store',
        metric: 'downloads',
        value: 1200,
        currency: null,
      },
    ]);
    fakeFeed.isFailing = false;
  });
  afterEach(() => {
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const run = async (request: StatsCommandRequest) => {
    const lines: string[] = [];
    const outcome = await Effect.runPromise(
      statsReportProgram(request).pipe(
        Effect.either,
        Effect.provide(makeLaunchLoggerTest(lines)),
        Effect.provide(makeStatsCredentialsTest()),
        Effect.provide(makeHttpClientTest([])),
        Effect.provide(makeLaunchHomeTest(homeDirectory)),
      ),
    );
    return { outcome, lines };
  };

  test('prints one JSON object with the report with --json', async () => {
    const { outcome, lines } = await run({ ...ALL_APPS_REQUEST, json: true, days: '7' });

    expect(outcome._tag).toBe('Right');
    expect(lines).toHaveLength(1);
    const report = JSON.parse(lines[0] ?? '');
    expect(report.ok).toBe(true);
    expect(report.days).toBe(7);
    expect(report.apps).toHaveLength(2);
  });

  test('prints a block per app without --json', async () => {
    const { lines } = await run(ALL_APPS_REQUEST);

    const text = lines.join('');
    expect(text).toContain('Cal Friend AI (ios, mine, alpha)');
    expect(text).toContain('1,200');
    expect(text).not.toContain('Some numbers are old');
  });

  test('says when no app matches the filters', async () => {
    const { lines } = await run({ ...ALL_APPS_REQUEST, owner: 'client' });

    expect(lines.join('')).toContain('No apps found.');
  });

  test('prints a warning when a sync failed', async () => {
    fakeFeed.isFailing = true;

    const { outcome, lines } = await run(ALL_APPS_REQUEST);

    expect(outcome._tag).toBe('Right');
    expect(lines.join('')).toContain('[WARN]');
    expect(lines.join('')).toContain('Some numbers are old');
  });

  test('exits 2 with a JSON error for a bad --days', async () => {
    const { outcome, lines } = await run({ ...ALL_APPS_REQUEST, days: '0', json: true });

    expect(outcome).toMatchObject({ _tag: 'Left', left: { _tag: 'CommandExit', exitCode: 2 } });
    expect(JSON.parse(lines[0] ?? '').ok).toBe(false);
  });

  test('exits 2 when no app matches the name', async () => {
    const { outcome } = await run({ ...ALL_APPS_REQUEST, app: 'nothing' });

    expect(outcome).toMatchObject({ _tag: 'Left', left: { _tag: 'CommandExit', exitCode: 2 } });
  });
});
