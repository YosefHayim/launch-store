// The shape of launch.config.ts, and the check that reads one.

export interface IosApp {
  bundleId: string;
  version: string;
  buildNumber: number;
  scheme: string;
}

export interface AndroidApp {
  packageName: string;
  version: string;
  track: string;
}

export interface LaunchApp {
  name: string;
  projectPath: string;
  ios: IosApp | null;
  android: AndroidApp | null;
}

export interface LaunchFile {
  apps: LaunchApp[];
}

export function defineConfig(launchFile: LaunchFile): LaunchFile {
  return readLaunchFile(launchFile);
}

export function firstLaunchApp(launchFile: LaunchFile): LaunchApp {
  const app = launchFile.apps[0];
  const isMissing = app == null;

  if (isMissing) {
    throw new Error('launch.config.ts needs at least one app.');
  }

  return app;
}

export function readLaunchFile(candidate: unknown): LaunchFile {
  const record = readRecord(candidate, 'launch.config.ts');
  const apps = readApps(record['apps']);

  return { apps };
}

export function printLaunchFile(launchFile: LaunchFile): string {
  const printedApps = launchFile.apps.map(printApp).join(',\n');

  return `import { defineConfig } from 'launch-store';

export default defineConfig({
  apps: [
${printedApps}
  ],
});
`;
}

function printApp(app: LaunchApp): string {
  return `    {
      name: ${JSON.stringify(app.name)},
      projectPath: ${JSON.stringify(app.projectPath)},
      ios: ${printIos(app.ios)},
      android: ${printAndroid(app.android)},
    }`;
}

function printIos(ios: IosApp | null): string {
  const isMissing = ios == null;

  if (isMissing) {
    return 'null';
  }

  return `{ bundleId: ${JSON.stringify(ios.bundleId)}, version: ${JSON.stringify(ios.version)}, buildNumber: ${ios.buildNumber}, scheme: ${JSON.stringify(ios.scheme)} }`;
}

function printAndroid(android: AndroidApp | null): string {
  const isMissing = android == null;

  if (isMissing) {
    return 'null';
  }

  return `{ packageName: ${JSON.stringify(android.packageName)}, version: ${JSON.stringify(android.version)}, track: ${JSON.stringify(android.track)} }`;
}

function readApps(candidate: unknown): LaunchApp[] {
  const isArray = Array.isArray(candidate);

  if (!isArray) {
    throw new Error('launch.config.ts needs an apps array.');
  }

  const isEmpty = candidate.length === 0;

  if (isEmpty) {
    throw new Error('launch.config.ts needs at least one app.');
  }

  return candidate.map(readApp);
}

function readApp(candidate: unknown): LaunchApp {
  const record = readRecord(candidate, 'an app');

  return {
    name: readText(record, 'name'),
    projectPath: readText(record, 'projectPath'),
    ios: readIos(record['ios']),
    android: readAndroid(record['android']),
  };
}

function readIos(candidate: unknown): IosApp | null {
  const isMissing = candidate == null;

  if (isMissing) {
    return null;
  }

  const record = readRecord(candidate, 'ios');

  return {
    bundleId: readText(record, 'bundleId'),
    version: readText(record, 'version'),
    buildNumber: readBuildNumber(record['buildNumber']),
    scheme: readText(record, 'scheme'),
  };
}

function readAndroid(candidate: unknown): AndroidApp | null {
  const isMissing = candidate == null;

  if (isMissing) {
    return null;
  }

  const record = readRecord(candidate, 'android');

  return {
    packageName: readText(record, 'packageName'),
    version: readText(record, 'version'),
    track: readText(record, 'track'),
  };
}

function readBuildNumber(candidate: unknown): number {
  const isNumber = typeof candidate === 'number';

  if (!isNumber) {
    throw new Error('launch.config.ts needs a whole-number ios buildNumber.');
  }

  const isWhole = Number.isInteger(candidate);

  if (!isWhole) {
    throw new Error('launch.config.ts needs a whole-number ios buildNumber.');
  }

  return candidate;
}

function readText(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];
  const isText = typeof field === 'string';

  if (!isText) {
    throw new Error(`launch.config.ts needs a string ${fieldName}.`);
  }

  const isEmpty = field.length === 0;

  if (isEmpty) {
    throw new Error(`launch.config.ts needs a string ${fieldName}.`);
  }

  return field;
}

function readRecord(candidate: unknown, label: string): Record<string, unknown> {
  const isMissing = candidate == null;

  if (isMissing) {
    throw new Error(`${label} in launch.config.ts must be an object.`);
  }

  const isNotObject = typeof candidate !== 'object';

  if (isNotObject) {
    throw new Error(`${label} in launch.config.ts must be an object.`);
  }

  return candidate as Record<string, unknown>;
}
