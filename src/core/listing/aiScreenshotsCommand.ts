import { FileSystem, Path, Terminal } from '@effect/platform';
import type * as PlatformCommandExecutor from '@effect/platform/CommandExecutor';
import { Data, Effect } from 'effect';
import { selectApp } from '../build/pipelineEnv.js';
import { loadConfig } from '../config/config.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { errorMessage } from '../services/errorMessage.js';
import { executeCommand } from '../services/exec.js';
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
import {
  checkScreenshotFile,
  DEFAULT_APPLE_DISPLAY_TYPES,
  DEFAULT_PLAY_FORM_FACTORS,
} from './screenshots/specs.js';

const DEFAULT_GENSHOT_BINARY = 'genshot';

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
        yield* fileSystem.makeDirectory(enhancementRequest.outDir, { recursive: true });
        const commandArguments = [
          'enhance',
          '--platform',
          enhancementRequest.platform,
          '--out',
          enhancementRequest.outDir,
          '--locales',
          enhancementRequest.locales.join(','),
          '--targets',
          enhancementRequest.targets.join(','),
        ];
        if (enhancementRequest.brief !== undefined) {
          commandArguments.push('--brief', enhancementRequest.brief);
        }
        if (enhancementRequest.captions !== undefined) {
          commandArguments.push('--captions', enhancementRequest.captions.join(','));
        }
        commandArguments.push(...enhancementRequest.sources);
        yield* executeCommand(executable, commandArguments).pipe(
          Effect.mapError((cause) => {
            if (isMissingBinaryError(cause.cause)) {
              return screenshotFailure(
                'run genshot',
                cause,
                'genshot CLI not found. Install the genshot screenshot backend and sign in, or pass --genshot-bin <path>.',
              );
            }
            return screenshotFailure('run genshot', cause);
          }),
        );
        const generatedScreenshots = yield* discoverScreenshotsAt(enhancementRequest.outDir).pipe(
          Effect.mapError((cause) => screenshotFailure('read genshot output', cause)),
        );
        return generatedScreenshots.map((generatedScreenshot) => ({
          path: generatedScreenshot.path,
          locale: generatedScreenshot.locale,
          target: generatedScreenshot.displayType,
        }));
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
    if (platform === 'ios') return Effect.succeed([...DEFAULT_APPLE_DISPLAY_TYPES]);
    return Effect.succeed([...DEFAULT_PLAY_FORM_FACTORS]);
  }
  const requestedTargets = parseCsvList(targetCsv);
  if (requestedTargets.length > 0) return Effect.succeed(requestedTargets);
  return Effect.fail(
    screenshotFailure(
      'parse screenshot targets',
      targetCsv,
      '--device-types was empty. Pass slots like --device-types APP_IPHONE_67.',
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
      const stagingDirectory = yield* fileSystem
        .makeTempDirectoryScoped({ prefix: 'launch-genshot-' })
        .pipe(Effect.mapError((cause) => screenshotFailure('create screenshot staging', cause)));
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
          logger.note('Dry run - nothing promoted. Drop --dry-run to stage and promote.'),
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
      yield* Effect.forEach(
        enhancedScreenshots,
        (generatedScreenshot) => promoteScreenshot(outputDirectory, generatedScreenshot),
        { concurrency: 1, discard: true },
      );
      yield* writeLog(
        'render screenshot promotion',
        logger.ok(`Promoted ${enhancedScreenshots.length} screenshot(s) -> ${outputDirectory}`),
      );
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
