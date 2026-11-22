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
  return join(resolveLaunchHomeDirectory(), 'accounts.json');
}

export function resolveCredentialsDirectory(): string {
  return join(resolveLaunchHomeDirectory(), 'credentials');
}

export function resolveAndroidCredentialsDirectory(packageName: string): string {
  const packageDigest = createHash('sha256').update(packageName).digest('hex');

  return join(resolveCredentialsDirectory(), 'android', packageDigest);
}

export function resolveAndroidCredentialsIndexPath(packageName: string): string {
  return join(resolveAndroidCredentialsDirectory(packageName), 'android.json');
}

export function resolveLegacyAndroidCredentialsIndexPath(): string {
  return join(resolveCredentialsDirectory(), 'android.json');
}

export function resolveProvisioningProfilesDirectory(): string {
  return join(launchDirectories.homeDirectory, 'Library', 'MobileDevice', 'Provisioning Profiles');
}

export function resolvePushKeysFilePath(): string {
  return join(resolveLaunchHomeDirectory(), 'push-keys.json');
}

export function resolveStateFilePath(): string {
  return join(resolveLaunchHomeDirectory(), 'state.json');
}

export function resolveCloudStateFilePath(): string {
  return join(resolveLaunchHomeDirectory(), 'cloud.json');
}

export function resolveLastRunFilePath(): string {
  return join(resolveLaunchHomeDirectory(), 'last-run.json');
}

export function resolveLogsDirectory(): string {
  return join(resolveLaunchHomeDirectory(), 'logs');
}

export function resolveSecretsFilePath(): string {
  return join(resolveLaunchHomeDirectory(), 'secrets.json');
}

export function resolveArtifactsDirectory(): string {
  return join(resolveLaunchHomeDirectory(), 'artifacts');
}

export function resolveArtifactIndexFilePath(): string {
  return join(resolveArtifactsDirectory(), 'index.json');
}

export function resolveReleaseTrainsDirectory(): string {
  return join(resolveLaunchHomeDirectory(), 'release-trains');
}

export function resolveSnapshotsDirectory(): string {
  return join(resolveLaunchHomeDirectory(), 'snapshots');
}

export function resolveUpdateStateFilePath(): string {
  return join(resolveLaunchHomeDirectory(), 'update.json');
}

export function resolveAccountCredentialsDirectory(keyId: string): string {
  return join(resolveCredentialsDirectory(), sanitizePathIdentifier(keyId, 'default'));
}

export function resolveReleaseTrainFilePath(trainId: string): string {
  const safeTrainId = sanitizePathIdentifier(trainId, 'train');

  return join(resolveReleaseTrainsDirectory(), `${safeTrainId}.json`);
}

export function resolveSnapshotFilePath(snapshotName: string): string {
  const safeSnapshotName = sanitizePathIdentifier(snapshotName, 'snapshot');

  return join(resolveSnapshotsDirectory(), `${safeSnapshotName}.json`);
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
  return join(resolveLaunchHomeDirectory(), 'stats');
}

export function locateAppStatsDirectory(appKey: string): string {
  const isAppKeyValid = /^(ios|android)-[A-Za-z0-9._]+$/.test(appKey);

  if (isAppKeyValid == false) {
    throw makeInvalidAppKeyFailure(`"${appKey}" is not a valid app key.`);
  }

  return join(locateStatsDirectory(), appKey);
}

export function locatePortfolioFilePath(): string {
  return join(resolveLaunchHomeDirectory(), 'portfolio.json');
}
