import { FileSystem, Path } from '@effect/platform';
import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Data, Effect, Schema } from 'effect';
import { loadConfig } from '../config/config.js';
import {
  resolveStorageProvider,
  type StorageResolverRequirements,
} from '../distribution/storage.js';
import { errorMessage } from '../services/errorMessage.js';
import { executeCommand } from '../services/exec.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import type { BuildArtifact } from '../types/artifacts.js';
import { findBuild } from './buildHistoryCommand.js';

export const RunCommandInputSchema = Schema.Struct({
  reference: Schema.String,
  device: Schema.optionalWith(Schema.String, { exact: true }),
});

export type RunCommandInput = Schema.Schema.Type<typeof RunCommandInputSchema>;

export type RunCommandFailure = Readonly<{
  readonly _tag: 'RunCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeRunCommandFailure = Data.tagged<RunCommandFailure>('RunCommandFailure');

type RunCommandRequirements =
  | CommandExecutor
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | Logger
  | Path.Path
  | StorageResolverRequirements;

/** Build the `adb install` arguments for an optional device serial. */
export const adbInstallArgs = (
  apkPath: string,
  serial: string | undefined = undefined,
): string[] => {
  const commandArguments = ['install', '-r', apkPath];
  if (serial === undefined) return commandArguments;
  return ['-s', serial, ...commandArguments];
};

/** Build the `bundletool build-apks` arguments for a universal APK set. */
export const bundletoolBuildApksArgs = (aabPath: string, apksPath: string): string[] => [
  'build-apks',
  `--bundle=${aabPath}`,
  `--output=${apksPath}`,
  '--mode=universal',
  '--overwrite',
];

/** Build the `bundletool install-apks` arguments for an optional device serial. */
export const bundletoolInstallApksArgs = (
  apksPath: string,
  serial: string | undefined = undefined,
): string[] => {
  const commandArguments = ['install-apks', `--apks=${apksPath}`];
  if (serial === undefined) return commandArguments;
  return [...commandArguments, `--device-id=${serial}`];
};

/** Build the `xcrun devicectl` arguments for an optional Apple device identifier. */
export const devicectlInstallArgs = (
  appPath: string,
  device: string | undefined = undefined,
): string[] => {
  const commandArguments = ['devicectl', 'device', 'install', 'app'];
  if (device === undefined) return [...commandArguments, appPath];
  return [...commandArguments, '--device', device, appPath];
};

/** Install an APK directly or turn an AAB into a universal APK set first. */
const installAndroidArtifact = (
  artifactPath: string,
  serial: string | undefined,
): Effect.Effect<void, unknown, RunCommandRequirements> =>
  Effect.gen(function* () {
    if (artifactPath.endsWith('.apk')) {
      yield* executeCommand('adb', adbInstallArgs(artifactPath, serial));
      return;
    }
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const temporaryDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'launch-run-' });
    const apksPath = pathService.join(temporaryDirectory, 'app.apks');
    yield* executeCommand('bundletool', bundletoolBuildApksArgs(artifactPath, apksPath));
    yield* executeCommand('bundletool', bundletoolInstallApksArgs(apksPath, serial));
  }).pipe(Effect.scoped);

/** Unpack an IPA and install its application bundle with `devicectl`. */
const installAppleArtifact = (
  artifactPath: string,
  device: string | undefined,
): Effect.Effect<void, unknown, RunCommandRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const temporaryDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'launch-run-' });
    yield* executeCommand('unzip', ['-oq', artifactPath, '-d', temporaryDirectory]);
    const applicationDirectory = pathService.join(temporaryDirectory, 'Payload');
    const applicationNames = yield* fileSystem.readDirectory(applicationDirectory);
    const applicationName = applicationNames.find((entryName) => entryName.endsWith('.app'));
    if (applicationName === undefined) {
      return yield* Effect.fail(
        makeRunCommandFailure({
          operation: 'unpack Apple artifact',
          message: `No .app exists inside ${artifactPath}.`,
        }),
      );
    }
    const logger = yield* createLogger(false);
    if (device === undefined) {
      yield* logger.warn('No --device was provided; devicectl will choose a connected device.');
    }
    yield* executeCommand(
      'xcrun',
      devicectlInstallArgs(pathService.join(applicationDirectory, applicationName), device),
    );
  }).pipe(Effect.scoped);

/** Find the requested stored artifact and verify its file still exists. */
const findRunnableArtifact = (
  reference: string,
): Effect.Effect<
  BuildArtifact,
  unknown,
  FileSystem.FileSystem | LaunchPathsService | StorageResolverRequirements
> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const loadedConfig = yield* loadConfig(launchPaths.workingDirectory);
    const storageProvider = yield* resolveStorageProvider(
      loadedConfig.config,
      launchPaths.workingDirectory,
    );
    const artifact = findBuild(yield* storageProvider.list(), reference);
    if (artifact === undefined) {
      return yield* Effect.fail(
        makeRunCommandFailure({
          operation: 'find stored artifact',
          message: `No build matches "${reference}". Run \`launch builds list\` first.`,
        }),
      );
    }
    const fileSystem = yield* FileSystem.FileSystem;
    if (yield* fileSystem.exists(artifact.path)) return artifact;
    return yield* Effect.fail(
      makeRunCommandFailure({
        operation: 'find stored artifact',
        message: `The artifact for "${reference}" is gone from ${artifact.path}. Rebuild it.`,
      }),
    );
  });

/** Decode one `launch run` request and install its stored artifact. */
export const runCommandProgram = (
  commandInput: unknown,
): Effect.Effect<void, RunCommandFailure, RunCommandRequirements> =>
  Effect.gen(function* () {
    const decodedCommand = yield* Schema.decodeUnknown(RunCommandInputSchema)(commandInput);
    const artifact = yield* findRunnableArtifact(decodedCommand.reference);
    const logger = yield* createLogger(false);
    yield* logger.run(
      `Installing ${artifact.appName} ${artifact.version} (build ${artifact.buildNumber}).`,
    );
    if (artifact.platform === 'android') {
      yield* installAndroidArtifact(artifact.path, decodedCommand.device);
    } else {
      yield* installAppleArtifact(artifact.path, decodedCommand.device);
    }
    yield* logger.ok("Installed. Launch it from the device's home screen.");
  }).pipe(
    Effect.mapError((cause) =>
      makeRunCommandFailure({
        operation: 'install stored artifact',
        message: errorMessage(cause),
        cause,
      }),
    ),
  );
