import { afterEach, describe, expect, it } from 'vitest';
import type { FileSystem, Path, Terminal } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateScreenshots,
  type EnhancedShot,
  type ScreenshotEnhancer,
} from '@core/listing/aiScreenshotsCommand.js';
import { canonicalDimensions } from '@core/listing/screenshots/specs.js';
import { makeLaunchLoggerTest, type Logger } from '@core/services/logger.js';
import { makeLaunchPromptTest, type LaunchPromptService } from '@core/services/prompt.js';
const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
/** Encode a minimal valid PNG (8-byte signature + IHDR) carrying the given pixel size. */
const pngBytes = (width: number, height: number): Buffer => {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(16);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([head, ihdr]);
};
/** A fresh app dir seeded with one en-US APP_IPHONE_67 source screenshot (so discovery finds something to enhance). */
const makeAppDir = (withSource = true): string => {
  const dir = mkdtempSync(join(tmpdir(), 'launch-aishots-'));
  tmpDirs.push(dir);
  if (withSource) {
    const srcDir = join(dir, 'screenshots', 'en-US', 'APP_IPHONE_67');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'source.png'), pngBytes(1290, 2796));
  }
  return dir;
};
/**
 * A genshot stand-in: for each requested locale x target it writes one `enhanced.png` into the staging dir
 * under `<locale>/<target>/` and returns its descriptor. Uses each target's canonical size by default, or a
 * forced size to exercise the hard-gate.
 */
const fakeEnhancer = (forcedSize?: readonly [number, number]): ScreenshotEnhancer => {
  return {
    name: 'fake-genshot',
    enhance(request) {
      const shots: EnhancedShot[] = [];
      for (const locale of request.locales) {
        for (const target of request.targets) {
          let dimensions = forcedSize;
          if (dimensions === undefined) dimensions = canonicalDimensions(request.platform, target);
          if (dimensions === undefined) dimensions = [1080, 1920];
          const [width, height] = dimensions;
          const dir = join(request.outDir, locale, target);
          mkdirSync(dir, { recursive: true });
          const path = join(dir, 'enhanced.png');
          writeFileSync(path, pngBytes(width, height));
          shots.push({ path, locale, target });
        }
      }
      return Effect.succeed(shots);
    },
  };
};

/** Run screenshot generation with deterministic terminal services. */
const runScreenshotGeneration = <Success, Failure>(
  screenshotProgram: Effect.Effect<
    Success,
    Failure,
    FileSystem.FileSystem | LaunchPromptService | Logger | Path.Path | Terminal.Terminal
  >,
): Promise<Success> =>
  Effect.runPromise(
    screenshotProgram.pipe(
      Effect.provide(makeLaunchLoggerTest([])),
      Effect.provide(makeLaunchPromptTest()),
      Effect.provide(NodeContext.layer),
    ),
  );
describe('generateScreenshots', () => {
  it('promotes an in-spec enhanced screenshot into <app>/screenshots/<locale>/<target>/', async () => {
    const appDir = makeAppDir();
    const promoted = await runScreenshotGeneration(
      generateScreenshots(
        appDir,
        { platform: 'ios', locale: 'en-US', deviceTypes: 'APP_IPHONE_67', yes: true },
        fakeEnhancer(),
      ),
    );
    expect(promoted).toHaveLength(1);
    expect(existsSync(join(appDir, 'screenshots', 'en-US', 'APP_IPHONE_67', 'enhanced.png'))).toBe(
      true,
    );
  });
  it('hard-gates and rejects an off-spec enhanced screenshot before promoting', async () => {
    const appDir = makeAppDir();
    await expect(
      runScreenshotGeneration(
        generateScreenshots(
          appDir,
          { platform: 'ios', locale: 'en-US', deviceTypes: 'APP_IPHONE_67', yes: true },
          fakeEnhancer([1080, 1920]),
        ),
      ),
    ).rejects.toThrow(/off-spec ios screenshot/);
  });
  it("validates Android output against Play's constraint and promotes it", async () => {
    const appDir = makeAppDir();
    const promoted = await runScreenshotGeneration(
      generateScreenshots(
        appDir,
        { platform: 'android', locale: 'en-US', deviceTypes: 'phone', yes: true },
        fakeEnhancer(),
      ),
    );
    expect(promoted).toHaveLength(1);
    expect(existsSync(join(appDir, 'screenshots', 'en-US', 'phone', 'enhanced.png'))).toBe(true);
  });
  it('refuses when there are no real source screenshots to enhance', async () => {
    const appDir = makeAppDir(false);
    await expect(
      runScreenshotGeneration(
        generateScreenshots(appDir, { platform: 'ios', yes: true }, fakeEnhancer()),
      ),
    ).rejects.toThrow(/No source screenshots/);
  });
  it('promotes nothing on a dry run', async () => {
    const appDir = makeAppDir();
    const promoted = await runScreenshotGeneration(
      generateScreenshots(
        appDir,
        {
          platform: 'ios',
          locale: 'en-US',
          deviceTypes: 'APP_IPHONE_67',
          dryRun: true,
          yes: true,
        },
        fakeEnhancer(),
      ),
    );
    expect(promoted).toHaveLength(0);
    // Only the original source remains under the slot - nothing was promoted beside it.
    expect(readdirSync(join(appDir, 'screenshots', 'en-US', 'APP_IPHONE_67'))).toEqual([
      'source.png',
    ]);
  });
});
