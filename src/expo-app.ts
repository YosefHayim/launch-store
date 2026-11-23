import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ExpoApp {
  name: string | null;
  bundleId: string | null;
  packageName: string | null;
  version: string | null;
  buildNumber: number | null;
}

interface ExpoDocument {
  expo?: {
    name?: string;
    version?: string;
    ios?: { bundleIdentifier?: string; buildNumber?: string };
    android?: { package?: string; versionCode?: number };
  };
}

export async function readExpoApp(directory: string): Promise<ExpoApp> {
  const appPath = join(directory, 'app.json');

  try {
    var appText = await readFile(appPath, 'utf8');
  } catch (error) {
    throw new Error('No app.json in this directory', { cause: error });
  }

  try {
    var appDocument = JSON.parse(appText) as ExpoDocument;
  } catch (error) {
    throw new Error('app.json is not JSON', { cause: error });
  }

  const expo = appDocument.expo;

  const isMissingExpo = expo == null;

  if (isMissingExpo) {
    throw new Error('app.json has no expo block');
  }

  const parsedBuildNumber = Number(expo.ios?.buildNumber);
  const hasBuildNumber = Number.isFinite(parsedBuildNumber);
  let buildNumber: number | null = null;

  if (hasBuildNumber) {
    buildNumber = parsedBuildNumber;
  }
  const versionCode = expo.android?.versionCode ?? null;

  return {
    name: expo.name ?? null,
    bundleId: expo.ios?.bundleIdentifier ?? null,
    packageName: expo.android?.package ?? null,
    version: expo.version ?? null,
    buildNumber: buildNumber ?? versionCode,
  };
}
