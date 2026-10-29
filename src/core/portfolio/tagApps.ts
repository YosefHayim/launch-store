import type { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import type { DocumentFileFailure } from '../services/atomicDocumentFile.js';
import type { LaunchPathsService } from '../services/paths.js';
import type { AppTagChange } from '../types/portfolio.js';
import { applyTagChange } from './portfolioLogic.js';
import { loadPortfolioFile, pickSavedPortfolioFile, savePortfolioFile } from './portfolioStore.js';

export const saveAppTags = (
  appKeys: readonly string[],
  change: AppTagChange,
): Effect.Effect<
  void,
  DocumentFileFailure,
  FileSystem.FileSystem | LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const savedFile = yield* loadPortfolioFile();
    const currentFile = pickSavedPortfolioFile(savedFile);
    const tags = applyTagChange(currentFile.tags, appKeys, change);
    yield* savePortfolioFile({ ...currentFile, tags });
  });
