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
import { createLogger, makeLaunchLoggerTest } from '../services/logger.js';
import { makeStatsCredentialsTest } from '../stats/statsCredentials.js';
import type { StatsFeedFailure, StatsFeedPlugin } from '../types/stats.js';
import { appsTabReply, statsApiReply } from './statsRoutes.js';

const fakeFeed = vi.hoisted(() => ({ mode: 'skipped' as 'skipped' | 'failing' | 'hanging' }));

vi.mock('../stats/feedRegistry.js', async () => {
  const { Effect: EffectModule } = await import('effect');
  const iosFeed: StatsFeedPlugin = {
    feed: 'app-store',
    isApplicable: (app) => app.platform === 'ios',
    fetchDays: () => {
      if (fakeFeed.mode === 'hanging') return EffectModule.never;
      if (fakeFeed.mode === 'failing') {
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

describe('statsRoutes', () => {
  let homeDirectory: string;
  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', JSON.stringify(STATS_PORTFOLIO_FILE));
    writeStatsMonthFiles(homeDirectory, 'ios-1', [
      {
        date: readDateDaysAgo(1),
        feed: 'app-store',
        metric: 'downloads',
        value: 12,
        currency: null,
      },
    ]);
    fakeFeed.mode = 'skipped';
  });
  afterEach(() => {
    vi.useRealTimers();
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const reply = (createReply: typeof appsTabReply, query: string, terminalWrites: string[] = []) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* createLogger(false);
        return yield* createReply(new URLSearchParams(query), logger);
      }).pipe(
        Effect.provide(makeLaunchLoggerTest(terminalWrites)),
        Effect.provide(makeStatsCredentialsTest()),
        Effect.provide(makeHttpClientTest([])),
        Effect.provide(makeLaunchHomeTest(homeDirectory)),
      ),
    );

  test('the Apps tab answers HTML with the app names', async () => {
    const appsReply = await reply(appsTabReply, 'days=7');

    expect(appsReply.status).toBe(200);
    expect(appsReply.contentType).toContain('text/html');
    expect(appsReply.content).toContain('Cal Friend AI');
    expect(appsReply.content).toContain('Fit &lt;Tracker&gt;');
  });

  test('the API answers JSON narrowed by platform, owner and app', async () => {
    const platformReply = await reply(statsApiReply, 'platform=android');
    const ownerReply = await reply(statsApiReply, 'owner=mine&days=7');
    const appReply = await reply(statsApiReply, 'app=cal');

    expect(JSON.parse(platformReply.content).apps).toHaveLength(1);
    expect(JSON.parse(ownerReply.content).days).toBe(7);
    expect(JSON.parse(appReply.content).apps[0].key).toBe('ios-1');
  });

  test('a bad query value is a 400', async () => {
    const badDays = await reply(statsApiReply, 'days=0');
    const badPlatform = await reply(statsApiReply, 'platform=web');

    expect(badDays.status).toBe(400);
    expect(badPlatform.status).toBe(400);
  });

  test('an unknown app is a 404 that lists the known apps', async () => {
    const notFoundReply = await reply(statsApiReply, 'app=nothing');

    expect(notFoundReply.status).toBe(404);
    expect(notFoundReply.content).toContain('Cal Friend AI');
  });

  test('a failed sync still answers 200 with a stale banner', async () => {
    fakeFeed.mode = 'failing';

    const appsReply = await reply(appsTabReply, '');

    expect(appsReply.status).toBe(200);
    expect(appsReply.content).toContain('Some numbers are old');
  });

  test('a sync that hangs past ten seconds shows the saved numbers as stale', async () => {
    fakeFeed.mode = 'hanging';
    vi.useFakeTimers();

    const pendingReply = reply(appsTabReply, '');
    await vi.advanceTimersByTimeAsync(11_000);
    const appsReply = await pendingReply;

    expect(appsReply.status).toBe(200);
    expect(appsReply.content).toContain('Some numbers are old');
  });

  test('a broken saved file is a 500 that is logged', async () => {
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', 'not json');
    const terminalWrites: string[] = [];

    const brokenReply = await reply(statsApiReply, '', terminalWrites);

    expect(brokenReply.status).toBe(500);
    expect(terminalWrites.join('')).toContain('dashboard stats failed');
  });
});
