import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
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
} from './assets.js';
import {
  APPLE_ASSET_TARGETS,
  appleDisplayTypeLabel,
  applePreviewTypeLabel,
  findAppleAssetTarget,
  findApplePreviewTarget,
  findAppleScreenshotTarget,
} from './targets.js';
const tmpDirs: string[] = [];
const workDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'screenshot-assets-test-'));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
/** Write a file under `appDir`, creating parent folders, and return its absolute path. */
const writeFile = (appDir: string, relPath: string, contents: string): string => {
  const path = join(appDir, relPath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
  return path;
};
const md5 = (text: string): string => createHash('md5').update(Buffer.from(text)).digest('hex');
const runAssetEffect = <TOutput, TFailure>(
  assetEffect: Effect.Effect<TOutput, TFailure, NodeContext.NodeContext>,
): Promise<TOutput> => Effect.runPromise(assetEffect.pipe(Effect.provide(NodeContext.layer)));
describe('hashFile', () => {
  it('returns the MD5 hex and byte length of a file', async () => {
    const appDir = workDir();
    const path = writeFile(appDir, 'a.png', 'pixels');
    expect(await runAssetEffect(hashFile(path))).toEqual({ checksum: md5('pixels'), size: 6 });
  });
});
describe('displayTypeLabel', () => {
  it('maps a known constant to a friendly label', () => {
    expect(appleDisplayTypeLabel('APP_IPHONE_67')).toBe('iPhone 6.7"');
    expect(appleDisplayTypeLabel('APP_DESKTOP')).toBe('Mac');
  });
  it('falls back to the raw constant for an unknown (new-hardware) type', () => {
    expect(appleDisplayTypeLabel('APP_IPHONE_69_FUTURE')).toBe('APP_IPHONE_69_FUTURE');
  });
});
describe('Apple asset targets', () => {
  it('resolves the same target through its key, screenshot type, and preview type', () => {
    const target = findAppleAssetTarget('iphone67');
    expect(target).toBe(findAppleScreenshotTarget('APP_IPHONE_67'));
    expect(target).toBe(findApplePreviewTarget('IPHONE_67'));
  });
  it('declares each screenshot and preview enum once', () => {
    expect(new Set(APPLE_ASSET_TARGETS.map((target) => target.screenshotDisplayType)).size).toBe(
      APPLE_ASSET_TARGETS.length,
    );
    const previewTypes = APPLE_ASSET_TARGETS.flatMap((target) => {
      if (target.previewType === undefined) return [];
      return [target.previewType];
    });
    expect(new Set(previewTypes).size).toBe(previewTypes.length);
  });
});
describe('discoverScreenshots', () => {
  it('returns [] when the convention folder is absent', async () => {
    expect(await runAssetEffect(discoverScreenshots(workDir()))).toEqual([]);
  });
  it('walks locale/displayType folders, fingerprints images, and sorts deterministically', async () => {
    const appDir = workDir();
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_IPHONE_67/02.png`, 'two');
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_IPHONE_67/01.png`, 'one');
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_DESKTOP/mac.jpg`, 'mac');
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/de-DE/APP_IPHONE_67/01.png`, 'eins');
    const shots = await runAssetEffect(discoverScreenshots(appDir));
    expect(shots.map((s) => [s.locale, s.displayType, s.fileName])).toEqual([
      ['de-DE', 'APP_IPHONE_67', '01.png'],
      ['en-US', 'APP_DESKTOP', 'mac.jpg'],
      ['en-US', 'APP_IPHONE_67', '01.png'],
      ['en-US', 'APP_IPHONE_67', '02.png'],
    ]);
    const iphone01 = shots.find((s) => s.locale === 'en-US' && s.fileName === '01.png');
    expect(iphone01?.checksum).toBe(md5('one'));
    expect(iphone01?.size).toBe(3);
  });
  it("ignores non-image files and keeps unknown display-type folders (Apple's enum lags new hardware)", async () => {
    const appDir = workDir();
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_IPHONE_69_FUTURE/01.png`, 'future');
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_IPHONE_69_FUTURE/notes.txt`, 'ignore me');
    const shots = await runAssetEffect(discoverScreenshots(appDir));
    expect(shots).toHaveLength(1);
    expect(shots[0]?.displayType).toBe('APP_IPHONE_69_FUTURE');
    expect(shots[0]?.fileName).toBe('01.png');
  });
});
describe('previewTypeLabel', () => {
  it('maps a known constant to a friendly label', () => {
    expect(applePreviewTypeLabel('IPHONE_67')).toBe('iPhone 6.7"');
    expect(applePreviewTypeLabel('DESKTOP')).toBe('Mac');
  });
  it('falls back to the raw constant for an unknown (new-hardware) type', () => {
    expect(applePreviewTypeLabel('IPHONE_69_FUTURE')).toBe('IPHONE_69_FUTURE');
  });
});
describe('discoverPreviews', () => {
  it('returns [] when the convention folder is absent', async () => {
    expect(await runAssetEffect(discoverPreviews(workDir()))).toEqual([]);
  });
  it('walks locale/previewType folders, fingerprints videos, and sorts deterministically', async () => {
    const appDir = workDir();
    writeFile(appDir, `${PREVIEWS_DIRNAME}/en-US/IPHONE_67/02.mp4`, 'two');
    writeFile(appDir, `${PREVIEWS_DIRNAME}/en-US/IPHONE_67/01.mov`, 'one');
    writeFile(appDir, `${PREVIEWS_DIRNAME}/en-US/DESKTOP/mac.m4v`, 'mac');
    writeFile(appDir, `${PREVIEWS_DIRNAME}/de-DE/IPHONE_67/01.mp4`, 'eins');
    const previews = await runAssetEffect(discoverPreviews(appDir));
    expect(previews.map((p) => [p.locale, p.previewType, p.fileName])).toEqual([
      ['de-DE', 'IPHONE_67', '01.mp4'],
      ['en-US', 'DESKTOP', 'mac.m4v'],
      ['en-US', 'IPHONE_67', '01.mov'],
      ['en-US', 'IPHONE_67', '02.mp4'],
    ]);
    const iphone01 = previews.find((p) => p.locale === 'en-US' && p.fileName === '01.mov');
    expect(iphone01?.checksum).toBe(md5('one'));
    expect(iphone01?.size).toBe(3);
  });
  it("ignores non-video files and keeps unknown preview-type folders (Apple's enum lags new hardware)", async () => {
    const appDir = workDir();
    writeFile(appDir, `${PREVIEWS_DIRNAME}/en-US/IPHONE_69_FUTURE/01.mp4`, 'future');
    writeFile(appDir, `${PREVIEWS_DIRNAME}/en-US/IPHONE_69_FUTURE/01.png`, 'ignore me');
    const previews = await runAssetEffect(discoverPreviews(appDir));
    expect(previews).toHaveLength(1);
    expect(previews[0]?.previewType).toBe('IPHONE_69_FUTURE');
    expect(previews[0]?.fileName).toBe('01.mp4');
  });
});
describe('fingerprintAsset', () => {
  it('fingerprints a declared asset resolved relative to the app dir', async () => {
    const appDir = workDir();
    writeFile(appDir, 'store/review.png', 'review');
    const asset = await runAssetEffect(fingerprintAsset(appDir, 'store/review.png'));
    expect(asset).toEqual({
      path: join(appDir, 'store/review.png'),
      fileName: 'review.png',
      checksum: md5('review'),
      size: 6,
    });
  });
  it('returns null for a missing file', async () => {
    expect(await runAssetEffect(fingerprintAsset(workDir(), 'store/missing.png'))).toBeNull();
  });
  it('returns null when the path is a directory, not a file', async () => {
    const appDir = workDir();
    mkdirSync(join(appDir, 'store'), { recursive: true });
    expect(await runAssetEffect(fingerprintAsset(appDir, 'store'))).toBeNull();
  });
});
