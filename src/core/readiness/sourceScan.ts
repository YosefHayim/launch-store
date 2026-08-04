import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';

const SOURCE_SCAN_SKIP_DIRECTORIES = new Set([
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
const MAX_SCAN_DEPTH = 8;
const MAX_SCANNED_FILES = 5000;

export type SourceScanRequirements = FileSystem.FileSystem | Path.Path;

/** Read the simple top-level directory exclusions declared in `.gitignore`. */
const readIgnoredDirectories = (
  sourceRoot: string,
): Effect.Effect<Set<string>, never, SourceScanRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const gitignorePath = pathService.join(sourceRoot, '.gitignore');
    const gitignoreExists = yield* fileSystem
      .exists(gitignorePath)
      .pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (!gitignoreExists) return new Set<string>();

    const gitignoreSource = yield* fileSystem
      .readFileString(gitignorePath)
      .pipe(Effect.catchAll(() => Effect.succeed('')));
    const ignoredDirectories = new Set<string>();
    for (const rawLine of gitignoreSource.split('\n')) {
      let ignorePattern = rawLine.trim();
      if (ignorePattern.length === 0) continue;
      if (ignorePattern.startsWith('#')) continue;
      if (ignorePattern.startsWith('!')) continue;
      if (ignorePattern.includes('*')) continue;
      if (ignorePattern.startsWith('/')) ignorePattern = ignorePattern.slice(1);
      if (ignorePattern.endsWith('/')) ignorePattern = ignorePattern.slice(0, -1);
      if (ignorePattern.length === 0) continue;
      if (ignorePattern.includes('/')) continue;
      ignoredDirectories.add(ignorePattern);
    }
    return ignoredDirectories;
  });

export const walkAppSource = <InspectionFailure, InspectionRequirements>(
  sourceRoot: string,
  inspectFile: (
    filePath: string,
    fileExtension: string,
  ) => Effect.Effect<boolean, InspectionFailure, InspectionRequirements>,
): Effect.Effect<void, InspectionFailure, SourceScanRequirements | InspectionRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const ignoredDirectories = yield* readIgnoredDirectories(sourceRoot);
    const skippedDirectories = new Set([...SOURCE_SCAN_SKIP_DIRECTORIES, ...ignoredDirectories]);
    let scannedFileCount = 0;

    const walkDirectory = (
      directoryPath: string,
      directoryDepth: number,
    ): Effect.Effect<boolean, InspectionFailure, InspectionRequirements> =>
      Effect.gen(function* () {
        if (directoryDepth > MAX_SCAN_DEPTH) return false;
        if (scannedFileCount >= MAX_SCANNED_FILES) return true;

        const entryNames = yield* fileSystem
          .readDirectory(directoryPath)
          .pipe(Effect.catchAll(() => Effect.succeed([])));
        for (const entryName of entryNames) {
          if (scannedFileCount >= MAX_SCANNED_FILES) return true;
          const entryPath = pathService.join(directoryPath, entryName);
          const entryMetadata = yield* fileSystem
            .stat(entryPath)
            .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
          if (entryMetadata === undefined) continue;
          if (entryMetadata.type === 'SymbolicLink') continue;
          if (entryMetadata.type === 'Directory') {
            if (skippedDirectories.has(entryName)) continue;
            if (entryName.startsWith('.')) continue;
            const nestedScanStopped = yield* walkDirectory(entryPath, directoryDepth + 1);
            if (nestedScanStopped) return true;
            continue;
          }
          if (entryMetadata.type !== 'File') continue;
          scannedFileCount += 1;
          const scanStopped = yield* inspectFile(
            entryPath,
            pathService.extname(entryName).toLowerCase(),
          );
          if (scanStopped) return true;
        }
        return false;
      });

    yield* walkDirectory(sourceRoot, 0);
  });
