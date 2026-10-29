import type { FileSystem, Path } from '@effect/platform';
import { Clock, Effect } from 'effect';
import type { JsonFileFailure } from '../services/atomicJsonFile.js';
import type { LaunchPathsService } from '../services/paths.js';
import type { StatsCredentialsShape } from '../types/stats.js';
import type { PortfolioFile, PortfolioLoad, PortfolioLoadMode } from '../types/portfolio.js';
import { discoverApps } from './discoverApps.js';
import { keepCachedAppsOfFailedSources, joinTags } from './portfolioLogic.js';
import {
  createEmptyPortfolioFile,
  loadPortfolioFile,
  savePortfolioFile,
} from './portfolioStore.js';

type LoadPortfolioRequirements =
  | FileSystem.FileSystem
  | LaunchPathsService
  | Path.Path
  | StatsCredentialsShape;

/** True when every source that was asked failed, so nothing fresh is known. */
const isEverySourceFailed = (attemptedSourceCount: number, failedSourceCount: number): boolean =>
  attemptedSourceCount > 0 && failedSourceCount === attemptedSourceCount;

/**
 * Load the apps with their tags. `discover` asks the stores and saves `portfolio.json`; `cache-first`
 * reuses the saved file and only discovers when there is none. When every store fails, the saved
 * file answers with warnings.
 */
export const loadPortfolioApps = (
  mode: PortfolioLoadMode,
): Effect.Effect<PortfolioLoad, JsonFileFailure, LoadPortfolioRequirements> =>
  Effect.gen(function* () {
    const cachedFile = yield* loadPortfolioFile();
    const isCacheUsable = mode === 'cache-first' && cachedFile !== null;
    if (isCacheUsable) {
      return { apps: joinTags(cachedFile.apps, cachedFile.tags), warnings: [], isFromCache: true };
    }
    const report = yield* discoverApps();
    let savedFile: PortfolioFile = createEmptyPortfolioFile();
    if (cachedFile !== null) savedFile = cachedFile;
    const isDiscoveryUseless = isEverySourceFailed(
      report.attemptedSourceCount,
      report.failedAccountLabels.length,
    );
    if (isDiscoveryUseless) {
      return {
        apps: joinTags(savedFile.apps, savedFile.tags),
        warnings: report.warnings,
        isFromCache: true,
      };
    }
    const apps = keepCachedAppsOfFailedSources(
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
    };
    yield* savePortfolioFile(refreshedFile);
    return {
      apps: joinTags(apps, refreshedFile.tags),
      warnings: report.warnings,
      isFromCache: false,
    };
  });
