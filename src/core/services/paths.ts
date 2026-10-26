import { createHash } from 'node:crypto';
import * as FileSystem from '@effect/platform/FileSystem';
import type * as PlatformError from '@effect/platform/Error';
import * as Path from '@effect/platform/Path';
import { Context, Data, Effect, Layer } from 'effect';
import { APP_KEY_PATTERN } from '../types/portfolio.js';
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
/** JSON index of stored artifacts (newest-first history). */
export const ARTIFACT_INDEX = `${ARTIFACTS_DIR}/index.json`;
/** Registry of onboarded Apple accounts (non-secret: Key IDs, Issuer IDs, labels only). */
export const ACCOUNTS_FILE = `${LAUNCH_HOME}/accounts.json`;
/** Non-secret signing metadata + the encrypted `.p12` backup (chmod 600). */
export const CREDENTIALS_DIR = `${LAUNCH_HOME}/credentials`;
/** Legacy single-account signing index (kept for first-run migration). */
export const CREDENTIALS_INDEX = `${CREDENTIALS_DIR}/index.json`;
/** Where macOS/Xcode looks for installed provisioning profiles. */
export const PROVISIONING_PROFILES_DIR = `${homedir()}/Library/MobileDevice/Provisioning Profiles`;
/** Vault index of imported APNs auth keys (non-secret metadata only). */
export const PUSH_KEYS_FILE = `${LAUNCH_HOME}/push-keys.json`;
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
export const resolveAndroidCredentialsDirectory = (
  packageName?: string,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const credentialsDirectory = yield* resolveCredentialsDirectory();
    if (packageName === undefined) return credentialsDirectory;
    const packageDigest = createHash('sha256').update(packageName).digest('hex');
    return pathService.join(credentialsDirectory, 'android', packageDigest);
  });
export const resolveAndroidCredentialsIndexPath = (
  packageName?: string,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveAndroidCredentialsDirectory(packageName), 'android.json');
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
export type InvalidAppKeyFailure = Readonly<{
  readonly _tag: 'InvalidAppKeyFailure';
  readonly message: string;
}>;
const makeInvalidAppKeyFailure = Data.tagged<InvalidAppKeyFailure>('InvalidAppKeyFailure');
export const locateStatsDirectory = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const launchHomeDirectory = yield* resolveLaunchHomeDirectory();
    return pathService.join(launchHomeDirectory, 'stats');
  });
export const locateAppStatsDirectory = (
  appKey: string,
): Effect.Effect<string, InvalidAppKeyFailure, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const isAppKeyValid = APP_KEY_PATTERN.test(appKey);
    const isAppKeyInvalid = !isAppKeyValid;
    if (isAppKeyInvalid) {
      const invalidKeyFailure = makeInvalidAppKeyFailure({
        message: `"${appKey}" is not a valid app key.`,
      });
      return yield* Effect.fail(invalidKeyFailure);
    }
    const pathService = yield* Path.Path;
    const statsDirectory = yield* locateStatsDirectory();
    return pathService.join(statsDirectory, appKey);
  });
export const locatePortfolioFilePath = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const launchHomeDirectory = yield* resolveLaunchHomeDirectory();
    return pathService.join(launchHomeDirectory, 'portfolio.json');
  });
