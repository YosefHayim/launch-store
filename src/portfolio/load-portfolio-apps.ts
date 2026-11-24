// Returns the saved app list, or discovers App Store Connect and Google Play again.

import type { PortfolioFile, PortfolioLoad, PortfolioLoadMode } from '../types/portfolio.ts';
import { discoverApps } from './discover-apps.ts';
import { joinTags, keepCachedAppsOfFailedAccounts } from './portfolio-apps.ts';
import { loadPortfolioFile, pickSavedPortfolioFile, savePortfolioFile } from './portfolio-store.ts';

function isCacheUsable(
  mode: PortfolioLoadMode,
  cachedFile: PortfolioFile | null,
): cachedFile is PortfolioFile {
  if (mode != 'cache-first') {
    return false;
  }

  return cachedFile != null;
}

function isEveryAccountFailed(attemptedAccountCount: number, failedAccountCount: number): boolean {
  if (attemptedAccountCount == 0) {
    return false;
  }

  return failedAccountCount == attemptedAccountCount;
}

export async function loadPortfolioApps(mode: PortfolioLoadMode): Promise<PortfolioLoad> {
  const cachedFile = await loadPortfolioFile();

  if (isCacheUsable(mode, cachedFile)) {
    return {
      apps: joinTags(cachedFile.apps, cachedFile.tags),
      warnings: [],
      isFromCache: true,
    };
  }

  const report = await discoverApps();
  const savedFile = pickSavedPortfolioFile(cachedFile);

  const isDiscoveryUseless = isEveryAccountFailed(
    report.attemptedAccountCount,
    report.failedAccountLabels.length,
  );

  if (isDiscoveryUseless) {
    return {
      apps: joinTags(savedFile.apps, savedFile.tags),
      warnings: report.warnings,
      isFromCache: true,
    };
  }

  const apps = keepCachedAppsOfFailedAccounts(
    report.apps,
    savedFile.apps,
    report.failedAccountLabels,
  );
  const discoveredAtMilliseconds = Date.now();
  const refreshedFile: PortfolioFile = {
    version: 1,
    discoveredAt: new Date(discoveredAtMilliseconds).toISOString(),
    apps,
    tags: savedFile.tags,
    playReportsBucket: savedFile.playReportsBucket,
  };

  await savePortfolioFile(refreshedFile);

  return {
    apps: joinTags(apps, refreshedFile.tags),
    warnings: report.warnings,
    isFromCache: false,
  };
}
