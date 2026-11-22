import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
import { pathExists } from '../../path-exists.ts';

export const SCREENSHOTS_DIRNAME = 'screenshots';
export const MAX_SCREENSHOTS_PER_SET = 10;
export const PREVIEWS_DIRNAME = 'previews';
export const MAX_PREVIEWS_PER_SET = 3;

const imageExtensions = new Set(['.png', '.jpg', '.jpeg']);
const videoExtensions = new Set(['.mov', '.mp4', '.m4v']);

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

export async function hashFile(filePath: string): Promise<Pick<LocalAsset, 'checksum' | 'size'>> {
  try {
    const fileBytes = await readFile(filePath);
    const checksum = createHash('md5').update(fileBytes).digest('hex');

    return { checksum, size: fileBytes.byteLength };
  } catch (error) {
    throw new Error(`Could not read ${filePath}`, { cause: error });
  }
}

async function readSortedNames(directoryPath: string): Promise<readonly string[]> {
  try {
    const childNames = await readdir(directoryPath);

    return [...childNames].sort();
  } catch (error) {
    throw new Error(`Could not read ${directoryPath}`, { cause: error });
  }
}

async function readMetadata(filePath: string): Promise<Stats> {
  try {
    return await stat(filePath);
  } catch (error) {
    throw new Error(`Could not read ${filePath}`, { cause: error });
  }
}

async function listChildDirectories(directoryPath: string): Promise<readonly string[]> {
  const directoryExists = await pathExists(directoryPath);

  if (directoryExists == false) {
    return [];
  }

  const childNames = await readSortedNames(directoryPath);
  const directoryNames: string[] = [];

  for (const childName of childNames) {
    const childPath = join(directoryPath, childName);
    const childMetadata = await readMetadata(childPath);
    const isDirectory = childMetadata.isDirectory();

    if (isDirectory == false) {
      continue;
    }

    directoryNames.push(childName);
  }

  return directoryNames;
}

async function listMediaFileNames(
  directoryPath: string,
  acceptedExtensions: ReadonlySet<string>,
): Promise<readonly string[]> {
  const childNames = await readSortedNames(directoryPath);
  const mediaFileNames: string[] = [];

  for (const childName of childNames) {
    const fileExtension = extname(childName).toLowerCase();
    const isAcceptedExtension = acceptedExtensions.has(fileExtension);

    if (isAcceptedExtension == false) {
      continue;
    }

    const childPath = join(directoryPath, childName);
    const childMetadata = await readMetadata(childPath);
    const isFile = childMetadata.isFile();

    if (isFile == false) {
      continue;
    }

    mediaFileNames.push(childName);
  }

  return mediaFileNames;
}

export async function discoverScreenshotsAt(
  screenshotsRoot: string,
): Promise<readonly LocalScreenshot[]> {
  const localeNames = await listChildDirectories(screenshotsRoot);
  const screenshots: LocalScreenshot[] = [];

  for (const locale of localeNames) {
    const localeDirectory = join(screenshotsRoot, locale);
    const displayTypes = await listChildDirectories(localeDirectory);

    for (const displayType of displayTypes) {
      const displayTypeDirectory = join(localeDirectory, displayType);
      const fileNames = await listMediaFileNames(displayTypeDirectory, imageExtensions);

      for (const fileName of fileNames) {
        const screenshotPath = join(displayTypeDirectory, fileName);
        const fingerprint = await hashFile(screenshotPath);

        screenshots.push({
          locale,
          displayType,
          fileName,
          path: screenshotPath,
          checksum: fingerprint.checksum,
          size: fingerprint.size,
        });
      }
    }
  }

  return screenshots;
}

export async function discoverScreenshots(
  appDirectory: string,
): Promise<readonly LocalScreenshot[]> {
  const screenshotsRoot = join(appDirectory, SCREENSHOTS_DIRNAME);

  return discoverScreenshotsAt(screenshotsRoot);
}

export async function fingerprintAsset(
  appDirectory: string,
  declaredPath: string,
): Promise<LocalAsset | null> {
  let assetPath = declaredPath;
  const isRelativePath = isAbsolute(declaredPath) == false;

  if (isRelativePath) {
    assetPath = join(appDirectory, declaredPath);
  }

  const assetExists = await pathExists(assetPath);

  if (assetExists == false) {
    return null;
  }

  const assetMetadata = await readMetadata(assetPath);
  const isFile = assetMetadata.isFile();

  if (isFile == false) {
    return null;
  }

  const fingerprint = await hashFile(assetPath);

  return {
    path: assetPath,
    fileName: basename(assetPath),
    checksum: fingerprint.checksum,
    size: fingerprint.size,
  };
}

export async function discoverPreviews(appDirectory: string): Promise<readonly LocalPreview[]> {
  const previewsRoot = join(appDirectory, PREVIEWS_DIRNAME);
  const localeNames = await listChildDirectories(previewsRoot);
  const previews: LocalPreview[] = [];

  for (const locale of localeNames) {
    const localeDirectory = join(previewsRoot, locale);
    const previewTypes = await listChildDirectories(localeDirectory);

    for (const previewType of previewTypes) {
      const previewTypeDirectory = join(localeDirectory, previewType);
      const fileNames = await listMediaFileNames(previewTypeDirectory, videoExtensions);

      for (const fileName of fileNames) {
        const previewPath = join(previewTypeDirectory, fileName);
        const fingerprint = await hashFile(previewPath);

        previews.push({
          locale,
          previewType,
          fileName,
          path: previewPath,
          checksum: fingerprint.checksum,
          size: fingerprint.size,
        });
      }
    }
  }

  return previews;
}
