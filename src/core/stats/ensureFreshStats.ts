import { Clock, Effect } from 'effect';
import { loadPortfolioApps } from '../portfolio/loadPortfolioApps.js';
import { findAppsByName } from '../portfolio/portfolioLogic.js';
import type { DocumentFileFailure } from '../services/atomicDocumentFile.js';
import type { InvalidAppKeyFailure } from '../services/paths.js';
import type { PortfolioApp } from '../types/portfolio.js';
import type { StatsFreshness, StatsSyncRequest } from '../types/stats.js';
import { findFeedCoverage, isFeedCoverageStale } from './coverageLogic.js';
import { loadAppCoverage } from './coverageStore.js';
import { DEFAULT_SYNC_DAYS } from './dateRange.js';
import { STATS_FEED_PLUGINS } from './feedRegistry.js';
import { syncStats, type StatsSyncRequirements } from './syncStats.js';

const isAnyFeedStale = (
  apps: readonly PortfolioApp[],
  nowMilliseconds: number,
): Effect.Effect<boolean, InvalidAppKeyFailure | DocumentFileFailure, StatsSyncRequirements> =>
  Effect.gen(function* () {
    for (const app of apps) {
      const appCoverage = yield* loadAppCoverage(app.key);
      for (const plugin of STATS_FEED_PLUGINS) {
        const isFeedApplicable = plugin.isApplicable(app);
        if (!isFeedApplicable) continue;
        const feedCoverage = findFeedCoverage(appCoverage, plugin.feed);
        const isFeedOutOfDate = isFeedCoverageStale(feedCoverage, nowMilliseconds);
        if (isFeedOutOfDate) return true;
      }
    }
    return false;
  });

const findAppsToCheck = (
  appName: string | null,
): Effect.Effect<readonly PortfolioApp[], DocumentFileFailure, StatsSyncRequirements> =>
  Effect.gen(function* () {
    const portfolioLoad = yield* loadPortfolioApps('cache-first');
    const isEveryAppWanted = appName === null;
    if (isEveryAppWanted) return portfolioLoad.apps;
    return findAppsByName(portfolioLoad.apps, appName);
  });

export const ensureFreshStats = (
  appName: string | null,
): Effect.Effect<StatsFreshness, never, StatsSyncRequirements> =>
  Effect.gen(function* () {
    const nowMilliseconds = yield* Clock.currentTimeMillis;
    const staleCheck = yield* Effect.gen(function* () {
      const apps = yield* findAppsToCheck(appName);
      return yield* isAnyFeedStale(apps, nowMilliseconds);
    }).pipe(Effect.either);
    // Saved files that cannot be read cannot be trusted, so a sync is needed.
    const isStaleCheckBroken = staleCheck._tag === 'Left';
    const isSyncNeeded = isStaleCheckBroken || staleCheck.right;
    const isSyncSkipped = !isSyncNeeded;
    if (isSyncSkipped) return { isStale: false, report: null };
    const syncRequest: StatsSyncRequest = { appName, days: DEFAULT_SYNC_DAYS };
    const syncAttempt = yield* syncStats(syncRequest).pipe(Effect.either);
    const hasSyncFailed = syncAttempt._tag === 'Left';
    if (hasSyncFailed) return { isStale: true, report: null };
    const report = syncAttempt.right;
    const hasFeedFailed = report.appFeeds.some((appFeed) => appFeed.status === 'failed');
    return { isStale: hasFeedFailed, report };
  });
