import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileSystem, Path, Terminal } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { makeLaunchLoggerTest, type Logger } from '../services/logger.js';
import { makeLaunchPromptTest, type LaunchPromptService } from '../services/prompt.js';
import {
  buildGenshotArguments,
  buildGenshotPrompt,
  generateScreenshots,
  parseScreenshotCaptions,
  parseScreenshotPlatforms,
  resolveScreenshotLocales,
  resolveScreenshotTargets,
  type EnhancedShot,
  type ScreenshotEnhancer,
} from './aiScreenshotsCommand.js';
import { canonicalDimensions } from './screenshots/specs.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
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

/** A fresh app dir seeded with one en-US APP_IPHONE_67 source screenshot. */
const makeAppDirectory = (withSource = true): string => {
  const appDirectory = mkdtempSync(join(tmpdir(), 'launch-aishots-'));
  temporaryDirectories.push(appDirectory);
  if (withSource) {
    const sourceDirectory = join(appDirectory, 'screenshots', 'en-US', 'APP_IPHONE_67');
    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(join(sourceDirectory, 'source.png'), pngBytes(1290, 2796));
  }
  return appDirectory;
};

/**
 * A genshot stand-in: for each requested locale x target it writes one `enhanced.png` into the staging
 * dir under `<locale>/<target>/` and returns its descriptor. Uses each target's canonical size by
 * default, or a forced size to exercise the hard-gate.
 */
const fakeEnhancer = (forcedSize?: readonly [number, number]): ScreenshotEnhancer => ({
  name: 'fake-genshot',
  enhance: (enhancementRequest) => {
    const enhancedShots: EnhancedShot[] = [];
    for (const locale of enhancementRequest.locales) {
      for (const target of enhancementRequest.targets) {
        let dimensions = forcedSize;
        if (dimensions === undefined) {
          dimensions = canonicalDimensions(enhancementRequest.platform, target);
        }
        if (dimensions === undefined) dimensions = [1080, 1920];
        const [width, height] = dimensions;
        const targetDirectory = join(enhancementRequest.outDir, locale, target);
        mkdirSync(targetDirectory, { recursive: true });
        const screenshotPath = join(targetDirectory, 'enhanced.png');
        writeFileSync(screenshotPath, pngBytes(width, height));
        enhancedShots.push({ path: screenshotPath, locale, target });
      }
    }
    return Effect.succeed(enhancedShots);
  },
});

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

describe('parseScreenshotPlatforms', () => {
  it('defaults undefined and all to both store platforms', async () => {
    await expect(Effect.runPromise(parseScreenshotPlatforms(undefined))).resolves.toEqual([
      'ios',
      'android',
    ]);
    await expect(Effect.runPromise(parseScreenshotPlatforms('all'))).resolves.toEqual([
      'ios',
      'android',
    ]);
  });

  it('accepts a single platform selector', async () => {
    await expect(Effect.runPromise(parseScreenshotPlatforms('ios'))).resolves.toEqual(['ios']);
    await expect(Effect.runPromise(parseScreenshotPlatforms('android'))).resolves.toEqual([
      'android',
    ]);
  });

  it('rejects an unknown platform selector', async () => {
    const platformFailure = await Effect.runPromise(Effect.flip(parseScreenshotPlatforms('web')));
    expect(platformFailure._tag).toBe('AiScreenshotsFailure');
    expect(platformFailure.message).toMatch(/Unknown platform "web"/);
  });
});

describe('resolveScreenshotLocales', () => {
  it('uses discovered source locales, else en-US', async () => {
    const fixtureScreenshot = (
      path: string,
      locale: string,
      displayType: string,
      fileName: string,
    ) => ({
      path,
      locale,
      displayType,
      fileName,
      checksum: 'deadbeef',
      size: 1,
    });
    await expect(
      Effect.runPromise(
        resolveScreenshotLocales(undefined, [
          fixtureScreenshot('/a.png', 'fr-FR', 'APP_IPHONE_67', 'a.png'),
          fixtureScreenshot('/b.png', 'fr-FR', 'APP_IPHONE_67', 'b.png'),
          fixtureScreenshot('/c.png', 'en-US', 'phone', 'c.png'),
        ]),
      ),
    ).resolves.toEqual(['fr-FR', 'en-US']);
    await expect(Effect.runPromise(resolveScreenshotLocales(undefined, []))).resolves.toEqual([
      'en-US',
    ]);
  });

  it('parses and trims an explicit locale CSV', async () => {
    await expect(
      Effect.runPromise(resolveScreenshotLocales(' en-US , fr-FR ,', [])),
    ).resolves.toEqual(['en-US', 'fr-FR']);
  });

  it('rejects an empty explicit locale CSV', async () => {
    const localeFailure = await Effect.runPromise(
      Effect.flip(resolveScreenshotLocales(' , ,', [])),
    );
    expect(localeFailure.message).toMatch(/--locale was empty/);
  });
});

describe('resolveScreenshotTargets', () => {
  it('uses the Genshot-supported phone target for each platform', async () => {
    await expect(Effect.runPromise(resolveScreenshotTargets('ios', undefined))).resolves.toEqual([
      'APP_IPHONE_67',
    ]);
    await expect(
      Effect.runPromise(resolveScreenshotTargets('android', undefined)),
    ).resolves.toEqual(['phone']);
  });

  it('accepts the supported target and rejects empty or unsupported targets', async () => {
    await expect(
      Effect.runPromise(resolveScreenshotTargets('ios', 'APP_IPHONE_67')),
    ).resolves.toEqual(['APP_IPHONE_67']);
    const targetFailure = await Effect.runPromise(
      Effect.flip(resolveScreenshotTargets('ios', ' , ')),
    );
    expect(targetFailure.message).toMatch(/--device-types was empty/);
    const unsupportedTargetFailure = await Effect.runPromise(
      Effect.flip(resolveScreenshotTargets('ios', 'APP_IPAD_PRO_3GEN_129')),
    );
    expect(unsupportedTargetFailure.message).toMatch(/currently supports APP_IPHONE_67/);
  });
});

describe('Genshot CLI contract', () => {
  const enhancementRequest = {
    platform: 'ios' as const,
    brief: 'A calm habit tracker',
    locales: ['en-US'],
    targets: ['APP_IPHONE_67'],
    captions: ['Build a streak', 'See your progress'],
    sources: ['/app/home.png', '/app/progress.png'],
    outDir: '/tmp/genshot',
  };

  it('uses the public generate command and its shipped flags', () => {
    expect(buildGenshotArguments(enhancementRequest, 'en-US', '/tmp/genshot/en-US')).toEqual([
      'generate',
      '--target-store',
      'app_store',
      '--image-type',
      'store_screenshot',
      '--count',
      '2',
      '--prompt',
      buildGenshotPrompt(enhancementRequest, 'en-US'),
      '--out',
      '/tmp/genshot/en-US',
      '--screenshot',
      '/app/home.png',
      '/app/progress.png',
    ]);
  });

  it('places the locale, brief, and captions into Genshot art direction', () => {
    const genshotPrompt = buildGenshotPrompt(enhancementRequest, 'he-IL');
    expect(genshotPrompt).toMatch(/locale he-IL/);
    expect(genshotPrompt).toMatch(/A calm habit tracker/);
    expect(genshotPrompt).toMatch(/Build a streak \| See your progress/);
  });
});

describe('parseScreenshotCaptions', () => {
  it('returns undefined when omitted and trims tokens when present', () => {
    expect(parseScreenshotCaptions(undefined)).toBeUndefined();
    expect(parseScreenshotCaptions(' Focus , Ship ')).toEqual(['Focus', 'Ship']);
    expect(parseScreenshotCaptions(' , ')).toEqual([]);
  });
});

describe('generateScreenshots', () => {
  it('promotes an in-spec enhanced screenshot into <app>/screenshots/<locale>/<target>/', async () => {
    const appDirectory = makeAppDirectory();
    const promoted = await runScreenshotGeneration(
      generateScreenshots(
        appDirectory,
        { platform: 'ios', locale: 'en-US', deviceTypes: 'APP_IPHONE_67', yes: true },
        fakeEnhancer(),
      ),
    );
    expect(promoted).toHaveLength(1);
    expect(
      existsSync(join(appDirectory, 'screenshots', 'en-US', 'APP_IPHONE_67', 'enhanced.png')),
    ).toBe(true);
  });

  it('hard-gates and rejects an off-spec enhanced screenshot before promoting', async () => {
    const appDirectory = makeAppDirectory();
    await expect(
      runScreenshotGeneration(
        generateScreenshots(
          appDirectory,
          { platform: 'ios', locale: 'en-US', deviceTypes: 'APP_IPHONE_67', yes: true },
          fakeEnhancer([1080, 1920]),
        ),
      ),
    ).rejects.toThrow(/off-spec ios screenshot/);
  });

  it("validates Android output against Play's constraint and promotes it", async () => {
    const appDirectory = makeAppDirectory();
    const promoted = await runScreenshotGeneration(
      generateScreenshots(
        appDirectory,
        { platform: 'android', locale: 'en-US', deviceTypes: 'phone', yes: true },
        fakeEnhancer(),
      ),
    );
    expect(promoted).toHaveLength(1);
    expect(existsSync(join(appDirectory, 'screenshots', 'en-US', 'phone', 'enhanced.png'))).toBe(
      true,
    );
  });

  it('refuses when there are no real source screenshots to enhance', async () => {
    const appDirectory = makeAppDirectory(false);
    await expect(
      runScreenshotGeneration(
        generateScreenshots(appDirectory, { platform: 'ios', yes: true }, fakeEnhancer()),
      ),
    ).rejects.toThrow(/No source screenshots/);
  });

  it('promotes nothing on a dry run', async () => {
    const appDirectory = makeAppDirectory();
    const promoted = await runScreenshotGeneration(
      generateScreenshots(
        appDirectory,
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
    expect(readdirSync(join(appDirectory, 'screenshots', 'en-US', 'APP_IPHONE_67'))).toEqual([
      'source.png',
    ]);
  });
});
