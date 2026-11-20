import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { countTestCases } from '../src/core/docs/commandDocs/common.js';

export type SiteStats = Readonly<{ operations: number; tests: number }>;

const collectTestSources = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectTestSources(entryPath);
    if (entry.name.endsWith('.test.ts')) return [readFileSync(entryPath, 'utf8')];
    return [];
  });

function countAsyncMethods(source: string): number {
  // Counts a method written as `const name = async` or `async name`.
  const methodMatches = source.match(
    /^[ \t]*(?:const\s+[A-Za-z_$][\w$]*\s*=\s*async\b|async\s+[A-Za-z_$])/gm,
  );
  const isThereNoMethod = methodMatches == null;

  if (isThereNoMethod) return 0;

  return methodMatches.length;
}

function collectImplementationSources(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(readImplementationEntry);

  function readImplementationEntry(entry: Dirent): readonly string[] {
    const entryPath = join(directory, entry.name);
    const isDirectory = entry.isDirectory();

    if (isDirectory) return collectImplementationSources(entryPath);

    const isTestFile = entry.name.endsWith('.test.ts');

    if (isTestFile) return [];

    const isTypeScriptFile = entry.name.endsWith('.ts');

    if (isTypeScriptFile) return [readFileSync(entryPath, 'utf8')];

    return [];
  }
}

function countOperations(sources: readonly string[]): number {
  let operationCount = 0;

  for (const source of sources) {
    operationCount += countAsyncMethods(source);
  }

  return operationCount;
}

export const readSiteStats = (repoRoot: string): SiteStats => {
  const appleSources = collectImplementationSources(join(repoRoot, 'src/app-store-connect-api'));
  const playSources = collectImplementationSources(join(repoRoot, 'src/play-console-api'));
  const appleOperations = countOperations(appleSources);
  const playOperations = countOperations(playSources);
  const operations = appleOperations + playOperations;
  const testSources = collectTestSources(join(repoRoot, 'src'));
  const tests = countTestCases(testSources);

  return { operations, tests };
};
