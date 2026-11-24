// Names the folders Launch uses for accounts, credentials, artifacts, logs, and stats.

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

export function readLaunchHomeDirectory(): string {
  return join(launchDirectories.homeDirectory, '.launch');
}

export function readAccountsFilePath(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'accounts.json');
}

export function readCredentialsDirectory(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'credentials');
}

export function readAndroidCredentialsDirectory(packageName: string): string {
  const packageDigest = createHash('sha256').update(packageName).digest('hex');

  const credentialsDirectory = readCredentialsDirectory();
  return join(credentialsDirectory, 'android', packageDigest);
}

export function readAndroidCredentialsIndexPath(packageName: string): string {
  const androidCredentialsDirectory = readAndroidCredentialsDirectory(packageName);
  return join(androidCredentialsDirectory, 'android.json');
}

export function readLegacyAndroidCredentialsIndexPath(): string {
  const credentialsDirectory = readCredentialsDirectory();
  return join(credentialsDirectory, 'android.json');
}

export function readProvisioningProfilesDirectory(): string {
  return join(launchDirectories.homeDirectory, 'Library', 'MobileDevice', 'Provisioning Profiles');
}

export function readPushKeysFilePath(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'push-keys.json');
}

export function readStateFilePath(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'state.json');
}

export function readCloudStateFilePath(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'cloud.json');
}

export function readLastRunFilePath(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'last-run.json');
}

export function readLogsDirectory(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'logs');
}

export function readSecretsFilePath(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'secrets.json');
}

export function readArtifactsDirectory(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'artifacts');
}

export function readArtifactIndexFilePath(): string {
  const artifactsDirectory = readArtifactsDirectory();
  return join(artifactsDirectory, 'index.json');
}

export function readReleaseTrainsDirectory(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'release-trains');
}

export function readSnapshotsDirectory(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'snapshots');
}

export function readUpdateStateFilePath(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'update.json');
}

export function readAccountCredentialsDirectory(keyId: string): string {
  const credentialsDirectory = readCredentialsDirectory();
  const pathIdentifier = sanitizePathIdentifier(keyId, 'default');
  return join(credentialsDirectory, pathIdentifier);
}

export function readReleaseTrainFilePath(trainId: string): string {
  const safeTrainId = sanitizePathIdentifier(trainId, 'train');

  const releaseTrainsDirectory = readReleaseTrainsDirectory();
  return join(releaseTrainsDirectory, `${safeTrainId}.json`);
}

export function readSnapshotFilePath(snapshotName: string): string {
  const safeSnapshotName = sanitizePathIdentifier(snapshotName, 'snapshot');

  const snapshotsDirectory = readSnapshotsDirectory();
  return join(snapshotsDirectory, `${safeSnapshotName}.json`);
}

export async function ensureDirectoryExists(directoryPath: string): Promise<string> {
  await mkdir(directoryPath, { recursive: true });

  return directoryPath;
}

export function locateStatsDirectory(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'stats');
}

export function locateAppStatsDirectory(appKey: string): string {
  const isAppKeyValid = /^(ios|android)-[A-Za-z0-9._]+$/.test(appKey);

  if (isAppKeyValid == false) {
    throw new Error(`"${appKey}" is not a valid app key.`);
  }

  const statsDirectory = locateStatsDirectory();

  return join(statsDirectory, appKey);
}

export function locatePortfolioFilePath(): string {
  const launchHomeDirectory = readLaunchHomeDirectory();
  return join(launchHomeDirectory, 'portfolio.json');
}
