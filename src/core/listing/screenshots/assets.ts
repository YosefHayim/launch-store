import { FileSystem, Path } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Effect } from 'effect';
import { createHash } from 'node:crypto';

export const SCREENSHOTS_DIRNAME = 'screenshots';
export const MAX_SCREENSHOTS_PER_SET = 10;
export const PREVIEWS_DIRNAME = 'previews';
export const MAX_PREVIEWS_PER_SET = 3;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const VIDEO_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v']);

export type LocalAsset = {
  readonly path: string;
  readonly fileName: string;
  readonly checksum: string;
  readonly size: number;
};

export type LocalScreenshot = LocalAsset & {
  readonly locale: string;
  readonly displayType: string;
};

export type LocalPreview = LocalAsset & {
  readonly locale: string;
  readonly previewType: string;
};

export const hashFile = (
  filePath: string,
): Effect.Effect<Pick<LocalAsset, 'checksum' | 'size'>, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const fileBytes = yield* fileSystem.readFile(filePath);
    return {
      checksum: createHash('md5').update(fileBytes).digest('hex'),
      size: fileBytes.byteLength,
    };
  });

const listChildDirectories = (
  directoryPath: string,
): Effect.Effect<readonly string[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const directoryExists = yield* fileSystem.exists(directoryPath);
    if (!directoryExists) return [];

    const childNames = yield* fileSystem.readDirectory(directoryPath);
    childNames.sort();
    const directoryCandidates = yield* Effect.forEach(
      childNames,
      (childName) =>
        Effect.gen(function* () {
          const childPath = pathService.join(directoryPath, childName);
          const childMetadata = yield* fileSystem.stat(childPath);
          if (childMetadata.type !== 'Directory') return null;
          return childName;
        }),
      { concurrency: 1 },
    );

    const directoryNames: string[] = [];
    for (const directoryCandidate of directoryCandidates) {
      if (directoryCandidate !== null) directoryNames.push(directoryCandidate);
    }
    return directoryNames;
  });

const listMediaFileNames = (
  directoryPath: string,
  acceptedExtensions: ReadonlySet<string>,
): Effect.Effect<readonly string[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const childNames = yield* fileSystem.readDirectory(directoryPath);
    childNames.sort();

    const mediaCandidates = yield* Effect.forEach(
      childNames,
      (childName) =>
        Effect.gen(function* () {
          const fileExtension = pathService.extname(childName).toLowerCase();
          if (!acceptedExtensions.has(fileExtension)) return null;
          const childPath = pathService.join(directoryPath, childName);
          const childMetadata = yield* fileSystem.stat(childPath);
          if (childMetadata.type !== 'File') return null;
          return childName;
        }),
      { concurrency: 1 },
    );

    const mediaFileNames: string[] = [];
    for (const mediaCandidate of mediaCandidates) {
      if (mediaCandidate !== null) mediaFileNames.push(mediaCandidate);
    }
    return mediaFileNames;
  });

export const discoverScreenshotsAt = (
  screenshotsRoot: string,
): Effect.Effect<readonly LocalScreenshot[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const localeNames = yield* listChildDirectories(screenshotsRoot);
    const screenshotsByLocale = yield* Effect.forEach(
      localeNames,
      (locale) =>
        Effect.gen(function* () {
          const localeDirectory = pathService.join(screenshotsRoot, locale);
          const displayTypes = yield* listChildDirectories(localeDirectory);
          const screenshotsByDisplayType = yield* Effect.forEach(
            displayTypes,
            (displayType) =>
              Effect.gen(function* () {
                const displayTypeDirectory = pathService.join(localeDirectory, displayType);
                const fileNames = yield* listMediaFileNames(displayTypeDirectory, IMAGE_EXTENSIONS);
                return yield* Effect.forEach(
                  fileNames,
                  (fileName) =>
                    Effect.gen(function* () {
                      const screenshotPath = pathService.join(displayTypeDirectory, fileName);
                      const fingerprint = yield* hashFile(screenshotPath);
                      return {
                        locale,
                        displayType,
                        fileName,
                        path: screenshotPath,
                        checksum: fingerprint.checksum,
                        size: fingerprint.size,
                      };
                    }),
                  { concurrency: 1 },
                );
              }),
            { concurrency: 1 },
          );
          return screenshotsByDisplayType.flat();
        }),
      { concurrency: 1 },
    );
    return screenshotsByLocale.flat();
  });

export const discoverScreenshots = (
  appDirectory: string,
): Effect.Effect<readonly LocalScreenshot[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return yield* discoverScreenshotsAt(pathService.join(appDirectory, SCREENSHOTS_DIRNAME));
  });

export const fingerprintAsset = (
  appDirectory: string,
  declaredPath: string,
): Effect.Effect<LocalAsset | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    let assetPath = declaredPath;
    if (!pathService.isAbsolute(declaredPath))
      assetPath = pathService.join(appDirectory, declaredPath);

    const assetExists = yield* fileSystem.exists(assetPath);
    if (!assetExists) return null;
    const assetMetadata = yield* fileSystem.stat(assetPath);
    if (assetMetadata.type !== 'File') return null;

    const fingerprint = yield* hashFile(assetPath);
    return {
      path: assetPath,
      fileName: pathService.basename(assetPath),
      checksum: fingerprint.checksum,
      size: fingerprint.size,
    };
  });

export const discoverPreviews = (
  appDirectory: string,
): Effect.Effect<readonly LocalPreview[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const previewsRoot = pathService.join(appDirectory, PREVIEWS_DIRNAME);
    const localeNames = yield* listChildDirectories(previewsRoot);
    const previewsByLocale = yield* Effect.forEach(
      localeNames,
      (locale) =>
        Effect.gen(function* () {
          const localeDirectory = pathService.join(previewsRoot, locale);
          const previewTypes = yield* listChildDirectories(localeDirectory);
          const previewsByType = yield* Effect.forEach(
            previewTypes,
            (previewType) =>
              Effect.gen(function* () {
                const previewTypeDirectory = pathService.join(localeDirectory, previewType);
                const fileNames = yield* listMediaFileNames(previewTypeDirectory, VIDEO_EXTENSIONS);
                return yield* Effect.forEach(
                  fileNames,
                  (fileName) =>
                    Effect.gen(function* () {
                      const previewPath = pathService.join(previewTypeDirectory, fileName);
                      const fingerprint = yield* hashFile(previewPath);
                      return {
                        locale,
                        previewType,
                        fileName,
                        path: previewPath,
                        checksum: fingerprint.checksum,
                        size: fingerprint.size,
                      };
                    }),
                  { concurrency: 1 },
                );
              }),
            { concurrency: 1 },
          );
          return previewsByType.flat();
        }),
      { concurrency: 1 },
    );
    return previewsByLocale.flat();
  });
