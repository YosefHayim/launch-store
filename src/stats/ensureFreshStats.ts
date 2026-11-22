import { findAppsByName } from '../portfolio/portfolioLogic.ts';
import type { PortfolioApp } from '../types/portfolio.ts';
import type { AppFeedSyncReport, StatsFreshness } from '../types/stats.ts';
import { findFeedCoverage, isFeedCoverageStale } from './coverageLogic.ts';
import { loadAppCoverage } from './coverageStore.ts';
import { DEFAULT_SYNC_DAYS } from './dateRange.ts';
import { STATS_FEED_PLUGINS } from './feedRegistry.ts';
import { loadStatsPortfolio, syncStats } from './syncStats.ts';

function isFeedFailed(appFeed: AppFeedSyncReport): boolean {
  return appFeed.status == 'failed';
}

async function isAnyFeedStale(
  apps: readonly PortfolioApp[],
  nowMilliseconds: number,
): Promise<boolean> {
  for (const app of apps) {
    const appCoverage = await loadAppCoverage(app.key);

    for (const plugin of STATS_FEED_PLUGINS) {
      const isFeedApplicable = plugin.isApplicable(app);

      if (isFeedApplicable == false) {
        continue;
      }

      const feedCoverage = findFeedCoverage(appCoverage, plugin.feed);
      const isFeedOutOfDate = isFeedCoverageStale(feedCoverage, nowMilliseconds);

      if (isFeedOutOfDate) {
        return true;
      }
    }
  }

  return false;
}

async function findAppsToCheck(appName: string | null): Promise<readonly PortfolioApp[]> {
  const portfolioLoad = await loadStatsPortfolio('cache-first');
  const isEveryAppWanted = appName == null;

  if (isEveryAppWanted) {
    return portfolioLoad.apps;
  }

  return findAppsByName(portfolioLoad.apps, appName);
}

export async function ensureFreshStats(appName: string | null): Promise<StatsFreshness> {
  const nowMilliseconds = Date.now();
  var isSyncNeeded = false;

  try {
    const apps = await findAppsToCheck(appName);
    isSyncNeeded = await isAnyFeedStale(apps, nowMilliseconds);
  } catch (cause) {
    const isCoverageUnreadable = cause != null;

    if (isCoverageUnreadable) {
      isSyncNeeded = true;
    }
  }

  if (isSyncNeeded == false) {
    return { isStale: false, report: null };
  }

  try {
    const report = await syncStats({ appName, days: DEFAULT_SYNC_DAYS });
    const hasFeedFailed = report.appFeeds.some(isFeedFailed);

    return { isStale: hasFeedFailed, report };
  } catch (cause) {
    const isSyncFailed = cause != null;

    if (isSyncFailed) {
      return { isStale: true, report: null };
    }

    return { isStale: true, report: null };
  }
}
