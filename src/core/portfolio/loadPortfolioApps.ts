import type { FileSystem, Path } from '@effect/platform';
import { Clock, Effect } from 'effect';
import type { DocumentFileFailure } from '../services/atomicDocumentFile.js';
import type { LaunchPathsService } from '../services/paths.js';
import type { StatsCredentialsShape } from '../types/stats.js';
import type { PortfolioFile, PortfolioLoad, PortfolioLoadMode } from '../types/portfolio.js';
import { discoverApps } from './discoverApps.js';
import { keepCachedAppsOfFailedAccounts, joinTags } from './portfolioLogic.js';
import { loadPortfolioFile, pickSavedPortfolioFile, savePortfolioFile } from './portfolioStore.js';

type LoadPortfolioRequirements =
  | FileSystem.FileSystem
  | LaunchPathsService
  | Path.Path
  | StatsCredentialsShape;

const isEveryAccountFailed = (attemptedAccountCount: number, failedAccountCount: number): boolean =>
  attemptedAccountCount > 0 && failedAccountCount === attemptedAccountCount;

export const loadPortfolioApps = (
  mode: PortfolioLoadMode,
): Effect.Effect<PortfolioLoad, DocumentFileFailure, LoadPortfolioRequirements> =>
  Effect.gen(function* () {
    const cachedFile = yield* loadPortfolioFile();
    const isCacheUsable = mode === 'cache-first' && cachedFile !== null;
    if (isCacheUsable) {
      return { apps: joinTags(cachedFile.apps, cachedFile.tags), warnings: [], isFromCache: true };
    }
    const report = yield* discoverApps();
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
    const discoveredAtMilliseconds = yield* Clock.currentTimeMillis;
    const refreshedFile: PortfolioFile = {
      version: 1,
      discoveredAt: new Date(discoveredAtMilliseconds).toISOString(),
      apps,
      tags: savedFile.tags,
      playReportsBucket: savedFile.playReportsBucket,
    };
    yield* savePortfolioFile(refreshedFile);
    return {
      apps: joinTags(apps, refreshedFile.tags),
      warnings: report.warnings,
      isFromCache: false,
    };
  });
