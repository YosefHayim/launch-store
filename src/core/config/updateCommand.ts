import { FileSystem, Path, type Terminal } from '@effect/platform';
import type * as PlatformCommandExecutor from '@effect/platform/CommandExecutor';
import { Data, Effect, Schema } from 'effect';
import { resolveCommandEnv, selectApp, validateResolvedEnv } from '../build/pipelineEnv.js';
import { ensureCodeSigner } from '../credentials/codeSign.js';
import { publishOtaPlatform, readExportMetadata } from '../distribution/otaPublish.js';
import { updatesAppConfigSnippet, updatesWorkerScript } from '../distribution/otaManifest.js';
import { isCloudStorage, resolveStorageProvider } from '../distribution/storage.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPathsService } from '../services/paths.js';
import type { LaunchPromptService } from '../services/prompt.js';
import { executeCommand } from '../services/exec.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import type { AppDescriptor } from '../types/app.js';
import { formatEnvTable, parseCliEnv } from './env.js';
import { loadConfig } from './config.js';

const AppRuntimeVersionSchema = Schema.Struct({
  expo: Schema.optional(
    Schema.Struct({
      runtimeVersion: Schema.optional(Schema.Unknown),
    }),
  ),
  runtimeVersion: Schema.optional(Schema.Unknown),
});

/** Inputs resolved from the OTA update command flags. */
export type UpdateCommandInput = Readonly<{
  channel: string;
  platform: string;
  app?: string;
  profile: string;
  runtimeVersion?: string;
  sign: boolean;
  dryRun: boolean;
  env: readonly string[];
  includeLocal: boolean;
  printEnv: boolean;
}>;

/** OTA export, signing, or publishing failed. */
export type UpdateCommandFailure = Readonly<{
  readonly _tag: 'UpdateCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeUpdateCommandFailure = Data.tagged<UpdateCommandFailure>('UpdateCommandFailure');

/** Convert an unknown cause to the OTA update error channel. */
const updateFailure = (
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): UpdateCommandFailure => {
  let message = fallbackMessage;
  if (message === undefined && cause instanceof Error) message = cause.message;
  if (message === undefined) message = `${operation} failed.`;
  return makeUpdateCommandFailure({ operation, message, cause });
};

/** Map one terminal write into the OTA update error channel. */
const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, UpdateCommandFailure> =>
  logWrite.pipe(Effect.mapError((cause) => updateFailure(operation, cause)));

/** Resolve one or both native platforms from the CLI selector. */
const platformsFor = (
  platformSelector: string,
): Effect.Effect<readonly ('ios' | 'android')[], UpdateCommandFailure> => {
  if (platformSelector === 'ios') return Effect.succeed(['ios']);
  if (platformSelector === 'android') return Effect.succeed(['android']);
  if (platformSelector === 'all') return Effect.succeed(['ios', 'android']);
  return Effect.fail(
    updateFailure(
      'select update platforms',
      platformSelector,
      `Unknown --platform "${platformSelector}". Use ios, android, or all.`,
    ),
  );
};

/** Resolve the explicit, Expo-configured, or marketing-version runtime version. */
export const resolveRuntimeVersion = (
  appDescriptor: AppDescriptor,
  override: string | undefined,
): Effect.Effect<string, UpdateCommandFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (override !== undefined && override !== '') return override;
    const fileSystem = yield* FileSystem.FileSystem;
    const appConfigText = yield* fileSystem
      .readFileString(appDescriptor.configPath)
      .pipe(Effect.mapError((cause) => updateFailure('read app runtime version', cause)));
    const appConfig = yield* Schema.decodeUnknown(Schema.parseJson(AppRuntimeVersionSchema))(
      appConfigText,
    ).pipe(Effect.mapError((cause) => updateFailure('decode app runtime version', cause)));
    if (typeof appConfig.expo?.runtimeVersion === 'string') return appConfig.expo.runtimeVersion;
    if (typeof appConfig.runtimeVersion === 'string') return appConfig.runtimeVersion;
    if (appDescriptor.version !== undefined && appDescriptor.version !== '')
      return appDescriptor.version;
    return yield* Effect.fail(
      updateFailure(
        'resolve update runtime version',
        appDescriptor.configPath,
        'Could not resolve a runtime version. Pass --runtime-version <v> (e.g. 1.0.0).',
      ),
    );
  });

/** Render the deployment and app-configuration steps after an OTA publish. */
const renderAfterPublish = (
  workerUrl: string,
  runtimeVersion: string,
  signed: boolean,
  logger: Logger,
): Effect.Effect<void, UpdateCommandFailure> =>
  Effect.gen(function* () {
    yield* writeLog('render update next steps', logger.gap());
    yield* writeLog(
      'render update next steps',
      logger.note(
        "Edge worker uploaded - deploy it (Cloudflare) and point the app's updates.url at the Worker route.",
      ),
    );
    yield* writeLog('render update worker source', logger.note(`Worker source: ${workerUrl}`));
    yield* writeLog('render update next steps', logger.gap());
    yield* writeLog(
      'render update app configuration',
      logger.note('One-time app config (app.json):'),
    );
    yield* writeLog(
      'render update app configuration',
      logger.line(
        updatesAppConfigSnippet({
          updateUrl: '<your-worker-route>',
          runtimeVersion,
          signed,
        }),
      ),
    );
  });

/** Export and publish an Expo Updates bundle to the configured cloud storage. */
export const updateCommandProgram = (
  commandInput: UpdateCommandInput,
): Effect.Effect<
  void,
  UpdateCommandFailure,
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | PlatformCommandExecutor.CommandExecutor
  | Terminal.Terminal
> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const platforms = yield* platformsFor(commandInput.platform);
    const loadedConfiguration = yield* loadConfig().pipe(
      Effect.mapError((cause) => updateFailure('load Launch configuration', cause)),
    );
    const selectedApp = yield* selectApp(loadedConfiguration.apps, commandInput.app).pipe(
      Effect.mapError((cause) => updateFailure('select app', cause, cause.message)),
    );
    let buildProfile = loadedConfiguration.config.profiles[commandInput.profile];
    if (buildProfile === undefined) buildProfile = { name: commandInput.profile };
    const runtimeVersion = yield* resolveRuntimeVersion(selectedApp, commandInput.runtimeVersion);
    const environmentOverrides = yield* parseCliEnv([...commandInput.env]).pipe(
      Effect.mapError((cause) =>
        updateFailure('parse environment overrides', cause, cause.message),
      ),
    );
    const resolvedEnvironment = yield* resolveCommandEnv({
      app: selectedApp,
      profile: buildProfile,
      cliEnv: environmentOverrides,
      includeLocal: commandInput.includeLocal,
      envExclude: loadedConfiguration.config.envExclude,
    }).pipe(Effect.mapError((cause) => updateFailure('resolve update environment', cause)));
    if (commandInput.printEnv) {
      yield* writeLog(
        'render update environment',
        logger.line(formatEnvTable(resolvedEnvironment)),
      );
      return;
    }
    yield* validateResolvedEnv(
      selectedApp.dir,
      resolvedEnvironment,
      logger,
      loadedConfiguration.config.envExclude,
    ).pipe(Effect.mapError((cause) => updateFailure('validate update environment', cause)));
    if (!isCloudStorage(loadedConfiguration.config)) {
      return yield* Effect.fail(
        updateFailure(
          'resolve OTA storage',
          loadedConfiguration.config.storage,
          'OTA updates need a cloud storage provider. Set storage to s3 or supabase and add storageConfig in launch.config.ts.',
        ),
      );
    }
    yield* writeLog(
      'render update configuration',
      logger.step(
        'config',
        `${selectedApp.name} - channel ${commandInput.channel} - rtv ${runtimeVersion} - ${platforms.join('+')}`,
      ),
    );
    const storageProvider = yield* resolveStorageProvider(loadedConfiguration.config).pipe(
      Effect.mapError((cause) => updateFailure('resolve OTA storage', cause)),
    );
    const workerPath = 'updates/_worker.js';
    if (commandInput.dryRun) {
      for (const platform of platforms)
        yield* writeLog(
          'render update dry run',
          logger.step(
            'update',
            `would export + upload ${platform} manifest -> updates/${commandInput.channel}/${platform}/${runtimeVersion}/`,
            'ota-update',
          ),
        );
      let signingSummary = 'off (--no-sign)';
      if (commandInput.sign) signingSummary = 'on (manifests code-signed)';
      yield* writeLog('render update signing mode', logger.note(`signing: ${signingSummary}`));
      yield* renderAfterPublish(
        storageProvider.publicUrl(workerPath),
        runtimeVersion,
        commandInput.sign,
        logger,
      );
      return;
    }
    const pathService = yield* Path.Path;
    const distributionDirectory = pathService.join(selectedApp.dir, 'dist');
    yield* writeLog(
      'render update export step',
      logger.run(`Exporting JS bundle - ${selectedApp.name}`),
    );
    yield* executeCommand('npx', ['expo', 'export', '--output-dir', distributionDirectory], {
      workingDirectory: selectedApp.dir,
      environmentOverrides: resolvedEnvironment.values,
    }).pipe(Effect.mapError((cause) => updateFailure('export update bundle', cause)));
    yield* writeLog(
      'render update export outcome',
      logger.ok(`Exported JS bundle - ${selectedApp.name}`),
    );
    const exportMetadata = yield* readExportMetadata(distributionDirectory).pipe(
      Effect.mapError((cause) => updateFailure('read update export metadata', cause)),
    );
    let codeSigner = null;
    if (commandInput.sign)
      codeSigner = yield* ensureCodeSigner(false, logger).pipe(
        Effect.mapError((cause) => updateFailure('resolve update signer', cause)),
      );
    yield* Effect.forEach(
      platforms,
      (platform) =>
        publishOtaPlatform(
          {
            storage: storageProvider,
            distDir: distributionDirectory,
            metadata: exportMetadata,
            platform,
            channel: commandInput.channel,
            runtimeVersion,
            signer: codeSigner,
          },
          logger,
        ).pipe(Effect.mapError((cause) => updateFailure(`publish ${platform} update`, cause))),
      { concurrency: 1, discard: true },
    );
    yield* storageProvider
      .putObject(
        workerPath,
        updatesWorkerScript(storageProvider.publicUrl('')),
        'application/javascript',
      )
      .pipe(
        Effect.asVoid,
        Effect.mapError((cause) => updateFailure('upload update worker', cause)),
      );
    yield* renderAfterPublish(
      storageProvider.publicUrl(workerPath),
      runtimeVersion,
      commandInput.sign,
      logger,
    );
  });
