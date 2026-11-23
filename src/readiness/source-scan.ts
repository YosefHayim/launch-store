import type { Stats } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathExists } from '../path-exists.ts';
import { errorMessage } from '../services/platform/error-message.ts';

const sourceScanSkipDirectories = new Set([
  'node_modules',
  '.git',
  '.expo',
  '.launch',
  'dist',
  'build',
  '.next',
  'coverage',
  'vendor',
  'Pods',
]);

const MAX_SCANNED_FILES = 5000;
const maxScanDepth = 8;

/** Read the simple top-level directory exclusions declared in `.gitignore`. */
async function readIgnoredDirectories(sourceRoot: string): Promise<Set<string>> {
  const gitignorePath = join(sourceRoot, '.gitignore');
  const gitignoreExists = await pathExists(gitignorePath);

  if (gitignoreExists == false) {
    return new Set<string>();
  }

  let gitignoreSource = '';

  try {
    gitignoreSource = await readFile(gitignorePath, 'utf8');
  } catch (cause) {
    const isUnreadable = errorMessage(cause) != '';

    if (isUnreadable) {
      return new Set<string>();
    }

    return new Set<string>();
  }

  const ignoredDirectories = new Set<string>();

  for (const rawLine of gitignoreSource.split('\n')) {
    let ignorePattern = rawLine.trim();

    const isBlank = ignorePattern.length == 0;

    if (isBlank) {
      continue;
    }

    const isComment = ignorePattern.startsWith('#');

    if (isComment) {
      continue;
    }

    const isNegated = ignorePattern.startsWith('!');

    if (isNegated) {
      continue;
    }

    const hasWildcard = ignorePattern.includes('*');

    if (hasWildcard) {
      continue;
    }

    const isRooted = ignorePattern.startsWith('/');

    if (isRooted) {
      ignorePattern = ignorePattern.slice(1);
    }

    const isDirectoryPattern = ignorePattern.endsWith('/');

    if (isDirectoryPattern) {
      ignorePattern = ignorePattern.slice(0, -1);
    }

    const isPatternEmpty = ignorePattern.length == 0;

    if (isPatternEmpty) {
      continue;
    }

    const isNestedPattern = ignorePattern.includes('/');

    if (isNestedPattern) {
      continue;
    }

    ignoredDirectories.add(ignorePattern);
  }

  return ignoredDirectories;
}

export async function walkAppSource(
  sourceRoot: string,
  inspectFile: (filePath: string, fileExtension: string) => Promise<boolean>,
): Promise<void> {
  const ignoredDirectories = await readIgnoredDirectories(sourceRoot);
  const skippedDirectories = new Set([...sourceScanSkipDirectories, ...ignoredDirectories]);
  let scannedFileCount = 0;

  async function walkDirectory(directoryPath: string, directoryDepth: number): Promise<boolean> {
    const isPastMaxDepth = directoryDepth > maxScanDepth;

    if (isPastMaxDepth) {
      return false;
    }

    const isFileCapReached = scannedFileCount >= MAX_SCANNED_FILES;

    if (isFileCapReached) {
      return true;
    }

    let entryNames: string[] = [];

    try {
      entryNames = await readdir(directoryPath);
    } catch (cause) {
      const isUnreadable = errorMessage(cause) != '';

      if (isUnreadable) {
        return false;
      }

      return false;
    }

    for (const entryName of entryNames) {
      const isCapReached = scannedFileCount >= MAX_SCANNED_FILES;

      if (isCapReached) {
        return true;
      }

      const entryPath = join(directoryPath, entryName);
      let entryMetadata: Stats | null = null;

      try {
        entryMetadata = await lstat(entryPath);
      } catch (cause) {
        const isUnreadable = errorMessage(cause) != '';

        if (isUnreadable) {
          continue;
        }

        continue;
      }

      const isMissing = entryMetadata == null;

      if (isMissing) {
        continue;
      }

      const isSymbolicLink = entryMetadata.isSymbolicLink();

      if (isSymbolicLink) {
        continue;
      }

      const isDirectory = entryMetadata.isDirectory();

      if (isDirectory) {
        const isSkippedDirectory = skippedDirectories.has(entryName);

        if (isSkippedDirectory) {
          continue;
        }

        const isHiddenDirectory = entryName.startsWith('.');

        if (isHiddenDirectory) {
          continue;
        }

        const nestedScanStopped = await walkDirectory(entryPath, directoryDepth + 1);

        if (nestedScanStopped) {
          return true;
        }

        continue;
      }

      const isFile = entryMetadata.isFile();

      if (isFile == false) {
        continue;
      }

      scannedFileCount += 1;

      const scanStopped = await inspectFile(entryPath, extname(entryName).toLowerCase());

      if (scanStopped) {
        return true;
      }
    }

    return false;
  }

  await walkDirectory(sourceRoot, 0);
}
