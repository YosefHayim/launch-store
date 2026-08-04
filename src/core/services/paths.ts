import * as FileSystem from '@effect/platform/FileSystem';
import type * as PlatformError from '@effect/platform/Error';
import * as Path from '@effect/platform/Path';
import { Context, Effect, Layer } from 'effect';
import { homedir } from 'node:os';

export type LaunchPathsService = Readonly<{
  readonly homeDirectory: string;
  readonly workingDirectory: string;
}>;

export const LaunchPaths = Context.GenericTag<LaunchPathsService>('launch-store/Paths');

export const makeLaunchPathsLive = (
  homeDirectory: string,
  workingDirectory: string,
): Layer.Layer<LaunchPathsService> =>
  Layer.succeed(LaunchPaths, {
    homeDirectory,
    workingDirectory,
  });

export const makeLaunchPathsTest = (
  homeDirectory: string,
  workingDirectory: string,
): Layer.Layer<LaunchPathsService> =>
  Layer.succeed(LaunchPaths, {
    homeDirectory,
    workingDirectory,
  });
/** Root of Launch's local state directory. */
export const LAUNCH_HOME = `${homedir()}/.launch`;
/** Where built artifacts are copied by the local storage provider. */
export const ARTIFACTS_DIR = `${LAUNCH_HOME}/artifacts`;
/** Full tee'd logs of long external tools (xcodebuild, gradle, prebuild). */
export const LOGS_DIR = `${LAUNCH_HOME}/logs`;
/** JSON index of stored artifacts (newest-first history). */
export const ARTIFACT_INDEX = `${ARTIFACTS_DIR}/index.json`;
/** Cross-run UX state: whether the user has seen the first-run tour. */
export const STATE_FILE = `${LAUNCH_HOME}/state.json`;
/** Registry of onboarded Apple accounts (non-secret: Key IDs, Issuer IDs, labels only). */
export const ACCOUNTS_FILE = `${LAUNCH_HOME}/accounts.json`;
/** Index of keychain-backed build secrets (records WHICH secrets exist, not their values). */
export const SECRETS_FILE = `${LAUNCH_HOME}/secrets.json`;
/** Non-secret signing metadata + the encrypted `.p12` backup (chmod 600). */
export const CREDENTIALS_DIR = `${LAUNCH_HOME}/credentials`;
/** Legacy single-account signing index (kept for first-run migration). */
export const CREDENTIALS_INDEX = `${CREDENTIALS_DIR}/index.json`;
/** Non-secret Android signing metadata. */
export const ANDROID_CREDENTIALS_INDEX = `${CREDENTIALS_DIR}/android.json`;
/** Where macOS/Xcode looks for installed provisioning profiles. */
export const PROVISIONING_PROFILES_DIR = `${homedir()}/Library/MobileDevice/Provisioning Profiles`;
/** Vault index of imported APNs auth keys (non-secret metadata only). */
export const PUSH_KEYS_FILE = `${LAUNCH_HOME}/push-keys.json`;
/** Machine-discovered remote-build state (host handle, AMI id - non-secret). */
export const CLOUD_STATE = `${LAUNCH_HOME}/cloud.json`;
/** Per-app build fingerprints that decide clean-vs-incremental. */
export const BUILD_STATE_DIR = `${LAUNCH_HOME}/build-state`;
/** Remembered interactive build picks (last app, bump choices). */
export const LAST_RUN_FILE = `${LAUNCH_HOME}/last-run.json`;
/** Persisted `launch release-train` records (one JSON per coordinated release). */
export const RELEASE_TRAINS_DIR = `${LAUNCH_HOME}/release-trains`;
/** Persisted `launch snapshot` records (one JSON per captured point-in-time). */
export const SNAPSHOTS_DIR = `${LAUNCH_HOME}/snapshots`;
const sanitizePathIdentifier = (identifier: string, fallbackIdentifier: string): string => {
  const sanitizedIdentifier = identifier.replace(/[^A-Za-z0-9_-]/g, '');
  if (sanitizedIdentifier.length === 0) return fallbackIdentifier;
  return sanitizedIdentifier;
};
export const resolveLaunchHomeDirectory = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const pathService = yield* Path.Path;
    return pathService.join(launchPaths.homeDirectory, '.launch');
  });
export const resolveAccountsFilePath = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveLaunchHomeDirectory(), 'accounts.json');
  });
export const resolveCredentialsDirectory = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveLaunchHomeDirectory(), 'credentials');
  });
export const resolveAndroidCredentialsIndexPath = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveCredentialsDirectory(), 'android.json');
  });
export const resolveProvisioningProfilesDirectory = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const pathService = yield* Path.Path;
    return pathService.join(
      launchPaths.homeDirectory,
      'Library',
      'MobileDevice',
      'Provisioning Profiles',
    );
  });
export const resolvePushKeysFilePath = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveLaunchHomeDirectory(), 'push-keys.json');
  });
export const resolveStateFilePath = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveLaunchHomeDirectory(), 'state.json');
  });
export const resolveCloudStateFilePath = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveLaunchHomeDirectory(), 'cloud.json');
  });
export const resolveLastRunFilePath = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveLaunchHomeDirectory(), 'last-run.json');
  });
export const resolveLogsDirectory = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveLaunchHomeDirectory(), 'logs');
  });
export const resolveSecretsFilePath = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveLaunchHomeDirectory(), 'secrets.json');
  });
export const resolveArtifactsDirectory = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveLaunchHomeDirectory(), 'artifacts');
  });
export const resolveArtifactIndexFilePath = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveArtifactsDirectory(), 'index.json');
  });
export const resolveReleaseTrainsDirectory = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveLaunchHomeDirectory(), 'release-trains');
  });
export const resolveSnapshotsDirectory = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveLaunchHomeDirectory(), 'snapshots');
  });
export const resolveUpdateStateFilePath = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveLaunchHomeDirectory(), 'update.json');
  });
export const resolveAccountCredentialsDirectory = (
  keyId: string,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(
      yield* resolveCredentialsDirectory(),
      sanitizePathIdentifier(keyId, 'default'),
    );
  });
export const resolveReleaseTrainFilePath = (
  trainId: string,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const safeTrainId = sanitizePathIdentifier(trainId, 'train');
    return pathService.join(yield* resolveReleaseTrainsDirectory(), `${safeTrainId}.json`);
  });
export const resolveSnapshotFilePath = (
  snapshotName: string,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const safeSnapshotName = sanitizePathIdentifier(snapshotName, 'snapshot');
    return pathService.join(yield* resolveSnapshotsDirectory(), `${safeSnapshotName}.json`);
  });
export const ensureDirectoryExists = (
  directoryPath: string,
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(directoryPath, { recursive: true });
    return directoryPath;
  });
