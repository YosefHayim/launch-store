import { FileSystem, Path, type Terminal } from '@effect/platform';
import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Data, Effect, Schema } from 'effect';
import { loadActiveAscKey } from '../credentials/accounts.js';
import { loadServiceAccount } from '../credentials/androidKeystore.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { executeCommand } from '../services/exec.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPathsService } from '../services/paths.js';
import type { LaunchPromptService } from '../services/prompt.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import { isApplePlatform, parsePlatform, platformLabel } from '../services/platform.js';
import type { AppDescriptor, Platform } from '../types/app.js';
import type { AscKey } from '../types/credentials.js';
import {
  parseStoreConfig,
  readAndroidMetadataDir,
  readAppleMetadataDir,
  serializeStoreConfig,
  writeAndroidMetadataDir,
  writeAppleMetadataDir,
  type StoreConfig,
} from './storeConfig.js';
import { loadStoreAppContext, type StoreAppSelectionRequirements } from './selectStoreApp.js';

export const MetadataCommandInputSchema = Schema.Struct({
  operation: Schema.Literal('pull', 'push'),
  platform: Schema.optionalWith(Schema.String, { exact: true }),
  app: Schema.optionalWith(Schema.String, { exact: true }),
  config: Schema.optionalWith(Schema.String, { exact: true }),
  dryRun: Schema.Boolean,
});

export type MetadataCommandInput = Schema.Schema.Type<typeof MetadataCommandInputSchema>;

/** A metadata command step failed. */
export type MetadataCommandFailure = Readonly<{
  readonly _tag: 'MetadataCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeMetadataCommandFailure =
  Data.tagged<MetadataCommandFailure>('MetadataCommandFailure');

type MetadataCommandRequirements =
  | CommandExecutor
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | Terminal.Terminal;

type MetadataTarget = Readonly<{
  readonly app: AppDescriptor;
  readonly configPath: string;
}>;

/** Convert a dependency failure into the metadata command channel. */
const metadataFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): MetadataCommandFailure => {
  let message = `${operation} failed.`;
  if (explicitMessage !== undefined) message = explicitMessage;
  if (explicitMessage === undefined && typeof cause === 'string' && cause.length > 0)
    message = cause;
  if (explicitMessage === undefined && cause instanceof Error) message = cause.message;
  if (
    explicitMessage === undefined &&
    typeof cause === 'object' &&
    cause !== null &&
    'message' in cause &&
    typeof cause.message === 'string'
  ) {
    message = cause.message;
  }
  return makeMetadataCommandFailure({ operation, message, cause });
};

/** Preserve metadata failures while normalizing platform cleanup and terminal failures. */
const normalizeMetadataFailure = (operation: string, cause: unknown): MetadataCommandFailure => {
  if (
    typeof cause === 'object' &&
    cause !== null &&
    '_tag' in cause &&
    cause._tag === 'MetadataCommandFailure' &&
    'operation' in cause &&
    typeof cause.operation === 'string' &&
    'message' in cause &&
    typeof cause.message === 'string' &&
    'cause' in cause
  ) {
    return makeMetadataCommandFailure({
      operation: cause.operation,
      message: cause.message,
      cause: cause.cause,
    });
  }
  return metadataFailure(operation, cause);
};

/** Restrict listing sync to the two platforms backed by fastlane listing commands. */
export const assertListingPlatform = (
  platform: Platform,
): Effect.Effect<void, MetadataCommandFailure> => {
  if (platform === 'ios') return Effect.void;
  if (platform === 'android') return Effect.void;
  return Effect.fail(
    metadataFailure(
      'validate metadata platform',
      platform,
      `\`launch metadata\` syncs the iOS and Android store listing only - ${platformLabel(platform)} isn't supported yet. Build and ship it with \`launch build ${platform}\` / \`launch release ${platform}\`, and manage its listing in App Store Connect for now.`,
    ),
  );
};

/** Resolve the selected app and store.config.json path. */
const resolveMetadataTarget = (
  appSelector: string | undefined,
  configuredPath: string | undefined,
): Effect.Effect<
  MetadataTarget,
  MetadataCommandFailure,
  StoreAppSelectionRequirements | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const storeAppContext = yield* loadStoreAppContext(appSelector).pipe(
      Effect.mapError((cause) => metadataFailure('select metadata app', cause)),
    );
    let configPath = pathService.join(storeAppContext.app.dir, 'store.config.json');
    if (configuredPath !== undefined) configPath = configuredPath;
    return { app: storeAppContext.app, configPath };
  });

/** Read an existing metadata file for a pull merge, or start an empty document. */
const readExistingStoreConfig = (
  configPath: string,
): Effect.Effect<StoreConfig, MetadataCommandFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const configExists = yield* fileSystem
      .exists(configPath)
      .pipe(Effect.mapError((cause) => metadataFailure('inspect store metadata config', cause)));
    if (!configExists) return {};
    const configText = yield* fileSystem
      .readFileString(configPath)
      .pipe(Effect.mapError((cause) => metadataFailure('read store metadata config', cause)));
    const rawDocument = yield* Schema.decodeUnknown(Schema.parseJson())(configText).pipe(
      Effect.mapError((cause) => metadataFailure('parse store metadata JSON', cause)),
    );
    return yield* parseStoreConfig(rawDocument).pipe(
      Effect.mapError((cause) => metadataFailure('decode store metadata config', cause)),
    );
  });

/** Load a metadata file required by a push. */
const readRequiredStoreConfig = (
  configPath: string,
): Effect.Effect<StoreConfig, MetadataCommandFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const configExists = yield* fileSystem
      .exists(configPath)
      .pipe(Effect.mapError((cause) => metadataFailure('inspect store metadata config', cause)));
    if (!configExists) {
      return yield* Effect.fail(
        metadataFailure(
          'read store metadata config',
          configPath,
          `No store.config.json at ${configPath}. Run \`launch metadata pull\` to create one.`,
        ),
      );
    }
    const configText = yield* fileSystem
      .readFileString(configPath)
      .pipe(Effect.mapError((cause) => metadataFailure('read store metadata config', cause)));
    const rawDocument = yield* Schema.decodeUnknown(Schema.parseJson())(configText).pipe(
      Effect.mapError((cause) => metadataFailure('parse store metadata JSON', cause)),
    );
    return yield* parseStoreConfig(rawDocument).pipe(
      Effect.mapError((cause) => metadataFailure('decode store metadata config', cause)),
    );
  });

/** Write fastlane's App Store Connect API-key JSON inside a scoped directory. */
const writeAscKeyFile = (
  ascKey: AscKey,
  temporaryDirectory: string,
): Effect.Effect<string, MetadataCommandFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const apiKeyPath = pathService.join(temporaryDirectory, 'asc_api_key.json');
    yield* fileSystem
      .writeFileString(
        apiKeyPath,
        JSON.stringify({
          key_id: ascKey.keyId,
          issuer_id: ascKey.issuerId,
          key: ascKey.p8,
          in_house: false,
        }),
      )
      .pipe(Effect.mapError((cause) => metadataFailure('stage App Store API key', cause)));
    return apiKeyPath;
  });

/** Pull the live App Store listing into store.config.json. */
export const pullAppleListing = (
  bundleId: string,
  configPath: string,
  dryRun: boolean,
): Effect.Effect<void, MetadataCommandFailure, MetadataCommandRequirements> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const logger = yield* createLogger(false);
      const ascKey = yield* loadActiveAscKey().pipe(
        Effect.mapError((cause) => metadataFailure('load active Apple account', cause)),
      );
      if (ascKey === null) {
        return yield* Effect.fail(
          metadataFailure(
            'load active Apple account',
            'missing-active-account',
            'No active Apple account. Run `launch creds set-key` first.',
          ),
        );
      }
      const workingDirectory = yield* fileSystem
        .makeTempDirectoryScoped({ prefix: 'launch-meta-' })
        .pipe(Effect.mapError((cause) => metadataFailure('create metadata staging', cause)));
      const apiKeyPath = yield* writeAscKeyFile(ascKey, workingDirectory);
      if (dryRun) {
        yield* logger.step(
          'metadata',
          `would run \`fastlane deliver download_metadata\` for ${bundleId} -> ${workingDirectory}`,
        );
        return;
      }
      yield* executeCommand('fastlane', [
        'deliver',
        'download_metadata',
        '--api_key_path',
        apiKeyPath,
        '--app_identifier',
        bundleId,
        '--metadata_path',
        workingDirectory,
      ]).pipe(Effect.mapError((cause) => metadataFailure('download App Store metadata', cause)));
      const appleListing = yield* readAppleMetadataDir(workingDirectory).pipe(
        Effect.mapError((cause) => metadataFailure('read downloaded App Store metadata', cause)),
      );
      const currentStoreConfig = yield* readExistingStoreConfig(configPath);
      yield* fileSystem
        .writeFileString(
          configPath,
          serializeStoreConfig({ ...currentStoreConfig, apple: appleListing }),
        )
        .pipe(Effect.mapError((cause) => metadataFailure('write store metadata config', cause)));
      yield* logger.step('metadata', `wrote App Store listing -> ${configPath}`);
    }),
  ).pipe(Effect.mapError((cause) => normalizeMetadataFailure('pull App Store metadata', cause)));

/** Pull the live Play listing into store.config.json. */
const pullAndroidListing = (
  packageName: string,
  configPath: string,
  dryRun: boolean,
): Effect.Effect<void, MetadataCommandFailure, MetadataCommandRequirements> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const logger = yield* createLogger(false);
      const serviceAccountJson = yield* loadServiceAccount().pipe(
        Effect.mapError((cause) => metadataFailure('load Play service account', cause)),
      );
      if (serviceAccountJson === null) {
        return yield* Effect.fail(
          metadataFailure(
            'load Play service account',
            'missing-service-account',
            'No Play service account. Run `launch creds set-key --platform android` first.',
          ),
        );
      }
      const workingDirectory = yield* fileSystem
        .makeTempDirectoryScoped({ prefix: 'launch-meta-' })
        .pipe(Effect.mapError((cause) => metadataFailure('create metadata staging', cause)));
      const serviceAccountPath = pathService.join(workingDirectory, 'play-service-account.json');
      yield* fileSystem
        .writeFileString(serviceAccountPath, serviceAccountJson)
        .pipe(Effect.mapError((cause) => metadataFailure('stage Play service account', cause)));
      if (dryRun) {
        yield* logger.step(
          'metadata',
          `would run \`fastlane supply init\` for ${packageName} -> ${workingDirectory}`,
        );
        return;
      }
      yield* executeCommand('fastlane', [
        'supply',
        'init',
        '--json_key',
        serviceAccountPath,
        '--package_name',
        packageName,
        '--metadata_path',
        workingDirectory,
      ]).pipe(Effect.mapError((cause) => metadataFailure('download Play metadata', cause)));
      const androidListing = yield* readAndroidMetadataDir(workingDirectory).pipe(
        Effect.mapError((cause) => metadataFailure('read downloaded Play metadata', cause)),
      );
      const currentStoreConfig = yield* readExistingStoreConfig(configPath);
      yield* fileSystem
        .writeFileString(
          configPath,
          serializeStoreConfig({ ...currentStoreConfig, android: androidListing }),
        )
        .pipe(Effect.mapError((cause) => metadataFailure('write store metadata config', cause)));
      yield* logger.step('metadata', `wrote Play listing -> ${configPath}`);
    }),
  ).pipe(Effect.mapError((cause) => normalizeMetadataFailure('pull Play metadata', cause)));

/** Push App Store listing metadata without uploading a binary or screenshots. */
const pushAppleListing = (
  bundleId: string,
  configPath: string,
  dryRun: boolean,
): Effect.Effect<void, MetadataCommandFailure, MetadataCommandRequirements> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const logger = yield* createLogger(false);
      const storeConfig = yield* readRequiredStoreConfig(configPath);
      if (storeConfig.apple === undefined) {
        return yield* Effect.fail(
          metadataFailure(
            'read App Store metadata',
            configPath,
            `${configPath} has no "apple" section to push.`,
          ),
        );
      }
      const appleStoreConfig = storeConfig.apple;
      const workingDirectory = yield* fileSystem
        .makeTempDirectoryScoped({ prefix: 'launch-meta-' })
        .pipe(Effect.mapError((cause) => metadataFailure('create metadata staging', cause)));
      const writtenFields = yield* writeAppleMetadataDir(appleStoreConfig, workingDirectory).pipe(
        Effect.mapError((cause) => metadataFailure('stage App Store metadata', cause)),
      );
      if (dryRun) {
        yield* logger.step(
          'metadata',
          `would push ${writtenFields.length} App Store field(s) for ${bundleId} via \`fastlane deliver\``,
        );
        yield* logger.note(`rehearsed into ${workingDirectory} (no upload)`);
        return;
      }
      const ascKey = yield* loadActiveAscKey().pipe(
        Effect.mapError((cause) => metadataFailure('load active Apple account', cause)),
      );
      if (ascKey === null) {
        return yield* Effect.fail(
          metadataFailure(
            'load active Apple account',
            'missing-active-account',
            'No active Apple account. Run `launch creds set-key` first.',
          ),
        );
      }
      const apiKeyPath = yield* writeAscKeyFile(ascKey, workingDirectory);
      yield* executeCommand('fastlane', [
        'deliver',
        '--api_key_path',
        apiKeyPath,
        '--app_identifier',
        bundleId,
        '--metadata_path',
        workingDirectory,
        '--skip_binary_upload',
        'true',
        '--skip_screenshots',
        'true',
        '--force',
        'true',
      ]).pipe(Effect.mapError((cause) => metadataFailure('upload App Store metadata', cause)));
      yield* logger.step('metadata', `pushed App Store listing for ${bundleId}`);
    }),
  ).pipe(Effect.mapError((cause) => normalizeMetadataFailure('push App Store metadata', cause)));

/** Push Play listing metadata without uploading a binary or screenshots. */
const pushAndroidListing = (
  packageName: string,
  configPath: string,
  dryRun: boolean,
): Effect.Effect<void, MetadataCommandFailure, MetadataCommandRequirements> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const logger = yield* createLogger(false);
      const storeConfig = yield* readRequiredStoreConfig(configPath);
      if (storeConfig.android === undefined) {
        return yield* Effect.fail(
          metadataFailure(
            'read Play metadata',
            configPath,
            `${configPath} has no "android" section to push.`,
          ),
        );
      }
      const androidStoreConfig = storeConfig.android;
      const workingDirectory = yield* fileSystem
        .makeTempDirectoryScoped({ prefix: 'launch-meta-' })
        .pipe(Effect.mapError((cause) => metadataFailure('create metadata staging', cause)));
      const writtenFields = yield* writeAndroidMetadataDir(
        androidStoreConfig,
        workingDirectory,
      ).pipe(Effect.mapError((cause) => metadataFailure('stage Play metadata', cause)));
      if (dryRun) {
        yield* logger.step(
          'metadata',
          `would push ${writtenFields.length} Play field(s) for ${packageName} via \`fastlane supply\``,
        );
        yield* logger.note(`rehearsed into ${workingDirectory} (no upload)`);
        return;
      }
      const serviceAccountJson = yield* loadServiceAccount().pipe(
        Effect.mapError((cause) => metadataFailure('load Play service account', cause)),
      );
      if (serviceAccountJson === null) {
        return yield* Effect.fail(
          metadataFailure(
            'load Play service account',
            'missing-service-account',
            'No Play service account. Run `launch creds set-key --platform android` first.',
          ),
        );
      }
      const serviceAccountPath = pathService.join(workingDirectory, 'play-service-account.json');
      yield* fileSystem
        .writeFileString(serviceAccountPath, serviceAccountJson)
        .pipe(Effect.mapError((cause) => metadataFailure('stage Play service account', cause)));
      yield* executeCommand('fastlane', [
        'supply',
        '--json_key',
        serviceAccountPath,
        '--package_name',
        packageName,
        '--metadata_path',
        workingDirectory,
        '--skip_upload_apk',
        'true',
        '--skip_upload_aab',
        'true',
        '--skip_upload_changelogs',
        'true',
        '--skip_upload_images',
        'true',
        '--skip_upload_screenshots',
        'true',
      ]).pipe(Effect.mapError((cause) => metadataFailure('upload Play metadata', cause)));
      yield* logger.step('metadata', `pushed Play listing for ${packageName}`);
    }),
  ).pipe(Effect.mapError((cause) => normalizeMetadataFailure('push Play metadata', cause)));

/** Decode and run one metadata pull or push. */
export const metadataCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, MetadataCommandFailure, MetadataCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(MetadataCommandInputSchema)(
      rawCommandInput,
    ).pipe(Effect.mapError((cause) => metadataFailure('decode metadata command input', cause)));
    let platformText = 'ios';
    if (commandInput.platform !== undefined) platformText = commandInput.platform;
    const platform = yield* parsePlatform(platformText).pipe(
      Effect.mapError((cause) => metadataFailure('parse metadata platform', cause)),
    );
    yield* assertListingPlatform(platform);
    const metadataTarget = yield* resolveMetadataTarget(commandInput.app, commandInput.config);
    if (isApplePlatform(platform)) {
      if (metadataTarget.app.bundleId === undefined) {
        return yield* Effect.fail(
          metadataFailure(
            'resolve App Store listing',
            metadataTarget.app,
            'No bundle identifier for this app (set ios.bundleIdentifier).',
          ),
        );
      }
      if (commandInput.operation === 'pull') {
        yield* pullAppleListing(
          metadataTarget.app.bundleId,
          metadataTarget.configPath,
          commandInput.dryRun,
        );
        return;
      }
      yield* pushAppleListing(
        metadataTarget.app.bundleId,
        metadataTarget.configPath,
        commandInput.dryRun,
      );
      return;
    }
    if (metadataTarget.app.packageName === undefined) {
      return yield* Effect.fail(
        metadataFailure(
          'resolve Play listing',
          metadataTarget.app,
          'No Android application id for this app (set android.package).',
        ),
      );
    }
    if (commandInput.operation === 'pull') {
      yield* pullAndroidListing(
        metadataTarget.app.packageName,
        metadataTarget.configPath,
        commandInput.dryRun,
      );
      return;
    }
    yield* pushAndroidListing(
      metadataTarget.app.packageName,
      metadataTarget.configPath,
      commandInput.dryRun,
    );
  });
