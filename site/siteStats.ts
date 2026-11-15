import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { countAsyncMethods, countTestCases } from '../src/core/docs/commandDocs/common.js';

export type SiteStats = Readonly<{ operations: number; tests: number }>;

const collectTestSources = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectTestSources(entryPath);
    if (entry.name.endsWith('.test.ts')) return [readFileSync(entryPath, 'utf8')];
    return [];
  });

export const readSiteStats = (repoRoot: string): SiteStats => {
  const operations =
    countAsyncMethods(readFileSync(join(repoRoot, 'src/apple/ascClient.ts'), 'utf8')) +
    countAsyncMethods(readFileSync(join(repoRoot, 'src/google/playClient.ts'), 'utf8'));
  const tests = countTestCases(collectTestSources(join(repoRoot, 'src')));
  return { operations, tests };
};
