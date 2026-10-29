import { Clock, Effect } from 'effect';
import { loadPortfolioApps } from '../portfolio/loadPortfolioApps.js';
import { findAppsByName } from '../portfolio/portfolioLogic.js';
import type { PortfolioApp } from '../types/portfolio.js';
import type { FeedCoverage, StatsFreshness, StatsSyncRequest } from '../types/stats.js';
import { isFeedCoverageStale } from './coverageLogic.js';
import { loadAppCoverage } from './coverageStore.js';
import { DEFAULT_SYNC_DAYS } from './dateRange.js';
import { STATS_FEED_PLUGINS } from './feedRegistry.js';
import { syncStats, type StatsSyncRequirements } from './syncStats.js';

const isAnyFeedStale = (
  apps: readonly PortfolioApp[],
  nowMilliseconds: number,
): Effect.Effect<boolean, never, StatsSyncRequirements> =>
  Effect.gen(function* () {
    for (const app of apps) {
      const appCoverage = yield* loadAppCoverage(app.key);
      for (const plugin of STATS_FEED_PLUGINS) {
        const isFeedApplicable = plugin.isApplicable(app);
        if (!isFeedApplicable) continue;
        let feedCoverage: FeedCoverage | null = null;
        const savedFeedCoverage = appCoverage.feeds[plugin.feed];
        if (savedFeedCoverage !== undefined) feedCoverage = savedFeedCoverage;
        const isFeedOutOfDate = isFeedCoverageStale(feedCoverage, nowMilliseconds);
        if (isFeedOutOfDate) return true;
      }
    }
    return false;
  }).pipe(Effect.orElseSucceed(() => true));

const findAppsToCheck = (
  appName: string | null,
): Effect.Effect<readonly PortfolioApp[], never, StatsSyncRequirements> =>
  Effect.gen(function* () {
    const portfolioLoad = yield* loadPortfolioApps('cache-first');
    if (appName === null) return portfolioLoad.apps;
    return findAppsByName(portfolioLoad.apps, appName);
  }).pipe(Effect.orElseSucceed((): readonly PortfolioApp[] => []));

/**
 * Sync only when a feed is older than the stale limit. Never fails: a sync that could not run, or a
 * feed that failed, comes back as `isStale: true` so the caller can still use the saved numbers.
 */
export const ensureFreshStats = (
  appName: string | null,
): Effect.Effect<StatsFreshness, never, StatsSyncRequirements> =>
  Effect.gen(function* () {
    const nowMilliseconds = yield* Clock.currentTimeMillis;
    const apps = yield* findAppsToCheck(appName);
    const isSyncNeeded = yield* isAnyFeedStale(apps, nowMilliseconds);
    if (!isSyncNeeded) return { isStale: false, report: null };
    const request: StatsSyncRequest = { appName, days: DEFAULT_SYNC_DAYS };
    const syncAttempt = yield* syncStats(request).pipe(Effect.either);
    if (syncAttempt._tag === 'Left') return { isStale: true, report: null };
    const report = syncAttempt.right;
    const hasFeedFailed = report.appFeeds.some((appFeed) => appFeed.status === 'failed');
    return { isStale: hasFeedFailed, report };
  });
