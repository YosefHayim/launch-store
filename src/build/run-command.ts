// Installs a stored iOS or Android binary onto a connected phone.

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config/config.ts';
import { resolveStorageProvider } from '../distribution/storage.ts';
import { pathExists } from '../path-exists.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { executeCommand } from '../services/platform/execute-command.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import type { BuildArtifact } from '../types/artifacts.ts';
import { findBuild } from './build-history-command.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

type RunCommandInput = Readonly<{
  reference: string;
  device?: string;
}>;

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const hasKey = Object.hasOwn(record, key);

  if (hasKey == false) {
    return null;
  }

  const field = record[key];

  if (field == null) {
    return null;
  }

  const isString = typeof field == 'string';

  if (isString == false) {
    throw new Error(`Run command ${key} must be a string.`);
  }

  return field;
}

function decodeRunCommandInput(rawCommandInput: unknown): RunCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Run command input must be an object.');
  }

  const reference = rawCommandInputObject['reference'];
  const referenceIsString = typeof reference == 'string';

  if (referenceIsString == false) {
    throw new Error('Run command reference must be a string.');
  }

  const device = readOptionalString(rawCommandInputObject, 'device');

  if (device == null) {
    return { reference };
  }

  return { reference, device };
}

/** Build the `adb install` arguments for an optional device serial. */
export function adbInstallArgs(apkPath: string, serial: string | undefined = undefined): string[] {
  const commandArguments = ['install', '-r', apkPath];

  const isMissingSerial = serial == null;

  if (isMissingSerial) {
    return commandArguments;
  }

  return ['-s', serial, ...commandArguments];
}

/** Build the `bundletool build-apks` arguments for a universal APK set. */
export function bundletoolBuildApksArgs(aabPath: string, apksPath: string): string[] {
  return [
    'build-apks',
    `--bundle=${aabPath}`,
    `--output=${apksPath}`,
    '--mode=universal',
    '--overwrite',
  ];
}

/** Build the `bundletool install-apks` arguments for an optional device serial. */
export function bundletoolInstallApksArgs(
  apksPath: string,
  serial: string | undefined = undefined,
): string[] {
  const commandArguments = ['install-apks', `--apks=${apksPath}`];

  const isMissingSerial = serial == null;

  if (isMissingSerial) {
    return commandArguments;
  }

  return [...commandArguments, `--device-id=${serial}`];
}

/** Build the `xcrun devicectl` arguments for an optional Apple device identifier. */
export function devicectlInstallArgs(
  appPath: string,
  device: string | undefined = undefined,
): string[] {
  const commandArguments = ['devicectl', 'device', 'install', 'app'];

  const isMissingDevice = device == null;

  if (isMissingDevice) {
    return [...commandArguments, appPath];
  }

  return [...commandArguments, '--device', device, appPath];
}

function isApplicationBundle(fileName: string): boolean {
  return fileName.endsWith('.app');
}

async function removeTemporaryDirectory(temporaryDirectory: string): Promise<void> {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

/** Install an APK directly or turn an AAB into a universal APK set first. */
async function installAndroidArtifact(
  artifactPath: string,
  serial: string | undefined,
): Promise<void> {
  const isApk = artifactPath.endsWith('.apk');

  if (isApk) {
    const adbInstall = adbInstallArgs(artifactPath, serial);
    await executeCommand('adb', adbInstall);
    return;
  }

  const systemTemporaryDirectory = tmpdir();
  const launchRunPath = join(systemTemporaryDirectory, 'launch-run-');
  const temporaryDirectory = await mkdtemp(launchRunPath);

  try {
    const apksPath = join(temporaryDirectory, 'app.apks');

    const bundletoolBuildApks = bundletoolBuildApksArgs(artifactPath, apksPath);

    await executeCommand('bundletool', bundletoolBuildApks);

    const bundletoolInstallApks = bundletoolInstallApksArgs(apksPath, serial);

    await executeCommand('bundletool', bundletoolInstallApks);
  } finally {
    await removeTemporaryDirectory(temporaryDirectory);
  }
}

/** Unpack an IPA and install its application bundle with `devicectl`. */
async function installAppleArtifact(
  artifactPath: string,
  device: string | undefined,
): Promise<void> {
  const systemTemporaryDirectory = tmpdir();
  const launchRunPath = join(systemTemporaryDirectory, 'launch-run-');
  const temporaryDirectory = await mkdtemp(launchRunPath);

  try {
    await executeCommand('unzip', ['-oq', artifactPath, '-d', temporaryDirectory]);

    const applicationDirectory = join(temporaryDirectory, 'Payload');
    const applicationNames = await readdir(applicationDirectory);
    const applicationName = applicationNames.find(isApplicationBundle);

    if (applicationName == null) {
      throw new Error(`No .app exists inside ${artifactPath}.`);
    }

    const logger = createLogger(false);

    const isMissingDevice = device == null;

    if (isMissingDevice) {
      logger.warn('No --device was provided; devicectl will choose a connected device.');
    }

    const applicationPath = join(applicationDirectory, applicationName);

    const devicectlInstall = devicectlInstallArgs(applicationPath, device);

    await executeCommand('xcrun', devicectlInstall);
  } finally {
    await removeTemporaryDirectory(temporaryDirectory);
  }
}

/** Find the requested stored artifact and verify its file still exists. */
async function findRunnableArtifact(reference: string): Promise<BuildArtifact> {
  const launchPaths = readLaunchDirectories();
  const loadedLaunch = await loadConfig(launchPaths.workingDirectory);
  const storageProvider = await resolveStorageProvider(
    loadedLaunch.config,
    launchPaths.workingDirectory,
  );
  const storedArtifacts = await storageProvider.list();
  const artifact = findBuild(storedArtifacts, reference);

  if (artifact == null) {
    throw new Error(`No build matches "${reference}". Run \`launch-store builds list\` first.`);
  }

  const artifactExists = await pathExists(artifact.path);

  if (artifactExists) {
    return artifact;
  }

  throw new Error(`The artifact for "${reference}" is gone from ${artifact.path}. Rebuild it.`);
}

/** Decode one `launch-store run` request and install its stored artifact. */
export async function runCommandProgram(commandInput: unknown): Promise<void> {
  try {
    const decodedCommand = decodeRunCommandInput(commandInput);
    const artifact = await findRunnableArtifact(decodedCommand.reference);
    const logger = createLogger(false);

    logger.run(
      `Installing ${artifact.appName} ${artifact.version} (build ${artifact.buildNumber}).`,
    );

    const isAndroid = artifact.platform == 'android';

    if (isAndroid) {
      await installAndroidArtifact(artifact.path, decodedCommand.device);
    } else {
      await installAppleArtifact(artifact.path, decodedCommand.device);
    }

    logger.ok("Installed. Launch it from the device's home screen.");
  } catch (error) {
    const isAlreadyError = error instanceof Error;

    if (isAlreadyError) {
      throw error;
    }

    const failureMessage = errorMessage(error);

    throw new Error(failureMessage, { cause: error });
  }
}
