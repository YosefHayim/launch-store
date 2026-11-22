import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, readResolvedConfig } from '../config/config.ts';
import { hasMessage } from '../services/platform/errorMessage.ts';
import { createLogger } from '../services/platform/logger.ts';
import { pathExists } from '../path-exists.ts';
import { selectApps } from '../store/shared/syncJobs.ts';
import { completeCommand } from '../terminal/commandExit.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { PrivacySurface } from '../types/privacy.ts';
import { surfaceFromExpoConfig, surfaceFromNative } from './parse.ts';
import { buildPrivacyReport, reconcilePrivacy, renderPrivacyReport } from './reconcile.ts';

/** Options accepted by the privacy scan command program. */
type PrivacyCommandOptions = {
  app?: string;
  json?: boolean;
};

/** Loading the app configuration or its resolved Expo surface failed. */
type PrivacyCommandFailure = Readonly<{
  readonly _tag: 'PrivacyCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

/** Directories excluded from bounded privacy manifest discovery. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'Pods', 'build', 'DerivedData', 'dist']);

function commandFailure(operation: string, cause: unknown): PrivacyCommandFailure {
  let message = `${operation} failed.`;

  if (hasMessage(cause)) {
    message = cause.message;
  }

  return {
    _tag: 'PrivacyCommandFailure',
    operation,
    message,
    cause,
  };
}

function isInfoPlist(fileName: string): boolean {
  return fileName == 'Info.plist';
}

function isPrivacyManifest(fileName: string): boolean {
  return fileName.endsWith('.xcprivacy');
}

function isAndroidManifest(fileName: string): boolean {
  return fileName == 'AndroidManifest.xml';
}

/** Find matching source files to a bounded depth while ignoring generated directories. */
async function findFiles(
  rootDirectory: string,
  matchesFileName: (fileName: string) => boolean,
  maximumDepth = 6,
): Promise<string[]> {
  const rootExists = await pathExists(rootDirectory);

  if (rootExists == false) {
    return [];
  }

  async function visitDirectory(directoryPath: string, depth: number): Promise<string[]> {
    const isPastMaximumDepth = depth > maximumDepth;

    if (isPastMaximumDepth) {
      return [];
    }

    let directoryEntries: string[] = [];

    try {
      directoryEntries = await readdir(directoryPath);
    } catch {
      directoryEntries = [];
    }

    const hasNoEntries = directoryEntries.length == 0;

    if (hasNoEntries) {
      return [];
    }

    const matchingPaths: string[] = [];

    for (const directoryEntry of directoryEntries) {
      const isSkippedDirectory = SKIPPED_DIRECTORIES.has(directoryEntry);

      if (isSkippedDirectory) {
        continue;
      }

      const isHidden = directoryEntry.startsWith('.');

      if (isHidden) {
        continue;
      }

      const entryPath = join(directoryPath, directoryEntry);
      let isDirectory = false;
      let isReadable = true;

      try {
        const entryMetadata = await stat(entryPath);
        isDirectory = entryMetadata.isDirectory();
      } catch {
        isReadable = false;
      }

      if (isReadable == false) {
        continue;
      }

      if (isDirectory) {
        const nestedPaths = await visitDirectory(entryPath, depth + 1);
        matchingPaths.push(...nestedPaths);
        continue;
      }

      const isMatch = matchesFileName(directoryEntry);

      if (isMatch) {
        matchingPaths.push(entryPath);
      }
    }

    return matchingPaths;
  }

  return visitDirectory(rootDirectory, 0);
}

/** Read every accessible path, retaining a partial surface when one file is unreadable. */
async function readFiles(filePaths: readonly string[]): Promise<string[]> {
  const fileContents: string[] = [];

  for (const filePath of filePaths) {
    let fileSource: string | null = null;

    try {
      fileSource = await readFile(filePath, 'utf8');
    } catch {
      fileSource = null;
    }

    if (fileSource != null) {
      fileContents.push(fileSource);
    }
  }

  return fileContents;
}

/** Build a privacy surface from native manifests when a prebuilt project exists. */
async function readNativePrivacySurface(appDescriptor: AppDescriptor): Promise<{
  readonly foundNativeFiles: boolean;
  readonly privacySurface: PrivacySurface;
}> {
  const iosDirectory = join(appDescriptor.dir, 'ios');
  const androidDirectory = join(appDescriptor.dir, 'android');
  const infoPlistPaths = await findFiles(iosDirectory, isInfoPlist);
  const privacyManifestPaths = await findFiles(iosDirectory, isPrivacyManifest);
  const androidManifestPaths = await findFiles(androidDirectory, isAndroidManifest);
  const infoPlists = await readFiles(infoPlistPaths);
  const privacyManifests = await readFiles(privacyManifestPaths);
  const androidManifests = await readFiles(androidManifestPaths);
  const hasPrivacyManifest = privacyManifests.length > 0;
  const hasAndroidManifest = androidManifests.length > 0;
  let foundNativeFiles = infoPlists.length > 0;

  if (hasPrivacyManifest) {
    foundNativeFiles = true;
  }

  if (hasAndroidManifest) {
    foundNativeFiles = true;
  }

  return {
    foundNativeFiles,
    privacySurface: surfaceFromNative({ infoPlists, privacyManifests, androidManifests }),
  };
}

/** Inspect native manifests first, falling back to the resolved Expo configuration. */
async function inspectPrivacySurface(appDescriptor: AppDescriptor): Promise<PrivacySurface> {
  const nativeSurface = await readNativePrivacySurface(appDescriptor);

  if (nativeSurface.foundNativeFiles) {
    return nativeSurface.privacySurface;
  }

  const resolvedExpoConfiguration = await readResolvedConfig(appDescriptor.dir);
  const hasNoExpoConfig = resolvedExpoConfiguration == null;

  if (hasNoExpoConfig) {
    return surfaceFromExpoConfig({});
  }

  return surfaceFromExpoConfig(resolvedExpoConfiguration);
}

function appNameFromFinding(appFindingSet: { appName: string }): string {
  return appFindingSet.appName;
}

function findingsFromApp(appFindingSet: {
  findings: ReturnType<typeof reconcilePrivacy>;
}): ReturnType<typeof reconcilePrivacy> {
  return appFindingSet.findings;
}

/** Scan selected apps, reconcile their privacy surfaces, and emit the report. */
export async function privacyCommandProgram(commandOptions: PrivacyCommandOptions): Promise<void> {
  try {
    var loadedConfiguration = await loadConfig();
  } catch (cause) {
    throw commandFailure('load Launch configuration', cause);
  }

  try {
    var selectedApps = await selectApps(loadedConfiguration.apps, commandOptions.app);
  } catch (cause) {
    throw commandFailure('select privacy apps', cause);
  }

  const appFindings = [];

  for (const appDescriptor of selectedApps) {
    const privacySurface = await inspectPrivacySurface(appDescriptor);
    appFindings.push({
      appName: appDescriptor.name,
      findings: reconcilePrivacy(appDescriptor.name, privacySurface),
    });
  }

  const privacyReport = buildPrivacyReport(
    appFindings.flatMap(findingsFromApp),
    appFindings.map(appNameFromFinding),
  );
  let reportText = renderPrivacyReport(privacyReport);
  const isJsonReport = commandOptions.json == true;

  if (isJsonReport) {
    reportText = JSON.stringify(privacyReport, null, 2);
  }

  const logger = createLogger(false);

  try {
    logger.line(reportText);
  } catch (cause) {
    throw commandFailure('write privacy report', cause);
  }

  completeCommand(privacyReport.exitCode);
}
