import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

type LaunchDirectories = Readonly<{
  homeDirectory: string;
  workingDirectory: string;
}>;

let launchDirectories: LaunchDirectories = {
  homeDirectory: homedir(),
  workingDirectory: process.cwd(),
};

export function useLaunchDirectories(directories: LaunchDirectories): void {
  launchDirectories = directories;
}

export function resetLaunchDirectories(): void {
  launchDirectories = {
    homeDirectory: homedir(),
    workingDirectory: process.cwd(),
  };
}

export function readLaunchDirectories(): LaunchDirectories {
  return launchDirectories;
}

export const LAUNCH_HOME = `${homedir()}/.launch`;
export const ARTIFACTS_DIR = `${LAUNCH_HOME}/artifacts`;
export const ARTIFACT_INDEX = `${ARTIFACTS_DIR}/index.json`;
export const ACCOUNTS_FILE = `${LAUNCH_HOME}/accounts.json`;
export const CREDENTIALS_DIR = `${LAUNCH_HOME}/credentials`;
export const CREDENTIALS_INDEX = `${CREDENTIALS_DIR}/index.json`;
export const PROVISIONING_PROFILES_DIR = `${homedir()}/Library/MobileDevice/Provisioning Profiles`;

function sanitizePathIdentifier(identifier: string, fallbackIdentifier: string): string {
  const sanitizedIdentifier = identifier.replace(/[^A-Za-z0-9_-]/g, '');

  if (sanitizedIdentifier.length == 0) {
    return fallbackIdentifier;
  }

  return sanitizedIdentifier;
}

export function resolveLaunchHomeDirectory(): string {
  return join(launchDirectories.homeDirectory, '.launch');
}

export function resolveAccountsFilePath(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'accounts.json');
}

export function resolveCredentialsDirectory(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'credentials');
}

export function resolveAndroidCredentialsDirectory(packageName: string): string {
  const packageDigest = createHash('sha256').update(packageName).digest('hex');

  const credentialsDirectory = resolveCredentialsDirectory();
  return join(credentialsDirectory, 'android', packageDigest);
}

export function resolveAndroidCredentialsIndexPath(packageName: string): string {
  const androidCredentialsDirectory = resolveAndroidCredentialsDirectory(packageName);
  return join(androidCredentialsDirectory, 'android.json');
}

export function resolveLegacyAndroidCredentialsIndexPath(): string {
  const credentialsDirectory = resolveCredentialsDirectory();
  return join(credentialsDirectory, 'android.json');
}

export function resolveProvisioningProfilesDirectory(): string {
  return join(launchDirectories.homeDirectory, 'Library', 'MobileDevice', 'Provisioning Profiles');
}

export function resolvePushKeysFilePath(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'push-keys.json');
}

export function resolveStateFilePath(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'state.json');
}

export function resolveCloudStateFilePath(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'cloud.json');
}

export function resolveLastRunFilePath(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'last-run.json');
}

export function resolveLogsDirectory(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'logs');
}

export function resolveSecretsFilePath(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'secrets.json');
}

export function resolveArtifactsDirectory(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'artifacts');
}

export function resolveArtifactIndexFilePath(): string {
  const artifactsDirectory = resolveArtifactsDirectory();
  return join(artifactsDirectory, 'index.json');
}

export function resolveReleaseTrainsDirectory(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'release-trains');
}

export function resolveSnapshotsDirectory(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'snapshots');
}

export function resolveUpdateStateFilePath(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'update.json');
}

export function resolveAccountCredentialsDirectory(keyId: string): string {
  const credentialsDirectory = resolveCredentialsDirectory();
  const pathIdentifier = sanitizePathIdentifier(keyId, 'default');
  return join(credentialsDirectory, pathIdentifier);
}

export function resolveReleaseTrainFilePath(trainId: string): string {
  const safeTrainId = sanitizePathIdentifier(trainId, 'train');

  const releaseTrainsDirectory = resolveReleaseTrainsDirectory();
  return join(releaseTrainsDirectory, `${safeTrainId}.json`);
}

export function resolveSnapshotFilePath(snapshotName: string): string {
  const safeSnapshotName = sanitizePathIdentifier(snapshotName, 'snapshot');

  const snapshotsDirectory = resolveSnapshotsDirectory();
  return join(snapshotsDirectory, `${safeSnapshotName}.json`);
}

export async function ensureDirectoryExists(directoryPath: string): Promise<string> {
  await mkdir(directoryPath, { recursive: true });

  return directoryPath;
}

export type InvalidAppKeyFailure = Readonly<{
  _tag: 'InvalidAppKeyFailure';
  message: string;
}>;

function makeInvalidAppKeyFailure(message: string): InvalidAppKeyFailure {
  return { _tag: 'InvalidAppKeyFailure', message };
}

export function locateStatsDirectory(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'stats');
}

export function locateAppStatsDirectory(appKey: string): string {
  const isAppKeyValid = /^(ios|android)-[A-Za-z0-9._]+$/.test(appKey);

  if (isAppKeyValid == false) {
    throw makeInvalidAppKeyFailure(`"${appKey}" is not a valid app key.`);
  }

  const statsDirectory = locateStatsDirectory();

  return join(statsDirectory, appKey);
}

export function locatePortfolioFilePath(): string {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  return join(launchHomeDirectory, 'portfolio.json');
}
