import type { AppTagChange } from '../types/portfolio.ts';
import { applyTagChange } from './portfolio-logic.ts';
import { loadPortfolioFile, pickSavedPortfolioFile, savePortfolioFile } from './portfolio-store.ts';

export async function saveAppTags(appKeys: readonly string[], change: AppTagChange): Promise<void> {
  const savedFile = await loadPortfolioFile();
  const currentFile = pickSavedPortfolioFile(savedFile);
  const tags = applyTagChange(currentFile.tags, appKeys, change);

  await savePortfolioFile({ ...currentFile, tags });
}
