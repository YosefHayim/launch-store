import { FileSystem, Path, Terminal } from '@effect/platform';
import type * as PlatformCommandExecutor from '@effect/platform/CommandExecutor';
import { Data, Effect, Schema } from 'effect';
import { selectApp } from '../build/pipelineEnv.js';
import { loadConfig } from '../config/config.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { errorMessage } from '../services/errorMessage.js';
import { captureCommandOutput, checkCommandExists, executeCommand } from '../services/exec.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import { openUrl } from '../terminal/consoleLinks.js';
import type { Platform } from '../types/app.js';
import {
  discoverScreenshotsAt,
  SCREENSHOTS_DIRNAME,
  type LocalScreenshot,
} from './screenshots/assets.js';
import { checkScreenshotFile } from './screenshots/specs.js';

const DEFAULT_GENSHOT_BINARY = 'genshot';
const MAX_GENSHOT_SOURCE_COUNT = 10;
const GENSHOT_GENERATED_IMAGE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png']);
const GENSHOT_MANIFEST_FILENAME = 'genshot-generation.json';
const GENSHOT_RETAINED_MANIFEST_PREFIX = 'genshot-generation-';
const GENSHOT_APP_STORE_TARGET = 'APP_IPHONE_67';
const GENSHOT_GOOGLE_PLAY_TARGET = 'phone';

const GenshotIdentifierSchema = Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{3,80}$/));
const GenshotGeneratedImageSchema = Schema.Struct({
  generatedImageId: GenshotIdentifierSchema,
  imageNumber: Schema.Number.pipe(Schema.int(), Schema.positive()),
  status: Schema.Literal(
    'planned',
    'generating',
    'quality_check',
    'delivered',
    'failed',
    'cancelled',
    'deleted',
  ),
  file: Schema.NullOr(Schema.String),
});
const GenshotGenerationManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generationId: GenshotIdentifierSchema,
  status: Schema.Literal(
    'queued',
    'planning',
    'generating',
    'checking',
    'succeeded',
    'failed',
    'cancelled',
    'deleted',
  ),
  targetStore: Schema.Literal('app_store', 'google_play', 'chrome_web_store'),
  targetImageType: Schema.Literal(
    'store_screenshot',
    'feature_graphic',
    'small_promo_tile',
    'marquee',
  ),
  requestedImageCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  deliveredImageCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  generatedImages: Schema.Array(GenshotGeneratedImageSchema),
});
type GenshotGenerationManifest = typeof GenshotGenerationManifestSchema.Type;

/** Inputs accepted by `launch ai screenshots`. */
export type AiScreenshotsInput = Readonly<{
  app?: string;
  brief?: string;
  locale?: string;
  platform?: string;
  in?: string;
  captions?: string;
  deviceTypes?: string;
  out?: string;
  genshotBin?: string;
  dryRun?: boolean;
  yes?: boolean;
}>;

/** One screenshot produced in the generation staging directory. */
export type EnhancedShot = Readonly<{
  path: string;
  locale: string;
  target: string;
  generationId: string;
  generationManifestPath: string;
}>;

/** One platform enhancement request sent to a screenshot backend. */
export type EnhanceRequest = Readonly<{
  platform: Platform;
  brief?: string;
  locales: readonly string[];
  targets: readonly string[];
  captions?: readonly string[];
  sources: readonly string[];
  outDir: string;
}>;

/** Injectable screenshot enhancement backend. */
export type ScreenshotEnhancer<Requirements = never> = Readonly<{
  name: string;
  enhance: (
    enhancementRequest: EnhanceRequest,
  ) => Effect.Effect<readonly EnhancedShot[], unknown, Requirements>;
}>;

/** Side effects used to prepare the optional Genshot companion from the interactive front door. */
export type GenshotSetupIo<Requirements = never> = Readonly<{
  readonly exists: (executable: string) => Effect.Effect<boolean, unknown, Requirements>;
  readonly authenticated: (executable: string) => Effect.Effect<boolean, unknown, Requirements>;
  readonly run: (
    executable: string,
    commandArguments: readonly string[],
  ) => Effect.Effect<void, unknown, Requirements>;
  readonly confirm: (message: string) => Effect.Effect<boolean, unknown, Requirements>;
  readonly note: (message: string) => Effect.Effect<void, unknown, Requirements>;
}>;

/** Screenshot generation, validation, or promotion failed. */
export type AiScreenshotsFailure = Readonly<{
  readonly _tag: 'AiScreenshotsFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeAiScreenshotsFailure = Data.tagged<AiScreenshotsFailure>('AiScreenshotsFailure');

type AiScreenshotsRequirements =
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | Logger
  | Path.Path
  | PlatformCommandExecutor.CommandExecutor
  | Terminal.Terminal;

type RetainedGenshotGeneration = Readonly<{
  generationId: string;
  locale: string;
  target: string;
  manifestPath: string;
}>;

/** Convert an unknown cause to the screenshot command's tagged channel. */
const screenshotFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): AiScreenshotsFailure => {
  let message = errorMessage(cause);
  if (explicitMessage !== undefined) message = explicitMessage;
  return makeAiScreenshotsFailure({ operation, message, cause });
};

/** Map one logger write to the screenshot command channel. */
const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, AiScreenshotsFailure> =>
  logWrite.pipe(Effect.mapError((cause) => screenshotFailure(operation, cause)));

/** Build the production Genshot setup seam from Launch's prompt, logger, and command services. */
const makeGenshotSetupIo = () =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const launchPrompt = yield* LaunchPrompt;
    return {
      exists: checkCommandExists,
      authenticated: (executable: string) =>
        captureCommandOutput(executable, ['balance']).pipe(
          Effect.as(true),
          Effect.catchAll(() => Effect.succeed(false)),
        ),
      run: executeCommand,
      confirm: launchPrompt.confirm,
      note: logger.note,
    } satisfies GenshotSetupIo<LaunchEnvironmentService | PlatformCommandExecutor.CommandExecutor>;
  });

/** Install and authenticate Genshot when the user enters screenshot generation from the TUI. */
export const ensureGenshotForInteractiveScreenshots = <Requirements>(
  setupIo: GenshotSetupIo<Requirements>,
): Effect.Effect<boolean, AiScreenshotsFailure, Requirements> =>
  Effect.gen(function* () {
    let genshotInstalled = yield* setupIo
      .exists(DEFAULT_GENSHOT_BINARY)
      .pipe(Effect.mapError((cause) => screenshotFailure('detect genshot CLI', cause)));
    if (!genshotInstalled) {
      const installApproved = yield* setupIo
        .confirm('Genshot creates polished store screenshots. Install @genshot/cli globally now?')
        .pipe(Effect.mapError((cause) => screenshotFailure('confirm genshot installation', cause)));
      if (!installApproved) {
        yield* setupIo
          .note('Genshot setup skipped. Install later with `npm install --global @genshot/cli`.')
          .pipe(Effect.mapError((cause) => screenshotFailure('render genshot setup', cause)));
        return false;
      }
      yield* setupIo
        .run('npm', ['install', '--global', '@genshot/cli'])
        .pipe(Effect.mapError((cause) => screenshotFailure('install genshot CLI', cause)));
      genshotInstalled = yield* setupIo
        .exists(DEFAULT_GENSHOT_BINARY)
        .pipe(Effect.mapError((cause) => screenshotFailure('verify genshot installation', cause)));
      if (!genshotInstalled) {
        return yield* Effect.fail(
          screenshotFailure(
            'verify genshot installation',
            DEFAULT_GENSHOT_BINARY,
            'Genshot installed, but `genshot` is not on PATH. Open a new terminal and try again.',
          ),
        );
      }
    }
    const authenticated = yield* setupIo
      .authenticated(DEFAULT_GENSHOT_BINARY)
      .pipe(Effect.mapError((cause) => screenshotFailure('check genshot login', cause)));
    if (authenticated) return true;
    const loginApproved = yield* setupIo
      .confirm('Sign in to Genshot in your browser now? New accounts include free Credits.')
      .pipe(Effect.mapError((cause) => screenshotFailure('confirm genshot login', cause)));
    if (!loginApproved) {
      yield* setupIo
        .note('Genshot sign-in skipped. Run `genshot login` when you are ready.')
        .pipe(Effect.mapError((cause) => screenshotFailure('render genshot login', cause)));
      return false;
    }
    yield* setupIo
      .run(DEFAULT_GENSHOT_BINARY, ['login'])
      .pipe(Effect.mapError((cause) => screenshotFailure('sign in to genshot', cause)));
    const loginVerified = yield* setupIo
      .authenticated(DEFAULT_GENSHOT_BINARY)
      .pipe(Effect.mapError((cause) => screenshotFailure('verify genshot login', cause)));
    if (loginVerified) return true;
    return yield* Effect.fail(
      screenshotFailure(
        'verify genshot login',
        DEFAULT_GENSHOT_BINARY,
        'Genshot sign-in did not complete. Run `genshot login` and try again.',
      ),
    );
  });

/** Run interactive Genshot preparation with Launch's production command and prompt services. */
export const ensureGenshotForInteractiveScreenshotsLive = (): Effect.Effect<
  boolean,
  AiScreenshotsFailure,
  LaunchEnvironmentService | LaunchPromptService | Logger | PlatformCommandExecutor.CommandExecutor
> =>
  Effect.gen(function* () {
    const setupIo = yield* makeGenshotSetupIo();
    return yield* ensureGenshotForInteractiveScreenshots(setupIo);
  });

/** Whether command execution failed because the configured binary is absent. */
const isMissingBinaryError = (cause: unknown): boolean => {
  if (!(cause instanceof Error)) return false;
  if (!('code' in cause)) return false;
  return cause.code === 'ENOENT';
};

/** Split a comma-separated CLI list into non-empty trimmed tokens. */
const parseCsvList = (csv: string): readonly string[] =>
  csv
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

/** Resolve the Genshot store name for a Launch build platform. */
export const genshotTargetStore = (platform: Platform): 'app_store' | 'google_play' => {
  if (platform === 'ios') return 'app_store';
  return 'google_play';
};

/** Build locale-aware art direction without inventing a second Genshot request contract. */
export const buildGenshotPrompt = (enhancementRequest: EnhanceRequest, locale: string): string => {
  const promptLines = [
    'Create polished, high-converting store screenshots from the supplied real app UI.',
    `Write all visible marketing copy for locale ${locale}.`,
  ];
  if (enhancementRequest.brief !== undefined) {
    promptLines.push(`App brief: ${enhancementRequest.brief}`);
  }
  if (enhancementRequest.captions !== undefined && enhancementRequest.captions.length > 0) {
    promptLines.push(
      `Feature captions, in source order: ${enhancementRequest.captions.join(' | ')}`,
    );
  }
  return promptLines.join('\n');
};

/** Build the public `genshot generate` invocation used for one locale and store target. */
export const buildGenshotArguments = (
  enhancementRequest: EnhanceRequest,
  locale: string,
  outputDirectory: string,
): readonly string[] => [
  'generate',
  '--target-store',
  genshotTargetStore(enhancementRequest.platform),
  '--image-type',
  'store_screenshot',
  '--count',
  String(enhancementRequest.sources.length),
  '--prompt',
  buildGenshotPrompt(enhancementRequest, locale),
  '--out',
  outputDirectory,
  '--screenshot',
  ...enhancementRequest.sources,
];

/** Decode the versioned Genshot sidecar once at its filesystem boundary. */
const readGenshotGenerationManifest = (
  outputDirectory: string,
): Effect.Effect<
  GenshotGenerationManifest,
  AiScreenshotsFailure,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const manifestPath = pathService.join(outputDirectory, GENSHOT_MANIFEST_FILENAME);
    const manifestSource = yield* fileSystem
      .readFileString(manifestPath)
      .pipe(Effect.mapError((cause) => screenshotFailure('read genshot manifest', cause)));
    return yield* Schema.decodeUnknown(Schema.parseJson(GenshotGenerationManifestSchema))(
      manifestSource,
    ).pipe(
      Effect.mapError((cause) =>
        screenshotFailure(
          'decode genshot manifest',
          cause,
          `Invalid ${GENSHOT_MANIFEST_FILENAME} in ${outputDirectory}: ${errorMessage(cause)}`,
        ),
      ),
    );
  });

/** Validate the manifest metadata and return its unique delivered file mappings. */
const validateGenshotGenerationManifest = (
  generationManifest: GenshotGenerationManifest,
  expectedTargetStore: ReturnType<typeof genshotTargetStore>,
  pathService: Path.Path,
): Effect.Effect<ReadonlySet<string>, AiScreenshotsFailure> =>
  Effect.gen(function* () {
    if (generationManifest.status !== 'succeeded') {
      return yield* Effect.fail(
        screenshotFailure(
          'validate genshot manifest',
          generationManifest.status,
          `Genshot manifest ${generationManifest.generationId} has status ${generationManifest.status}; expected succeeded.`,
        ),
      );
    }
    if (generationManifest.targetStore !== expectedTargetStore) {
      return yield* Effect.fail(
        screenshotFailure(
          'validate genshot manifest',
          generationManifest.targetStore,
          `Genshot manifest ${generationManifest.generationId} targets ${generationManifest.targetStore}; expected ${expectedTargetStore}.`,
        ),
      );
    }
    if (generationManifest.targetImageType !== 'store_screenshot') {
      return yield* Effect.fail(
        screenshotFailure(
          'validate genshot manifest',
          generationManifest.targetImageType,
          `Genshot manifest ${generationManifest.generationId} describes ${generationManifest.targetImageType}; expected store_screenshot.`,
        ),
      );
    }
    if (generationManifest.requestedImageCount !== generationManifest.generatedImages.length) {
      return yield* Effect.fail(
        screenshotFailure(
          'validate genshot manifest',
          generationManifest.requestedImageCount,
          `Genshot manifest ${generationManifest.generationId} requested-image count does not match its generated-image mappings.`,
        ),
      );
    }
    const mappedImageNumbers = new Set<number>();
    const mappedImageIds = new Set<string>();
    const deliveredFileNames = new Set<string>();
    for (const generatedImage of generationManifest.generatedImages) {
      if (mappedImageNumbers.has(generatedImage.imageNumber)) {
        return yield* Effect.fail(
          screenshotFailure(
            'validate genshot manifest',
            generatedImage.imageNumber,
            `Genshot manifest ${generationManifest.generationId} repeats image number ${generatedImage.imageNumber}.`,
          ),
        );
      }
      mappedImageNumbers.add(generatedImage.imageNumber);
      if (mappedImageIds.has(generatedImage.generatedImageId)) {
        return yield* Effect.fail(
          screenshotFailure(
            'validate genshot manifest',
            generatedImage.generatedImageId,
            `Genshot manifest ${generationManifest.generationId} repeats generated image ${generatedImage.generatedImageId}.`,
          ),
        );
      }
      mappedImageIds.add(generatedImage.generatedImageId);
      if (generatedImage.status !== 'delivered') {
        if (generatedImage.file === null) continue;
        return yield* Effect.fail(
          screenshotFailure(
            'validate genshot manifest',
            generatedImage.file,
            `Genshot manifest ${generationManifest.generationId} maps a non-delivered image to ${generatedImage.file}.`,
          ),
        );
      }
      if (generatedImage.file === null) {
        return yield* Effect.fail(
          screenshotFailure(
            'validate genshot manifest',
            generatedImage.generatedImageId,
            `Genshot manifest ${generationManifest.generationId} omits the file for delivered image ${generatedImage.generatedImageId}.`,
          ),
        );
      }
      const fileExtension = pathService.extname(generatedImage.file).toLowerCase();
      const mappingIsSafe = pathService.basename(generatedImage.file) === generatedImage.file;
      if (!mappingIsSafe) {
        return yield* Effect.fail(
          screenshotFailure(
            'validate genshot manifest',
            generatedImage.file,
            `Genshot manifest ${generationManifest.generationId} contains an unsafe generated-image file mapping.`,
          ),
        );
      }
      if (!GENSHOT_GENERATED_IMAGE_EXTENSIONS.has(fileExtension)) {
        return yield* Effect.fail(
          screenshotFailure(
            'validate genshot manifest',
            generatedImage.file,
            `Genshot manifest ${generationManifest.generationId} contains an unsafe generated-image file mapping.`,
          ),
        );
      }
      if (deliveredFileNames.has(generatedImage.file)) {
        return yield* Effect.fail(
          screenshotFailure(
            'validate genshot manifest',
            generatedImage.file,
            `Genshot manifest ${generationManifest.generationId} maps ${generatedImage.file} more than once.`,
          ),
        );
      }
      deliveredFileNames.add(generatedImage.file);
    }
    if (generationManifest.deliveredImageCount !== deliveredFileNames.size) {
      return yield* Effect.fail(
        screenshotFailure(
          'validate genshot manifest',
          generationManifest.deliveredImageCount,
          `Genshot manifest ${generationManifest.generationId} delivered-image count does not match its delivered mappings.`,
        ),
      );
    }
    return deliveredFileNames;
  });

/** Read only image files that are explicitly mapped by the decoded Genshot manifest. */
export const discoverGenshotScreenshots = (
  outputDirectory: string,
  locale: string,
  target: string,
  platform: Platform,
): Effect.Effect<
  readonly EnhancedShot[],
  AiScreenshotsFailure,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const generationManifest = yield* readGenshotGenerationManifest(outputDirectory);
    const deliveredFileNames = yield* validateGenshotGenerationManifest(
      generationManifest,
      genshotTargetStore(platform),
      pathService,
    );
    const generatedFileNames = yield* fileSystem
      .readDirectory(outputDirectory)
      .pipe(Effect.mapError((cause) => screenshotFailure('read genshot output', cause)));
    generatedFileNames.sort();
    const generatedScreenshots: EnhancedShot[] = [];
    for (const generatedFileName of generatedFileNames) {
      const fileExtension = pathService.extname(generatedFileName).toLowerCase();
      if (!GENSHOT_GENERATED_IMAGE_EXTENSIONS.has(fileExtension)) continue;
      if (!deliveredFileNames.has(generatedFileName)) {
        return yield* Effect.fail(
          screenshotFailure(
            'validate genshot manifest',
            generatedFileName,
            `Genshot output ${generatedFileName} is not mapped by manifest ${generationManifest.generationId}.`,
          ),
        );
      }
      generatedScreenshots.push({
        path: pathService.join(outputDirectory, generatedFileName),
        locale,
        target,
        generationId: generationManifest.generationId,
        generationManifestPath: pathService.join(outputDirectory, GENSHOT_MANIFEST_FILENAME),
      });
    }
    if (generatedScreenshots.length === 0) {
      return yield* Effect.fail(
        screenshotFailure(
          'read genshot output',
          outputDirectory,
          `genshot completed without writing screenshots into ${outputDirectory}.`,
        ),
      );
    }
    if (generatedScreenshots.length !== deliveredFileNames.size) {
      return yield* Effect.fail(
        screenshotFailure(
          'validate genshot manifest',
          generationManifest.generationId,
          `Genshot manifest ${generationManifest.generationId} maps a delivered file that is missing from ${outputDirectory}.`,
        ),
      );
    }
    return generatedScreenshots;
  });

/** Build the genshot CLI enhancement backend. */
export const createGenshotEnhancer = (
  binaryOverride: string | undefined,
): ScreenshotEnhancer<
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | Path.Path
  | PlatformCommandExecutor.CommandExecutor
> => {
  let executable = DEFAULT_GENSHOT_BINARY;
  if (binaryOverride !== undefined) executable = binaryOverride;
  return {
    name: 'genshot',
    enhance: (enhancementRequest) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        if (enhancementRequest.sources.length > MAX_GENSHOT_SOURCE_COUNT) {
          return yield* Effect.fail(
            screenshotFailure(
              'prepare genshot sources',
              enhancementRequest.sources,
              `genshot accepts at most ${MAX_GENSHOT_SOURCE_COUNT} source screenshots per generation.`,
            ),
          );
        }
        const generatedScreenshots: EnhancedShot[] = [];
        for (const locale of enhancementRequest.locales) {
          for (const target of enhancementRequest.targets) {
            const outputDirectory = pathService.join(enhancementRequest.outDir, locale, target);
            yield* fileSystem.makeDirectory(outputDirectory, { recursive: true });
            const commandArguments = buildGenshotArguments(
              enhancementRequest,
              locale,
              outputDirectory,
            );
            yield* executeCommand(executable, commandArguments, {
              environmentOverrides: { GENSHOT_CLIENT_SOURCE: 'launch-store' },
            }).pipe(
              Effect.mapError((cause) => {
                if (isMissingBinaryError(cause.cause)) {
                  return screenshotFailure(
                    'run genshot',
                    cause,
                    'genshot CLI not found. Install it with `npm install --global @genshot/cli`, run `genshot login`, or pass --genshot-bin <path>.',
                  );
                }
                return screenshotFailure('run genshot', cause);
              }),
            );
            const localeScreenshots = yield* discoverGenshotScreenshots(
              outputDirectory,
              locale,
              target,
              enhancementRequest.platform,
            );
            generatedScreenshots.push(...localeScreenshots);
          }
        }
        return generatedScreenshots;
      }),
  };
};

/** Resolve the requested platform selector. */
export const parseScreenshotPlatforms = (
  platformSelector: string | undefined,
): Effect.Effect<readonly Platform[], AiScreenshotsFailure> => {
  if (platformSelector === undefined) return Effect.succeed(['ios', 'android']);
  switch (platformSelector) {
    case 'all':
      return Effect.succeed(['ios', 'android']);
    case 'ios':
      return Effect.succeed(['ios']);
    case 'android':
      return Effect.succeed(['android']);
    default:
      return Effect.fail(
        screenshotFailure(
          'select screenshot platforms',
          platformSelector,
          `Unknown platform "${platformSelector}". Use ios, android, or all.`,
        ),
      );
  }
};

/** Resolve explicit or discovered screenshot locales. */
export const resolveScreenshotLocales = (
  localeCsv: string | undefined,
  sourceScreenshots: readonly LocalScreenshot[],
): Effect.Effect<readonly string[], AiScreenshotsFailure> => {
  if (localeCsv === undefined) {
    const discoveredLocales = [...new Set(sourceScreenshots.map((source) => source.locale))];
    if (discoveredLocales.length > 0) return Effect.succeed(discoveredLocales);
    return Effect.succeed(['en-US']);
  }
  const requestedLocales = parseCsvList(localeCsv);
  if (requestedLocales.length > 0) return Effect.succeed(requestedLocales);
  return Effect.fail(
    screenshotFailure(
      'parse screenshot locales',
      localeCsv,
      '--locale was empty. Pass locales like --locale en-US,fr-FR.',
    ),
  );
};

/** Resolve explicit or platform-default screenshot targets. */
export const resolveScreenshotTargets = (
  platform: Platform,
  targetCsv: string | undefined,
): Effect.Effect<readonly string[], AiScreenshotsFailure> => {
  if (targetCsv === undefined) {
    if (platform === 'ios') return Effect.succeed([GENSHOT_APP_STORE_TARGET]);
    return Effect.succeed([GENSHOT_GOOGLE_PLAY_TARGET]);
  }
  const requestedTargets = parseCsvList(targetCsv);
  if (requestedTargets.length === 0) {
    return Effect.fail(
      screenshotFailure(
        'parse screenshot targets',
        targetCsv,
        '--device-types was empty. Pass APP_IPHONE_67 for iOS or phone for Android.',
      ),
    );
  }
  let supportedTarget = GENSHOT_GOOGLE_PLAY_TARGET;
  if (platform === 'ios') supportedTarget = GENSHOT_APP_STORE_TARGET;
  const unsupportedTarget = requestedTargets.find(
    (requestedTarget) => requestedTarget !== supportedTarget,
  );
  if (unsupportedTarget === undefined) return Effect.succeed(requestedTargets);
  return Effect.fail(
    screenshotFailure(
      'select genshot target',
      unsupportedTarget,
      `genshot currently supports ${supportedTarget} for ${platform}; ${unsupportedTarget} requires a store-specific generator target that is not shipped yet.`,
    ),
  );
};

/** Parse optional comma-separated screenshot captions. */
export const parseScreenshotCaptions = (
  captionCsv: string | undefined,
): readonly string[] | undefined => {
  if (captionCsv === undefined) return;
  return parseCsvList(captionCsv);
};

/** Reject a generated batch when any screenshot is unreadable or off-spec. */
const validateGeneratedScreenshots = (
  platform: Platform,
  generatedScreenshots: readonly EnhancedShot[],
): Effect.Effect<void, AiScreenshotsFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.forEach(
    generatedScreenshots,
    (generatedScreenshot) =>
      checkScreenshotFile(platform, generatedScreenshot.target, generatedScreenshot.path).pipe(
        Effect.flatMap((dimensionCheck) => {
          if (!dimensionCheck.measured) {
            return Effect.fail(
              screenshotFailure(
                'validate generated screenshot',
                generatedScreenshot.path,
                `genshot produced an unreadable ${platform} file at ${generatedScreenshot.path} for ${generatedScreenshot.target}.`,
              ),
            );
          }
          if (!dimensionCheck.verdict.ok) {
            return Effect.fail(
              screenshotFailure(
                'validate generated screenshot',
                generatedScreenshot.path,
                `genshot returned an off-spec ${platform} screenshot for ${generatedScreenshot.target}: ${dimensionCheck.verdict.reason}`,
              ),
            );
          }
          return Effect.void;
        }),
      ),
    { concurrency: 1, discard: true },
  );

/** Promote one approved screenshot into its locale and target directory. */
const promoteScreenshot = (
  outputDirectory: string,
  generatedScreenshot: EnhancedShot,
): Effect.Effect<void, AiScreenshotsFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const targetDirectory = pathService.join(
      outputDirectory,
      generatedScreenshot.locale,
      generatedScreenshot.target,
    );
    yield* fileSystem
      .makeDirectory(targetDirectory, { recursive: true })
      .pipe(Effect.mapError((cause) => screenshotFailure('create screenshot directory', cause)));
    yield* fileSystem
      .copyFile(
        generatedScreenshot.path,
        pathService.join(targetDirectory, pathService.basename(generatedScreenshot.path)),
      )
      .pipe(Effect.mapError((cause) => screenshotFailure('promote screenshot', cause)));
  });

/** Retain one collision-safe manifest beside every generated locale and target set. */
const retainGenshotGenerationManifests = (
  outputDirectory: string,
  enhancedScreenshots: readonly EnhancedShot[],
): Effect.Effect<
  readonly RetainedGenshotGeneration[],
  AiScreenshotsFailure,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const retainedGenerations: RetainedGenshotGeneration[] = [];
    const retainedGenerationKeys = new Set<string>();
    for (const enhancedScreenshot of enhancedScreenshots) {
      const generationKey = [
        enhancedScreenshot.locale,
        enhancedScreenshot.target,
        enhancedScreenshot.generationId,
      ].join('\u0000');
      if (retainedGenerationKeys.has(generationKey)) continue;
      retainedGenerationKeys.add(generationKey);
      const targetDirectory = pathService.join(
        outputDirectory,
        enhancedScreenshot.locale,
        enhancedScreenshot.target,
      );
      yield* fileSystem
        .makeDirectory(targetDirectory, { recursive: true })
        .pipe(Effect.mapError((cause) => screenshotFailure('create screenshot directory', cause)));
      const manifestPath = pathService.join(
        targetDirectory,
        `${GENSHOT_RETAINED_MANIFEST_PREFIX}${enhancedScreenshot.generationId}.json`,
      );
      yield* fileSystem
        .copyFile(enhancedScreenshot.generationManifestPath, manifestPath)
        .pipe(Effect.mapError((cause) => screenshotFailure('retain genshot manifest', cause)));
      retainedGenerations.push({
        generationId: enhancedScreenshot.generationId,
        locale: enhancedScreenshot.locale,
        target: enhancedScreenshot.target,
        manifestPath,
      });
    }
    return retainedGenerations;
  });

/** Print the retained Generation IDs and their durable sidecar paths. */
const renderRetainedGenshotGenerations = (
  retainedGenerations: readonly RetainedGenshotGeneration[],
  logger: Logger,
): Effect.Effect<void, AiScreenshotsFailure> =>
  Effect.forEach(
    retainedGenerations,
    (retainedGeneration) =>
      writeLog(
        'render retained genshot generation',
        logger.ok(
          `Retained Genshot Generation ID ${retainedGeneration.generationId} -> ${retainedGeneration.manifestPath}`,
        ),
      ),
    { concurrency: 1, discard: true },
  );

/** Enhance, validate, and collect screenshots for each requested platform. */
const enhancePlatformScreenshots = <EnhancerRequirements>(
  platforms: readonly Platform[],
  locales: readonly string[],
  captions: readonly string[] | undefined,
  sourcePaths: readonly string[],
  sourceCount: number,
  stagingDirectory: string,
  deviceTypes: string | undefined,
  brief: string | undefined,
  screenshotEnhancer: ScreenshotEnhancer<EnhancerRequirements>,
  logger: Logger,
): Effect.Effect<
  readonly EnhancedShot[],
  AiScreenshotsFailure,
  EnhancerRequirements | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const enhancedScreenshots: EnhancedShot[] = [];
    for (const platform of platforms) {
      const targets = yield* resolveScreenshotTargets(platform, deviceTypes);
      yield* writeLog(
        'render screenshot enhancement step',
        logger.run(
          `Enhancing ${sourceCount} screenshot(s) -> ${platform} (${targets.join(', ')}) with ${screenshotEnhancer.name}`,
        ),
      );
      let enhancementRequest: EnhanceRequest = {
        platform,
        locales,
        targets,
        sources: sourcePaths,
        outDir: pathService.join(stagingDirectory, platform),
      };
      if (brief !== undefined) {
        enhancementRequest = { ...enhancementRequest, brief };
      }
      if (captions !== undefined) {
        enhancementRequest = { ...enhancementRequest, captions };
      }
      const platformScreenshots = yield* screenshotEnhancer
        .enhance(enhancementRequest)
        .pipe(
          Effect.mapError((cause) => screenshotFailure(`enhance ${platform} screenshots`, cause)),
        );
      yield* validateGeneratedScreenshots(platform, platformScreenshots);
      enhancedScreenshots.push(...platformScreenshots);
    }
    return enhancedScreenshots;
  });

/** Print the staged enhancement set before dry-run exit or promotion. */
const renderEnhancedPreview = (
  enhancedScreenshots: readonly EnhancedShot[],
  logger: Logger,
): Effect.Effect<void, AiScreenshotsFailure, Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    yield* writeLog(
      'render generated screenshots',
      logger.note(`genshot produced ${enhancedScreenshots.length} store-ready screenshot(s):`),
    );
    for (const generatedScreenshot of enhancedScreenshots) {
      yield* writeLog(
        'render generated screenshot',
        logger.line(
          `  ${generatedScreenshot.locale}/${generatedScreenshot.target} - ${pathService.basename(generatedScreenshot.path)}`,
        ),
      );
    }
    const previewedGenerationIds = new Set<string>();
    for (const generatedScreenshot of enhancedScreenshots) {
      if (previewedGenerationIds.has(generatedScreenshot.generationId)) continue;
      previewedGenerationIds.add(generatedScreenshot.generationId);
      yield* writeLog(
        'render genshot generation',
        logger.line(`  Genshot Generation ID: ${generatedScreenshot.generationId}`),
      );
    }
  });

/**
 * Confirm promotion when the operator did not pass `--yes`. Non-TTY without `--yes` refuses so CI
 * never writes silently; interactive runs open the staging folder then ask.
 */
const confirmScreenshotPromotion = (
  commandInput: AiScreenshotsInput,
  stagingDirectory: string,
  outputDirectory: string,
  enhancedCount: number,
): Effect.Effect<boolean, AiScreenshotsFailure, LaunchPromptService | Terminal.Terminal> =>
  Effect.gen(function* () {
    if (commandInput.yes === true) return true;
    const terminal = yield* Terminal.Terminal;
    const terminalIsInteractive = yield* terminal.isTTY;
    if (!terminalIsInteractive) {
      return yield* Effect.fail(
        screenshotFailure(
          'confirm screenshot promotion',
          commandInput,
          'Refusing to write without confirmation. Re-run with --yes (non-interactive).',
        ),
      );
    }
    yield* openUrl(stagingDirectory).pipe(Effect.catchAll(() => Effect.void));
    const launchPrompt = yield* LaunchPrompt;
    const confirmed = yield* launchPrompt
      .confirm(`Promote ${enhancedCount} screenshot(s) into ${outputDirectory}?`)
      .pipe(Effect.mapError((cause) => screenshotFailure('confirm screenshot promotion', cause)));
    if (confirmed) return true;
    yield* launchPrompt.cancel('Aborted - nothing written.');
    return false;
  });

/** Generate, validate, preview, and optionally promote screenshots for one app directory. */
export const generateScreenshots = <EnhancerRequirements>(
  appDirectory: string,
  commandInput: AiScreenshotsInput,
  screenshotEnhancer: ScreenshotEnhancer<EnhancerRequirements>,
): Effect.Effect<
  readonly EnhancedShot[],
  AiScreenshotsFailure,
  | EnhancerRequirements
  | FileSystem.FileSystem
  | LaunchPromptService
  | Logger
  | Path.Path
  | Terminal.Terminal
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const logger = yield* createLogger(false);
      const platforms = yield* parseScreenshotPlatforms(commandInput.platform);
      let sourceDirectory = pathService.join(appDirectory, SCREENSHOTS_DIRNAME);
      if (commandInput.in !== undefined) sourceDirectory = commandInput.in;
      let outputDirectory = pathService.join(appDirectory, SCREENSHOTS_DIRNAME);
      if (commandInput.out !== undefined) outputDirectory = commandInput.out;
      const sourceScreenshots = yield* discoverScreenshotsAt(sourceDirectory).pipe(
        Effect.mapError((cause) => screenshotFailure('discover source screenshots', cause)),
      );
      if (sourceScreenshots.length === 0) {
        return yield* Effect.fail(
          screenshotFailure(
            'discover source screenshots',
            sourceDirectory,
            `No source screenshots under ${sourceDirectory}. Capture real screens into screenshots/<locale>/<DISPLAY_TYPE>/ first - \`launch ai screenshots\` enhances real screenshots; it does not fabricate them.`,
          ),
        );
      }
      const locales = yield* resolveScreenshotLocales(commandInput.locale, sourceScreenshots);
      const captions = parseScreenshotCaptions(commandInput.captions);
      const sourcePaths = sourceScreenshots.map((sourceScreenshot) => sourceScreenshot.path);
      let createStagingDirectory = fileSystem.makeTempDirectoryScoped({
        prefix: 'launch-genshot-',
      });
      if (commandInput.dryRun === true) {
        createStagingDirectory = fileSystem.makeTempDirectory({ prefix: 'launch-genshot-review-' });
      }
      const stagingDirectory = yield* createStagingDirectory.pipe(
        Effect.mapError((cause) => screenshotFailure('create screenshot staging', cause)),
      );
      const enhancedScreenshots = yield* enhancePlatformScreenshots(
        platforms,
        locales,
        captions,
        sourcePaths,
        sourceScreenshots.length,
        stagingDirectory,
        commandInput.deviceTypes,
        commandInput.brief,
        screenshotEnhancer,
        logger,
      );
      yield* renderEnhancedPreview(enhancedScreenshots, logger);
      if (commandInput.dryRun === true) {
        yield* writeLog(
          'render screenshot dry run',
          logger.note(
            `Dry run - nothing promoted. Review the durable Genshot batch at ${stagingDirectory}`,
          ),
        );
        return [];
      }
      const shouldPromote = yield* confirmScreenshotPromotion(
        commandInput,
        stagingDirectory,
        outputDirectory,
        enhancedScreenshots.length,
      );
      if (!shouldPromote) return [];
      const retainedGenerations = yield* retainGenshotGenerationManifests(
        outputDirectory,
        enhancedScreenshots,
      );
      yield* Effect.forEach(
        enhancedScreenshots,
        (generatedScreenshot) => promoteScreenshot(outputDirectory, generatedScreenshot),
        { concurrency: 1, discard: true },
      );
      yield* writeLog(
        'render screenshot promotion',
        logger.ok(`Promoted ${enhancedScreenshots.length} screenshot(s) -> ${outputDirectory}`),
      );
      yield* renderRetainedGenshotGenerations(retainedGenerations, logger);
      yield* writeLog(
        'render screenshot next steps',
        logger.note('Review with `launch plan screenshots`, then upload with `launch sync`.'),
      );
      return enhancedScreenshots;
    }),
  );

/** Resolve the selected app and run the screenshot enhancement flow. */
export const aiScreenshotsCommandProgram = (
  commandInput: AiScreenshotsInput,
): Effect.Effect<void, AiScreenshotsFailure, AiScreenshotsRequirements> =>
  Effect.gen(function* () {
    const loadedConfiguration = yield* loadConfig().pipe(
      Effect.mapError((cause) => screenshotFailure('load Launch configuration', cause)),
    );
    const selectedApp = yield* selectApp(loadedConfiguration.apps, commandInput.app).pipe(
      Effect.mapError((cause) => screenshotFailure('select app', cause)),
    );
    yield* generateScreenshots(
      selectedApp.dir,
      commandInput,
      createGenshotEnhancer(commandInput.genshotBin),
    );
  });
