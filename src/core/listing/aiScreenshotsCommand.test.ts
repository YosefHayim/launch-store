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
  discoverGenshotScreenshots,
  ensureGenshotForInteractiveScreenshots,
  generateScreenshots,
  parseScreenshotCaptions,
  parseScreenshotPlatforms,
  resolveScreenshotLocales,
  resolveScreenshotTargets,
  type EnhancedShot,
  type GenshotSetupIo,
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

/** Build the schema-v1 sidecar emitted by the fake Genshot executable. */
const genshotManifest = (
  generationId: string,
  targetStore: 'app_store' | 'google_play',
  generatedFile = 'enhanced.png',
) => ({
  schemaVersion: 1,
  generationId,
  status: 'succeeded',
  targetStore,
  targetImageType: 'store_screenshot',
  requestedImageCount: 1,
  deliveredImageCount: 1,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:01:00.000Z',
  generatedImages: [
    {
      generatedImageId: 'generated-image-test-001',
      imageNumber: 1,
      status: 'delivered',
      file: generatedFile,
    },
  ],
});

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
const fakeEnhancer = (
  forcedSize?: readonly [number, number],
  generationIdOverride?: string,
): ScreenshotEnhancer<FileSystem.FileSystem | Path.Path> => ({
  name: 'fake-genshot',
  enhance: (enhancementRequest) =>
    Effect.gen(function* () {
      const enhancedShots: EnhancedShot[] = [];
      let generationId = 'generation-test-001';
      if (generationIdOverride !== undefined) generationId = generationIdOverride;
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
          let targetStore: 'app_store' | 'google_play' = 'google_play';
          if (enhancementRequest.platform === 'ios') targetStore = 'app_store';
          writeFileSync(
            join(targetDirectory, 'genshot-generation.json'),
            `${JSON.stringify(genshotManifest(generationId, targetStore))}\n`,
          );
          const discoveredShots = yield* discoverGenshotScreenshots(
            targetDirectory,
            locale,
            target,
            enhancementRequest.platform,
          );
          enhancedShots.push(...discoveredShots);
        }
      }
      return enhancedShots;
    }),
});

/** Run screenshot generation with deterministic terminal services. */
const runScreenshotGeneration = <Success, Failure>(
  screenshotProgram: Effect.Effect<
    Success,
    Failure,
    FileSystem.FileSystem | LaunchPromptService | Logger | Path.Path | Terminal.Terminal
  >,
  loggerLines: string[] = [],
): Promise<Success> =>
  Effect.runPromise(
    screenshotProgram.pipe(
      Effect.provide(makeLaunchLoggerTest(loggerLines)),
      Effect.provide(makeLaunchPromptTest()),
      Effect.provide(NodeContext.layer),
    ),
  );

type GenshotSetupState = {
  installed: boolean;
  authenticated: boolean;
  readonly confirmations: boolean[];
  readonly commands: Array<readonly [string, readonly string[]]>;
  readonly notes: string[];
};

/** Build a deterministic Genshot installer/login seam whose commands update the supplied state. */
const makeGenshotSetupIo = (setupState: GenshotSetupState): GenshotSetupIo => ({
  exists: () => Effect.succeed(setupState.installed),
  authenticated: () => Effect.succeed(setupState.authenticated),
  confirm: () => Effect.succeed(setupState.confirmations.shift() === true),
  note: (message) =>
    Effect.sync(() => {
      setupState.notes.push(message);
    }),
  run: (executable, commandArguments) =>
    Effect.sync(() => {
      setupState.commands.push([executable, commandArguments]);
      if (executable === 'npm') setupState.installed = true;
      if (executable === 'genshot' && commandArguments[0] === 'login') {
        setupState.authenticated = true;
      }
    }),
});

describe('interactive Genshot setup', () => {
  it('installs the companion, opens login, and verifies authentication', async () => {
    const setupState: GenshotSetupState = {
      installed: false,
      authenticated: false,
      confirmations: [true, true],
      commands: [],
      notes: [],
    };
    await expect(
      Effect.runPromise(ensureGenshotForInteractiveScreenshots(makeGenshotSetupIo(setupState))),
    ).resolves.toBe(true);
    expect(setupState.commands).toEqual([
      ['npm', ['install', '--global', '@genshot/cli']],
      ['genshot', ['login']],
    ]);
  });

  it('does nothing when Genshot is already installed and authenticated', async () => {
    const setupState: GenshotSetupState = {
      installed: true,
      authenticated: true,
      confirmations: [],
      commands: [],
      notes: [],
    };
    await expect(
      Effect.runPromise(ensureGenshotForInteractiveScreenshots(makeGenshotSetupIo(setupState))),
    ).resolves.toBe(true);
    expect(setupState.commands).toEqual([]);
  });

  it('stops cleanly when installation is declined', async () => {
    const setupState: GenshotSetupState = {
      installed: false,
      authenticated: false,
      confirmations: [false],
      commands: [],
      notes: [],
    };
    await expect(
      Effect.runPromise(ensureGenshotForInteractiveScreenshots(makeGenshotSetupIo(setupState))),
    ).resolves.toBe(false);
    expect(setupState.commands).toEqual([]);
    expect(setupState.notes).toEqual([
      'Genshot setup skipped. Install later with `npm install --global @genshot/cli`.',
    ]);
  });
});

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

  it('uses the public command and rejects invalid or mismatched generation manifests', async () => {
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
    const outputDirectory = mkdtempSync(join(tmpdir(), 'launch-genshot-manifest-'));
    temporaryDirectories.push(outputDirectory);
    writeFileSync(join(outputDirectory, 'enhanced.png'), pngBytes(1290, 2796));
    writeFileSync(
      join(outputDirectory, 'genshot-generation.json'),
      JSON.stringify({
        ...genshotManifest('generation-invalid-001', 'app_store'),
        schemaVersion: 2,
      }),
    );
    await expect(
      Effect.runPromise(
        discoverGenshotScreenshots(outputDirectory, 'en-US', 'APP_IPHONE_67', 'ios').pipe(
          Effect.provide(NodeContext.layer),
        ),
      ),
    ).rejects.toThrow(/Invalid genshot-generation\.json/);
    const targetMismatchDirectory = mkdtempSync(join(tmpdir(), 'launch-genshot-manifest-'));
    const fileMismatchDirectory = mkdtempSync(join(tmpdir(), 'launch-genshot-manifest-'));
    temporaryDirectories.push(targetMismatchDirectory, fileMismatchDirectory);
    for (const outputDirectory of [targetMismatchDirectory, fileMismatchDirectory]) {
      writeFileSync(join(outputDirectory, 'enhanced.png'), pngBytes(1290, 2796));
    }
    writeFileSync(
      join(targetMismatchDirectory, 'genshot-generation.json'),
      JSON.stringify(genshotManifest('generation-target-001', 'google_play')),
    );
    writeFileSync(
      join(fileMismatchDirectory, 'genshot-generation.json'),
      JSON.stringify(genshotManifest('generation-file-001', 'app_store', 'missing.png')),
    );
    await expect(
      Effect.runPromise(
        discoverGenshotScreenshots(targetMismatchDirectory, 'en-US', 'APP_IPHONE_67', 'ios').pipe(
          Effect.provide(NodeContext.layer),
        ),
      ),
    ).rejects.toThrow(/targets google_play; expected app_store/);
    await expect(
      Effect.runPromise(
        discoverGenshotScreenshots(fileMismatchDirectory, 'en-US', 'APP_IPHONE_67', 'ios').pipe(
          Effect.provide(NodeContext.layer),
        ),
      ),
    ).rejects.toThrow(/enhanced\.png is not mapped/);
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
    const loggerLines: string[] = [];
    const promoted = await runScreenshotGeneration(
      generateScreenshots(
        appDirectory,
        { platform: 'ios', locale: 'en-US', deviceTypes: 'APP_IPHONE_67', yes: true },
        fakeEnhancer(),
      ),
      loggerLines,
    );
    expect(promoted).toHaveLength(1);
    expect(
      existsSync(join(appDirectory, 'screenshots', 'en-US', 'APP_IPHONE_67', 'enhanced.png')),
    ).toBe(true);
    expect(
      existsSync(
        join(
          appDirectory,
          'screenshots',
          'en-US',
          'APP_IPHONE_67',
          'genshot-generation-generation-test-001.json',
        ),
      ),
    ).toBe(true);
    expect(loggerLines.join('')).toMatch(/Genshot Generation ID: generation-test-001/);
    expect(loggerLines.join('')).toMatch(/Retained Genshot Generation ID generation-test-001/);
    const outputDirectory = join(appDirectory, 'collision-screenshots');
    const commandInput = {
      platform: 'ios',
      locale: 'en-US',
      deviceTypes: 'APP_IPHONE_67',
      out: outputDirectory,
      yes: true,
    };
    await runScreenshotGeneration(
      generateScreenshots(
        appDirectory,
        commandInput,
        fakeEnhancer(undefined, 'generation-first-001'),
      ),
    );
    await runScreenshotGeneration(
      generateScreenshots(
        appDirectory,
        commandInput,
        fakeEnhancer(undefined, 'generation-second-002'),
      ),
    );
    const retainedDirectory = join(outputDirectory, 'en-US', 'APP_IPHONE_67');
    expect(
      existsSync(join(retainedDirectory, 'genshot-generation-generation-first-001.json')),
    ).toBe(true);
    expect(
      existsSync(join(retainedDirectory, 'genshot-generation-generation-second-002.json')),
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
    const copyFailureAppDirectory = makeAppDirectory();
    const copyFailureOutput = join(copyFailureAppDirectory, 'copy-failure-output');
    const copyFailureTarget = join(copyFailureOutput, 'en-US', 'APP_IPHONE_67');
    mkdirSync(join(copyFailureTarget, 'enhanced.png'), { recursive: true });
    await expect(
      runScreenshotGeneration(
        generateScreenshots(
          copyFailureAppDirectory,
          {
            platform: 'ios',
            locale: 'en-US',
            deviceTypes: 'APP_IPHONE_67',
            out: copyFailureOutput,
            yes: true,
          },
          fakeEnhancer(),
        ),
      ),
    ).rejects.toThrow();
    expect(existsSync(join(copyFailureTarget, 'genshot-generation-generation-test-001.json'))).toBe(
      true,
    );
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
    const loggerLines: string[] = [];
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
      loggerLines,
    );
    expect(promoted).toHaveLength(0);
    expect(readdirSync(join(appDirectory, 'screenshots', 'en-US', 'APP_IPHONE_67'))).toEqual([
      'source.png',
    ]);
    const dryRunMarker = 'Review the durable Genshot batch at ';
    const dryRunLine = loggerLines.find((loggerLine) => loggerLine.includes(dryRunMarker));
    expect(dryRunLine).toBeDefined();
    if (dryRunLine === undefined) return;
    const reviewDirectory = dryRunLine.slice(
      dryRunLine.indexOf(dryRunMarker) + dryRunMarker.length,
    );
    temporaryDirectories.push(reviewDirectory.trim());
    const stagedTargetDirectory = join(reviewDirectory.trim(), 'ios', 'en-US', 'APP_IPHONE_67');
    expect(existsSync(join(stagedTargetDirectory, 'enhanced.png'))).toBe(true);
    expect(existsSync(join(stagedTargetDirectory, 'genshot-generation.json'))).toBe(true);
    expect(loggerLines.join('')).toMatch(/Genshot Generation ID: generation-test-001/);
    expect(loggerLines.join('')).toMatch(/nothing promoted/);
  });
});
