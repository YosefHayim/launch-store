import type { AppTagChange } from '../types/portfolio.js';
import { applyTagChange } from './portfolioLogic.js';
import { loadPortfolioFile, pickSavedPortfolioFile, savePortfolioFile } from './portfolioStore.js';

export async function saveAppTags(appKeys: readonly string[], change: AppTagChange): Promise<void> {
  const savedFile = await loadPortfolioFile();
  const currentFile = pickSavedPortfolioFile(savedFile);
  const tags = applyTagChange(currentFile.tags, appKeys, change);

  await savePortfolioFile({ ...currentFile, tags });
}
