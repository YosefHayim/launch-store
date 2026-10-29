import type { FileSystem, HttpClient, Path } from '@effect/platform';
import { Clock, Data, Effect } from 'effect';
import { loadPortfolioApps } from '../portfolio/loadPortfolioApps.js';
import { findAppsByName } from '../portfolio/portfolioLogic.js';
import type { JsonFileFailure } from '../services/atomicJsonFile.js';
import { errorMessage } from '../services/errorMessage.js';
import type { InvalidAppKeyFailure, LaunchPathsService } from '../services/paths.js';
import type { PortfolioApp } from '../types/portfolio.js';
import type {
  AppCoverage,
  AppFeedSyncReport,
  DateRange,
  FeedCoverage,
  StatsCredentialsShape,
  StatsFeedPlugin,
  StatsSyncReport,
  StatsSyncRequest,
} from '../types/stats.js';
import { markFeedCoverageFailed, mergeFeedCoverage, subtractCoverage } from './coverageLogic.js';
import { loadAppCoverage, saveAppCoverage } from './coverageStore.js';
import { createLastDaysRange, readYesterdayUtc } from './dateRange.js';
import { STATS_FEED_PLUGINS } from './feedRegistry.js';
import { saveDailyStats } from './statsStore.js';
import { StatsCredentials } from './statsCredentials.js';
import { withSyncLock, type SyncLockFailure } from './syncLock.js';

type StatsAppNotFoundFailure = Readonly<{
  readonly _tag: 'StatsAppNotFoundFailure';
  readonly message: string;
  readonly knownAppNames: readonly string[];
}>;

const makeStatsAppNotFoundFailure = Data.tagged<StatsAppNotFoundFailure>('StatsAppNotFoundFailure');

export type StatsSyncFailure =
  | InvalidAppKeyFailure
  | JsonFileFailure
  | StatsAppNotFoundFailure
  | SyncLockFailure;

export type StatsSyncRequirements =
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | LaunchPathsService
  | Path.Path
  | StatsCredentialsShape;

interface FeedSyncOutcome {
  readonly report: AppFeedSyncReport;
  readonly coverage: FeedCoverage | null;
}

const syncOneFeed = (
  app: PortfolioApp,
  plugin: StatsFeedPlugin,
  requestedRange: DateRange,
  savedCoverage: FeedCoverage | null,
  syncedAt: string,
): Effect.Effect<FeedSyncOutcome, InvalidAppKeyFailure | JsonFileFailure, StatsSyncRequirements> =>
  Effect.gen(function* () {
    const credentials = yield* StatsCredentials;
    const missingRange = subtractCoverage(requestedRange, savedCoverage);
    if (missingRange === null) {
      return {
        report: {
          appKey: app.key,
          feed: plugin.feed,
          status: 'up-to-date',
          statsWritten: 0,
          message: null,
        },
        coverage: savedCoverage,
      } satisfies FeedSyncOutcome;
    }
    const fetchReply = yield* plugin
      .fetchDays({ app, range: missingRange, credentials })
      .pipe(Effect.either);
    if (fetchReply._tag === 'Left') {
      const message = errorMessage(fetchReply.left);
      return {
        report: {
          appKey: app.key,
          feed: plugin.feed,
          status: 'failed',
          statsWritten: 0,
          message,
        },
        coverage: markFeedCoverageFailed(savedCoverage, message),
      } satisfies FeedSyncOutcome;
    }
    const reply = fetchReply.right;
    if (reply.status === 'skipped') {
      return {
        report: {
          appKey: app.key,
          feed: plugin.feed,
          status: 'skipped',
          statsWritten: 0,
          message: reply.reason,
        },
        coverage: savedCoverage,
      } satisfies FeedSyncOutcome;
    }
    yield* saveDailyStats(app.key, reply.stats);
    return {
      report: {
        appKey: app.key,
        feed: plugin.feed,
        status: 'synced',
        statsWritten: reply.stats.length,
        message: null,
      },
      coverage: mergeFeedCoverage(savedCoverage, missingRange, reply.coveredThrough, syncedAt),
    } satisfies FeedSyncOutcome;
  });

const syncOneApp = (
  app: PortfolioApp,
  requestedRange: DateRange,
  syncedAt: string,
): Effect.Effect<
  AppFeedSyncReport[],
  InvalidAppKeyFailure | JsonFileFailure,
  StatsSyncRequirements
> =>
  Effect.gen(function* () {
    const savedCoverage = yield* loadAppCoverage(app.key);
    const appFeedReports: AppFeedSyncReport[] = [];
    const feedCoverages: AppCoverage['feeds'] = { ...savedCoverage.feeds };
    for (const plugin of STATS_FEED_PLUGINS) {
      const isFeedApplicable = plugin.isApplicable(app);
      if (!isFeedApplicable) continue;
      let savedFeedCoverage: FeedCoverage | null = null;
      const knownFeedCoverage = feedCoverages[plugin.feed];
      if (knownFeedCoverage !== undefined) savedFeedCoverage = knownFeedCoverage;
      const outcome = yield* syncOneFeed(app, plugin, requestedRange, savedFeedCoverage, syncedAt);
      appFeedReports.push(outcome.report);
      if (outcome.coverage !== null) feedCoverages[plugin.feed] = outcome.coverage;
    }
    yield* saveAppCoverage({ ...savedCoverage, feeds: feedCoverages });
    return appFeedReports;
  });

const loadAppsToSync = (
  appName: string | null,
): Effect.Effect<
  PortfolioApp[],
  JsonFileFailure | StatsAppNotFoundFailure,
  StatsSyncRequirements
> =>
  Effect.gen(function* () {
    const cachedLoad = yield* loadPortfolioApps('cache-first');
    if (appName === null) return [...cachedLoad.apps];
    const cachedMatches = findAppsByName(cachedLoad.apps, appName);
    const isAppInCache = cachedMatches.length > 0;
    if (isAppInCache) return cachedMatches;
    const discoveredLoad = yield* loadPortfolioApps('discover');
    const discoveredMatches = findAppsByName(discoveredLoad.apps, appName);
    const isAppDiscovered = discoveredMatches.length > 0;
    if (isAppDiscovered) return discoveredMatches;
    const knownAppNames = discoveredLoad.apps.map((app) => app.name);
    return yield* Effect.fail(
      makeStatsAppNotFoundFailure({
        message: `No app matched "${appName}". Known apps: ${knownAppNames.join(', ')}.`,
        knownAppNames,
      }),
    );
  });

/** Pull the missing days of every feed for the chosen apps; one feed failing never stops the others. */
export const syncStats = (
  request: StatsSyncRequest,
): Effect.Effect<StatsSyncReport, StatsSyncFailure, StatsSyncRequirements> =>
  withSyncLock(
    Effect.gen(function* () {
      const apps = yield* loadAppsToSync(request.appName);
      const yesterday = yield* readYesterdayUtc();
      const nowMilliseconds = yield* Clock.currentTimeMillis;
      const syncedAt = new Date(nowMilliseconds).toISOString();
      const requestedRange = createLastDaysRange(yesterday, request.days);
      const appFeeds: AppFeedSyncReport[] = [];
      for (const app of apps) {
        const appFeedReports = yield* syncOneApp(app, requestedRange, syncedAt);
        appFeeds.push(...appFeedReports);
      }
      return { syncedAt, appFeeds };
    }),
  );
