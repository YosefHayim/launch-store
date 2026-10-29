import type { FileSystem, HttpClient, Path } from '@effect/platform';
import { Clock, Data, Effect } from 'effect';
import { loadPortfolioApps } from '../portfolio/loadPortfolioApps.js';
import { findAppsByName } from '../portfolio/portfolioLogic.js';
import type { DocumentFileFailure } from '../services/atomicDocumentFile.js';
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
import {
  findFeedCoverage,
  markFeedCoverageFailed,
  markFeedCoverageSkipped,
  mergeFeedCoverage,
  subtractCoverage,
} from './coverageLogic.js';
import { loadAppCoverage, saveAppCoverage } from './coverageStore.js';
import { createLastDaysRange, readYesterdayUtc } from './dateRange.js';
import { STATS_FEED_PLUGINS } from './feedRegistry.js';
import { saveDailyStats } from './statsStore.js';
import { StatsCredentials } from './statsCredentials.js';
import { holdSyncLock, type SyncLockFailure } from './syncLock.js';

type StatsAppNotFoundFailure = Readonly<{
  readonly _tag: 'StatsAppNotFoundFailure';
  readonly message: string;
  readonly knownAppNames: readonly string[];
}>;

const makeStatsAppNotFoundFailure = Data.tagged<StatsAppNotFoundFailure>('StatsAppNotFoundFailure');

export type StatsSyncFailure =
  | InvalidAppKeyFailure
  | DocumentFileFailure
  | StatsAppNotFoundFailure
  | SyncLockFailure;

export type StatsSyncRequirements =
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | LaunchPathsService
  | Path.Path
  | StatsCredentialsShape;

interface FeedSync {
  readonly report: AppFeedSyncReport;
  readonly coverage: FeedCoverage | null;
}

const createNotesMessage = (notes: readonly string[]): string | null => {
  const hasNoNotes = notes.length === 0;
  if (hasNoNotes) return null;
  return notes.join('; ');
};

const syncOneFeed = (
  app: PortfolioApp,
  plugin: StatsFeedPlugin,
  requestedRange: DateRange,
  savedCoverage: FeedCoverage | null,
  syncedAt: string,
): Effect.Effect<FeedSync, InvalidAppKeyFailure | DocumentFileFailure, StatsSyncRequirements> =>
  Effect.gen(function* () {
    const credentials = yield* StatsCredentials;
    const missingRange = subtractCoverage(requestedRange, savedCoverage);
    const isFeedUpToDate = missingRange === null;
    if (isFeedUpToDate) {
      return {
        report: {
          appKey: app.key,
          feed: plugin.feed,
          status: 'up-to-date',
          statsWritten: 0,
          message: null,
        },
        coverage: savedCoverage,
      } satisfies FeedSync;
    }
    const fetchReply = yield* plugin
      .fetchDays({ app, range: missingRange, credentials })
      .pipe(Effect.either);
    const hasFetchFailed = fetchReply._tag === 'Left';
    if (hasFetchFailed) {
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
      } satisfies FeedSync;
    }
    const reply = fetchReply.right;
    const isFeedSkipped = reply.status === 'skipped';
    if (isFeedSkipped) {
      return {
        report: {
          appKey: app.key,
          feed: plugin.feed,
          status: 'skipped',
          statsWritten: 0,
          message: reply.reason,
        },
        coverage: markFeedCoverageSkipped(savedCoverage, syncedAt),
      } satisfies FeedSync;
    }
    yield* saveDailyStats(app.key, reply.stats);
    return {
      report: {
        appKey: app.key,
        feed: plugin.feed,
        status: 'synced',
        statsWritten: reply.stats.length,
        message: createNotesMessage(reply.notes),
      },
      coverage: mergeFeedCoverage(savedCoverage, missingRange, reply.coveredThrough, syncedAt),
    } satisfies FeedSync;
  });

const syncOneApp = (
  app: PortfolioApp,
  requestedRange: DateRange,
  syncedAt: string,
): Effect.Effect<
  AppFeedSyncReport[],
  InvalidAppKeyFailure | DocumentFileFailure,
  StatsSyncRequirements
> =>
  Effect.gen(function* () {
    const savedCoverage = yield* loadAppCoverage(app.key);
    const appFeedReports: AppFeedSyncReport[] = [];
    const feedCoverages: AppCoverage['feeds'] = { ...savedCoverage.feeds };
    for (const plugin of STATS_FEED_PLUGINS) {
      const isFeedApplicable = plugin.isApplicable(app);
      if (!isFeedApplicable) continue;
      const savedFeedCoverage = findFeedCoverage(savedCoverage, plugin.feed);
      const feedSync = yield* syncOneFeed(app, plugin, requestedRange, savedFeedCoverage, syncedAt);
      appFeedReports.push(feedSync.report);
      const hasNewCoverage = feedSync.coverage !== null;
      if (hasNewCoverage) feedCoverages[plugin.feed] = feedSync.coverage;
    }
    yield* saveAppCoverage({ ...savedCoverage, feeds: feedCoverages });
    return appFeedReports;
  });

const loadAppsToSync = (
  appName: string | null,
): Effect.Effect<
  PortfolioApp[],
  DocumentFileFailure | StatsAppNotFoundFailure,
  StatsSyncRequirements
> =>
  Effect.gen(function* () {
    const cachedLoad = yield* loadPortfolioApps('cache-first');
    const isEveryAppWanted = appName === null;
    if (isEveryAppWanted) return [...cachedLoad.apps];
    const appsFoundInCache = findAppsByName(cachedLoad.apps, appName);
    const isAppInCache = appsFoundInCache.length > 0;
    if (isAppInCache) return appsFoundInCache;
    const discoveredLoad = yield* loadPortfolioApps('discover');
    const appsFoundByDiscovery = findAppsByName(discoveredLoad.apps, appName);
    const isAppDiscovered = appsFoundByDiscovery.length > 0;
    if (isAppDiscovered) return appsFoundByDiscovery;
    const knownAppNames = discoveredLoad.apps.map((app) => app.name);
    const notFoundFailure = makeStatsAppNotFoundFailure({
      message: `No app matched "${appName}". Known apps: ${knownAppNames.join(', ')}.`,
      knownAppNames,
    });
    return yield* Effect.fail(notFoundFailure);
  });

export const syncStats = (
  request: StatsSyncRequest,
): Effect.Effect<StatsSyncReport, StatsSyncFailure, StatsSyncRequirements> =>
  holdSyncLock(
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
