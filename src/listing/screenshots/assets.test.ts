import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverPreviews,
  discoverScreenshots,
  fingerprintAsset,
  hashFile,
  PREVIEWS_DIRNAME,
  SCREENSHOTS_DIRNAME,
} from './assets.ts';
import {
  APPLE_ASSET_TARGETS,
  appleDisplayTypeLabel,
  applePreviewTypeLabel,
  findAppleAssetTarget,
  findApplePreviewTarget,
  findAppleScreenshotTarget,
} from './targets.ts';
import type { LocalAsset } from './assets.ts';

const tmpDirs: string[] = [];
function workDir(): string {
  const systemTemporaryDirectory = tmpdir();
  const screenshotAssetsTestPath = join(systemTemporaryDirectory, 'screenshot-assets-test-');
  const dir = mkdtempSync(screenshotAssetsTestPath);

  tmpDirs.push(dir);

  return dir;
}
function cleanup() {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

afterEach(cleanup);
/** Write a file under `appDir`, creating parent folders, and return its absolute path. */
function writeFile(appDir: string, relPath: string, contents: string): string {
  const path = join(appDir, relPath);
  const joinedPath = join(path, '..');

  mkdirSync(joinedPath, { recursive: true });
  writeFileSync(path, contents);

  return path;
}
function md5(text: string): string {
  const bufferBytes = Buffer.from(text);
  return createHash('md5').update(bufferBytes).digest('hex');
}
function describeHashFile() {
  async function returnsTheMD5HexAndByteLengthOfAFile() {
    const appDir = workDir();
    const path = writeFile(appDir, 'a.png', 'pixels');
    expect(await hashFile(path)).toEqual({ checksum: md5('pixels'), size: 6 });
  }

  it('returns the MD5 hex and byte length of a file', returnsTheMD5HexAndByteLengthOfAFile);
}

describe('hashFile', describeHashFile);
function describeDisplayTypeLabel() {
  function mapsAKnownConstantToAFriendlyLabel() {
    expect(appleDisplayTypeLabel('APP_IPHONE_67')).toBe('iPhone 6.7"');
    expect(appleDisplayTypeLabel('APP_DESKTOP')).toBe('Mac');
  }

  it('maps a known constant to a friendly label', mapsAKnownConstantToAFriendlyLabel);

  function fallsBackToThePieceConstantForAnUnknownNewHardwareType() {
    expect(appleDisplayTypeLabel('APP_IPHONE_69_FUTURE')).toBe('APP_IPHONE_69_FUTURE');
  }

  it(
    'falls back to the raw constant for an unknown (new-hardware) type',
    fallsBackToThePieceConstantForAnUnknownNewHardwareType,
  );
}

describe('displayTypeLabel', describeDisplayTypeLabel);
describe('Apple asset targets', () => {
  function resolvesTheSameTargetThroughItsKeyScreenshotTypeAndPreviewType() {
    const target = findAppleAssetTarget('iphone67');
    const appleScreenshotTarget = findAppleScreenshotTarget('APP_IPHONE_67');

    expect(target).toBe(appleScreenshotTarget);

    const applePreviewTarget = findApplePreviewTarget('IPHONE_67');

    expect(target).toBe(applePreviewTarget);
  }

  it(
    'resolves the same target through its key, screenshot type, and preview type',
    resolvesTheSameTargetThroughItsKeyScreenshotTypeAndPreviewType,
  );
  it('declares each screenshot and preview enum once', () => {
    expect(new Set(APPLE_ASSET_TARGETS.map((target) => target.screenshotDisplayType)).size).toBe(
      APPLE_ASSET_TARGETS.length,
    );

    const previewTypes = APPLE_ASSET_TARGETS.flatMap((target) => {
      if (target.previewType == null) return [];

      return [target.previewType];
    });

    expect(new Set(previewTypes).size).toBe(previewTypes.length);
  });
});
function describeDiscoverScreenshots() {
  async function returnsWhenTheConventionFolderIsAbsent() {
    const screenshots = await discoverScreenshots(workDir());
    expect(screenshots).toEqual([]);
  }

  it('returns [] when the convention folder is absent', returnsWhenTheConventionFolderIsAbsent);

  async function walksLocaleDisplayTypeFoldersFingerprintsImagesAndSortsDeterministically() {
    const appDir = workDir();

    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_IPHONE_67/02.png`, 'two');
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_IPHONE_67/01.png`, 'one');
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_DESKTOP/mac.jpg`, 'mac');
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/de-DE/APP_IPHONE_67/01.png`, 'eins');

    const shots = await discoverScreenshots(appDir);

    function listShotIdentity(
      s: LocalAsset & {
        readonly locale: string;
        readonly displayType: string;
      },
    ) {
      return [s.locale, s.displayType, s.fileName];
    }

    expect(shots.map(listShotIdentity)).toEqual([
      ['de-DE', 'APP_IPHONE_67', '01.png'],
      ['en-US', 'APP_DESKTOP', 'mac.jpg'],
      ['en-US', 'APP_IPHONE_67', '01.png'],
      ['en-US', 'APP_IPHONE_67', '02.png'],
    ]);

    function isEnglishShot(
      s: LocalAsset & {
        readonly locale: string;
        readonly displayType: string;
      },
    ) {
      return s.locale == 'en-US' && s.fileName == '01.png';
    }

    const iphone01 = shots.find(isEnglishShot);

    expect(iphone01?.checksum).toBe(md5('one'));
    expect(iphone01?.size).toBe(3);
  }

  it(
    'walks locale/displayType folders, fingerprints images, and sorts deterministically',
    walksLocaleDisplayTypeFoldersFingerprintsImagesAndSortsDeterministically,
  );

  async function ignoresNonImageFilesAndKeepsUnknownDisplayTypeFoldersAppleSEnumLagsNewHardware() {
    const appDir = workDir();

    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_IPHONE_69_FUTURE/01.png`, 'future');
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_IPHONE_69_FUTURE/notes.txt`, 'ignore me');
    writeFile(
      appDir,
      `${SCREENSHOTS_DIRNAME}/en-US/APP_IPHONE_69_FUTURE/sidecar.json`,
      '{"generationId":"run-001"}',
    );

    const shots = await discoverScreenshots(appDir);

    expect(shots).toHaveLength(1);
    expect(shots[0]?.displayType).toBe('APP_IPHONE_69_FUTURE');
    expect(shots[0]?.fileName).toBe('01.png');
  }

  it(
    "ignores non-image files and keeps unknown display-type folders (Apple's enum lags new hardware)",
    ignoresNonImageFilesAndKeepsUnknownDisplayTypeFoldersAppleSEnumLagsNewHardware,
  );
}

describe('discoverScreenshots', describeDiscoverScreenshots);
function describePreviewTypeLabel() {
  function mapsAKnownConstantToAFriendlyLabel2() {
    expect(applePreviewTypeLabel('IPHONE_67')).toBe('iPhone 6.7"');
    expect(applePreviewTypeLabel('DESKTOP')).toBe('Mac');
  }

  it('maps a known constant to a friendly label', mapsAKnownConstantToAFriendlyLabel2);

  function fallsBackToThePieceConstantForAnUnknownNewHardwareType2() {
    expect(applePreviewTypeLabel('IPHONE_69_FUTURE')).toBe('IPHONE_69_FUTURE');
  }

  it(
    'falls back to the raw constant for an unknown (new-hardware) type',
    fallsBackToThePieceConstantForAnUnknownNewHardwareType2,
  );
}

describe('previewTypeLabel', describePreviewTypeLabel);
function describeDiscoverPreviews() {
  async function returnsWhenTheConventionFolderIsAbsent2() {
    const previews = await discoverPreviews(workDir());
    expect(previews).toEqual([]);
  }

  it('returns [] when the convention folder is absent', returnsWhenTheConventionFolderIsAbsent2);

  async function walksLocalePreviewTypeFoldersFingerprintsVideosAndSortsDeterministically() {
    const appDir = workDir();

    writeFile(appDir, `${PREVIEWS_DIRNAME}/en-US/IPHONE_67/02.mp4`, 'two');
    writeFile(appDir, `${PREVIEWS_DIRNAME}/en-US/IPHONE_67/01.mov`, 'one');
    writeFile(appDir, `${PREVIEWS_DIRNAME}/en-US/DESKTOP/mac.m4v`, 'mac');
    writeFile(appDir, `${PREVIEWS_DIRNAME}/de-DE/IPHONE_67/01.mp4`, 'eins');

    const previews = await discoverPreviews(appDir);

    function listPreviewIdentity(
      p: LocalAsset & {
        readonly locale: string;
        readonly previewType: string;
      },
    ) {
      return [p.locale, p.previewType, p.fileName];
    }

    expect(previews.map(listPreviewIdentity)).toEqual([
      ['de-DE', 'IPHONE_67', '01.mp4'],
      ['en-US', 'DESKTOP', 'mac.m4v'],
      ['en-US', 'IPHONE_67', '01.mov'],
      ['en-US', 'IPHONE_67', '02.mp4'],
    ]);

    function isEnglishPreview(
      p: LocalAsset & {
        readonly locale: string;
        readonly previewType: string;
      },
    ) {
      return p.locale == 'en-US' && p.fileName == '01.mov';
    }

    const iphone01 = previews.find(isEnglishPreview);

    expect(iphone01?.checksum).toBe(md5('one'));
    expect(iphone01?.size).toBe(3);
  }

  it(
    'walks locale/previewType folders, fingerprints videos, and sorts deterministically',
    walksLocalePreviewTypeFoldersFingerprintsVideosAndSortsDeterministically,
  );

  async function ignoresNonVideoFilesAndKeepsUnknownPreviewTypeFoldersAppleSEnumLagsNewHardware() {
    const appDir = workDir();

    writeFile(appDir, `${PREVIEWS_DIRNAME}/en-US/IPHONE_69_FUTURE/01.mp4`, 'future');
    writeFile(appDir, `${PREVIEWS_DIRNAME}/en-US/IPHONE_69_FUTURE/01.png`, 'ignore me');

    const previews = await discoverPreviews(appDir);

    expect(previews).toHaveLength(1);
    expect(previews[0]?.previewType).toBe('IPHONE_69_FUTURE');
    expect(previews[0]?.fileName).toBe('01.mp4');
  }

  it(
    "ignores non-video files and keeps unknown preview-type folders (Apple's enum lags new hardware)",
    ignoresNonVideoFilesAndKeepsUnknownPreviewTypeFoldersAppleSEnumLagsNewHardware,
  );
}

describe('discoverPreviews', describeDiscoverPreviews);
function describeFingerprintAsset() {
  async function fingerprintsADeclaredAssetResolvedRelativeToTheAppDir() {
    const appDir = workDir();

    writeFile(appDir, 'store/review.png', 'review');

    const asset = await fingerprintAsset(appDir, 'store/review.png');
    const reviewPath = join(appDir, 'store/review.png');

    expect(asset).toEqual({
      path: reviewPath,
      fileName: 'review.png',
      checksum: md5('review'),
      size: 6,
    });
  }

  it(
    'fingerprints a declared asset resolved relative to the app dir',
    fingerprintsADeclaredAssetResolvedRelativeToTheAppDir,
  );

  async function returnsNullForAMissingFile() {
    expect(await fingerprintAsset(workDir(), 'store/missing.png')).toBeNull();
  }

  it('returns null for a missing file', returnsNullForAMissingFile);

  async function returnsNullWhenThePathIsADirectoryNotAFile() {
    const appDir = workDir();
    const storePath = join(appDir, 'store');
    mkdirSync(storePath, { recursive: true });
    expect(await fingerprintAsset(appDir, 'store')).toBeNull();
  }

  it(
    'returns null when the path is a directory, not a file',
    returnsNullWhenThePathIsADirectoryNotAFile,
  );
}

describe('fingerprintAsset', describeFingerprintAsset);
