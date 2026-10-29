import type { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import type { JsonFileFailure } from '../services/atomicJsonFile.js';
import type { LaunchPathsService } from '../services/paths.js';
import type { AppTagChange } from '../types/portfolio.js';
import { applyTagChange } from './portfolioLogic.js';
import {
  createEmptyPortfolioFile,
  loadPortfolioFile,
  savePortfolioFile,
} from './portfolioStore.js';

/** Save a tag change for the given apps into `portfolio.json`; the tags of other apps stay as they are. */
export const saveAppTags = (
  appKeys: readonly string[],
  change: AppTagChange,
): Effect.Effect<void, JsonFileFailure, FileSystem.FileSystem | LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const savedFile = yield* loadPortfolioFile();
    let currentFile = createEmptyPortfolioFile();
    if (savedFile !== null) currentFile = savedFile;
    const tags = applyTagChange(currentFile.tags, appKeys, change);
    yield* savePortfolioFile({ ...currentFile, tags });
  });
