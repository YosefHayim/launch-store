// Finds and loads the Launch config, and can write an app version or entitlements back into it.

import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { importTypeScriptModule } from './import-typescript-module.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { LaunchConfig, LaunchConfigInput } from '../types/config.ts';
import {
  DEFAULT_BUILD_ENGINE,
  DEFAULT_CREDENTIALS_PROVIDER,
  DEFAULT_STORAGE_PROVIDER,
  DEFAULT_SUBMITTER,
} from '../types/config.ts';
import type { MutableDeep } from '../types/mutable.ts';

/** Absolute path to this package's public entry */
const SELF_ENTRY = fileURLToPath(new URL('../index.js', import.meta.url));

export type { LaunchConfigInput };
export { defineConfig } from '../define-launch-file.ts';

async function entryExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath);

    return true;
  } catch (error) {
    const isMissing = error != null;

    if (isMissing) {
      return false;
    }

    return false;
  }
}

/** Resolve a section declared on `launch.config.ts` or in a `*.config.json` sidecar. */
export async function resolveSidecarConfig<Section>(sidecarRequest: {
  typed: NoInfer<Section> | undefined;
  configPath: string;
  explicitPath: boolean;
  load: (path: string) => Promise<Section>;
}): Promise<Section | undefined> {
  if (sidecarRequest.explicitPath) {
    return sidecarRequest.load(sidecarRequest.configPath);
  }

  if (sidecarRequest.typed != null) {
    return sidecarRequest.typed;
  }

  const sidecarExists = await entryExists(sidecarRequest.configPath);

  if (sidecarExists) {
    return sidecarRequest.load(sidecarRequest.configPath);
  }

  return undefined;
}

export type LoadedConfig = Readonly<{
  config: LaunchConfig;
  apps: AppDescriptor[];
}>;

const skipDirs = new Set(['node_modules', '.git', 'ios', 'android', 'dist', '.expo', '.launch']);

type FoundConfig = Readonly<{
  path: string;
  config: LaunchConfig;
}>;

type AppConfigDocument = Readonly<{
  rawConfig: Record<string, unknown>;
  path: string;
}>;

type ConfigLoadFailure = Readonly<{
  _tag: 'ConfigLoadFailure';
  path: string;
  message: string;
  cause?: unknown;
}>;

function makeConfigLoadFailure(fields: {
  path: string;
  message: string;
  cause?: unknown;
}): ConfigLoadFailure {
  return { _tag: 'ConfigLoadFailure', ...fields };
}

export async function findLaunchConfig(requestedDirectory?: string): Promise<FoundConfig | null> {
  let workingDirectory = readLaunchDirectories().workingDirectory;

  if (requestedDirectory != null) {
    workingDirectory = requestedDirectory;
  }

  for (const fileName of ['launch.config.ts', 'launch.config.mjs', 'launch.config.js']) {
    const configPath = join(workingDirectory, fileName);
    const configExists = await entryExists(configPath);

    if (configExists == false) {
      continue;
    }

    let loaded: { default?: LaunchConfig };

    try {
      loaded = await importTypeScriptModule<{ default?: LaunchConfig }>(configPath, SELF_ENTRY);
    } catch (cause) {
      throw makeConfigLoadFailure({
        path: configPath,
        message: `Could not load ${fileName}.`,
        cause,
      });
    }

    if (loaded.default == null) {
      throw makeConfigLoadFailure({
        path: configPath,
        message: `${fileName} must \`export default defineConfig({ ... })\`.`,
      });
    }

    return { path: configPath, config: loaded.default };
  }

  return null;
}

async function readLaunchConfig(root: string): Promise<LaunchConfig> {
  const foundConfig = await findLaunchConfig(root);

  if (foundConfig == null) {
    return {
      credentials: DEFAULT_CREDENTIALS_PROVIDER,
      storage: DEFAULT_STORAGE_PROVIDER,
      buildEngine: DEFAULT_BUILD_ENGINE,
      submit: DEFAULT_SUBMITTER,
      profiles: { production: { name: 'production', sizeBudgetMB: 200 } },
    };
  }

  return foundConfig.config;
}

const staticConfigs = ['app.config.json', 'app.json'] as const;
const dynamicConfigs = ['app.config.ts', 'app.config.js', 'app.config.mjs'] as const;

function decodedRecordOrNull(candidateValue: unknown): Record<string, unknown> | null {
  if (candidateValue == null) {
    return null;
  }

  if (typeof candidateValue != 'object') {
    return null;
  }

  if (Array.isArray(candidateValue)) {
    return null;
  }

  return candidateValue as Record<string, unknown>;
}

function readStringField(record: Record<string, unknown> | null, fieldName: string): string | null {
  if (record == null) {
    return null;
  }

  const field = record[fieldName];

  if (typeof field == 'string') {
    return field;
  }

  return null;
}

function readBooleanField(
  record: Record<string, unknown> | null,
  fieldName: string,
): boolean | null {
  if (record == null) {
    return null;
  }

  const field = record[fieldName];

  if (typeof field == 'boolean') {
    return field;
  }

  return null;
}

function readNumberField(record: Record<string, unknown> | null, fieldName: string): number | null {
  if (record == null) {
    return null;
  }

  const field = record[fieldName];

  if (typeof field == 'number') {
    return field;
  }

  return null;
}

function readNestedRecord(
  record: Record<string, unknown> | null,
  fieldName: string,
): Record<string, unknown> | null {
  if (record == null) {
    return null;
  }

  return decodedRecordOrNull(record[fieldName]);
}

function readAppHandle(expoConfig: Record<string, unknown>): string | null {
  const slug = readStringField(expoConfig, 'slug');

  if (slug != null) {
    return slug;
  }

  return readStringField(expoConfig, 'name');
}

function readExtensionIds(ios: Record<string, unknown> | null): string[] | null {
  if (ios == null) {
    return null;
  }

  const extensions = ios['extensions'];

  if (Array.isArray(extensions) == false) {
    return null;
  }

  const extensionIds = extensions.filter(isNonEmptyExtensionId);

  if (extensionIds.length == 0) {
    return null;
  }

  return extensionIds;
}

function isNonEmptyExtensionId(extensionId: unknown): extensionId is string {
  if (typeof extensionId != 'string') {
    return false;
  }

  return extensionId.length > 0;
}

function appDescriptorFromConfig(
  rawConfig: Record<string, unknown>,
  appDirectory: string,
  configPath: string,
): AppDescriptor | null {
  let expoConfig = decodedRecordOrNull(rawConfig['expo']);

  if (expoConfig == null) {
    expoConfig = rawConfig;
  }

  const appHandle = readAppHandle(expoConfig);

  if (appHandle == null) {
    return null;
  }

  const descriptor: MutableDeep<AppDescriptor> = {
    name: appHandle.toLowerCase(),
    dir: appDirectory,
    configPath,
  };
  const ios = decodedRecordOrNull(expoConfig['ios']);
  const bundleId = readStringField(ios, 'bundleIdentifier');

  if (bundleId != null) {
    descriptor.bundleId = bundleId;
  }

  const entitlements = readNestedRecord(ios, 'entitlements');

  if (entitlements != null) {
    descriptor.iosEntitlements = entitlements;
  }

  const extensionIds = readExtensionIds(ios);

  if (extensionIds != null) {
    descriptor.iosExtensions = extensionIds;
  }

  const iosConfig = readNestedRecord(ios, 'config');
  const usesNonExemptEncryption = readBooleanField(iosConfig, 'usesNonExemptEncryption');

  if (usesNonExemptEncryption != null) {
    descriptor.usesNonExemptEncryption = usesNonExemptEncryption;
  }

  const android = decodedRecordOrNull(expoConfig['android']);
  const packageName = readStringField(android, 'package');

  if (packageName != null) {
    descriptor.packageName = packageName;
  }

  const androidVersionCode = readNumberField(android, 'versionCode');

  if (androidVersionCode != null) {
    descriptor.androidVersionCode = androidVersionCode;
  }

  const version = readStringField(expoConfig, 'version');

  if (version != null) {
    descriptor.version = version;
  }

  return descriptor;
}

async function readJsonRecord(configPath: string): Promise<Record<string, unknown> | null> {
  try {
    const configText = await readFile(configPath, 'utf8');
    const parsedConfig: unknown = JSON.parse(configText);

    return decodedRecordOrNull(parsedConfig);
  } catch (error) {
    const isUnreadable = error != null;

    if (isUnreadable) {
      return null;
    }

    return null;
  }
}

async function readStaticConfig(appDirectory: string): Promise<AppConfigDocument | null> {
  for (const fileName of staticConfigs) {
    const configPath = join(appDirectory, fileName);
    const configExists = await entryExists(configPath);

    if (configExists == false) {
      continue;
    }

    const decodedConfig = await readJsonRecord(configPath);

    if (decodedConfig != null) {
      return { rawConfig: decodedConfig, path: configPath };
    }
  }

  return null;
}

async function readDynamicConfig(
  appDirectory: string,
  staticConfig: Record<string, unknown>,
): Promise<AppConfigDocument | null> {
  for (const fileName of dynamicConfigs) {
    const configPath = join(appDirectory, fileName);
    const configExists = await entryExists(configPath);

    if (configExists == false) {
      continue;
    }

    let loaded: { default?: unknown };

    try {
      loaded = await importTypeScriptModule(configPath, SELF_ENTRY);
    } catch (error) {
      const failedToImport = error != null;

      if (failedToImport) {
        continue;
      }

      continue;
    }

    const exportedConfig = loaded.default;

    if (exportedConfig == null) {
      continue;
    }

    let evaluatedConfig: unknown = exportedConfig;

    if (typeof exportedConfig == 'function') {
      const evaluateConfig = exportedConfig as (request: {
        config: Record<string, unknown>;
      }) => unknown;

      try {
        const evaluate = evaluateConfig({ config: staticConfig });
        evaluatedConfig = await Promise.resolve(evaluate);
      } catch (error) {
        const failedToEvaluate = error != null;

        if (failedToEvaluate) {
          continue;
        }

        continue;
      }
    }

    const rawConfig = decodedRecordOrNull(evaluatedConfig);

    if (rawConfig != null) {
      return { rawConfig, path: configPath };
    }
  }

  return null;
}

async function loadAppConfigDocument(appDirectory: string): Promise<AppConfigDocument | null> {
  const staticConfig = await readStaticConfig(appDirectory);
  let staticConfigDocument: Record<string, unknown> = {};

  if (staticConfig != null) {
    staticConfigDocument = staticConfig.rawConfig;
  }

  const dynamicConfig = await readDynamicConfig(appDirectory, staticConfigDocument);

  if (dynamicConfig != null) {
    return dynamicConfig;
  }

  return staticConfig;
}

async function readAppAt(appDirectory: string): Promise<AppDescriptor | null> {
  const chosenConfig = await loadAppConfigDocument(appDirectory);

  if (chosenConfig == null) {
    return null;
  }

  return appDescriptorFromConfig(chosenConfig.rawConfig, appDirectory, chosenConfig.path);
}

export async function readResolvedConfig(
  appDirectory: string,
): Promise<Record<string, unknown> | null> {
  const appConfigDocument = await loadAppConfigDocument(appDirectory);

  if (appConfigDocument == null) {
    return null;
  }

  return appConfigDocument.rawConfig;
}

async function listDirectoryNames(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    const isUnreadable = error != null;

    if (isUnreadable) {
      return [];
    }

    return [];
  }
}

async function directoryIsFolder(directory: string): Promise<boolean> {
  try {
    const directoryStatus = await stat(directory);

    return directoryStatus.isDirectory();
  } catch (error) {
    const isUnreadable = error != null;

    if (isUnreadable) {
      return false;
    }

    return false;
  }
}

async function discoverApps(root: string, maxDepth = 4): Promise<AppDescriptor[]> {
  const discoveredApps: AppDescriptor[] = [];

  async function walk(directory: string, depth: number): Promise<void> {
    const isPastMaxDepth = depth > maxDepth;

    if (isPastMaxDepth) {
      return;
    }

    const directoryEntries = await listDirectoryNames(directory);
    const appDescriptor = await readAppAt(directory);

    if (appDescriptor != null) {
      discoveredApps.push(appDescriptor);
    }

    for (const entryName of directoryEntries) {
      const isSkipped = skipDirs.has(entryName);

      if (isSkipped) {
        continue;
      }

      const isHidden = entryName.startsWith('.');

      if (isHidden) {
        continue;
      }

      const childPath = join(directory, entryName);

      const childIsDirectory = await directoryIsFolder(childPath);

      if (childIsDirectory) {
        await walk(childPath, depth + 1);
      }
    }
  }

  await walk(root, 0);

  return discoveredApps;
}

async function readStaticAppJson(configPath: string): Promise<Record<string, unknown> | null> {
  const isJson = configPath.endsWith('.json');

  if (isJson == false) {
    return null;
  }

  return readJsonRecord(configPath);
}

async function writeStaticAppJson(
  configPath: string,
  rawConfig: Record<string, unknown>,
): Promise<void> {
  const serialized = JSON.stringify(rawConfig, null, 2);
  await writeFile(configPath, `${serialized}\n`);
}

export async function writeAppVersion(app: AppDescriptor, version: string): Promise<boolean> {
  const rawConfig = await readStaticAppJson(app.configPath);

  if (rawConfig == null) {
    return false;
  }

  const expoConfig = decodedRecordOrNull(rawConfig['expo']);

  if (expoConfig != null) {
    rawConfig['expo'] = { ...expoConfig, version };

    await writeStaticAppJson(app.configPath, rawConfig);

    return true;
  }

  rawConfig['version'] = version;

  await writeStaticAppJson(app.configPath, rawConfig);

  return true;
}

export async function writeAppEntitlements(
  app: AppDescriptor,
  entitlements: Record<string, unknown>,
): Promise<string[]> {
  const rawConfig = await readStaticAppJson(app.configPath);

  if (rawConfig == null) {
    return [];
  }

  const decodedExpo = decodedRecordOrNull(rawConfig['expo']);
  let expoConfig = rawConfig;

  if (decodedExpo != null) {
    expoConfig = decodedExpo;
  }

  let iosConfig = decodedRecordOrNull(expoConfig['ios']);

  if (iosConfig == null) {
    iosConfig = {};
  }

  let currentEntitlements = decodedRecordOrNull(iosConfig['entitlements']);

  if (currentEntitlements == null) {
    currentEntitlements = {};
  }

  const addedKeys: string[] = [];

  for (const [entitlementKey, entitlementValue] of Object.entries(entitlements)) {
    const alreadyPresent = entitlementKey in currentEntitlements;

    if (alreadyPresent) {
      continue;
    }

    currentEntitlements[entitlementKey] = entitlementValue;
    addedKeys.push(entitlementKey);
  }

  const nothingAdded = addedKeys.length == 0;

  if (nothingAdded) {
    return [];
  }

  iosConfig['entitlements'] = currentEntitlements;
  expoConfig['ios'] = iosConfig;

  if (decodedExpo != null) {
    rawConfig['expo'] = expoConfig;
  }

  await writeStaticAppJson(app.configPath, rawConfig);

  return addedKeys;
}

export async function loadConfig(requestedDirectory?: string): Promise<LoadedConfig> {
  let workingDirectory = readLaunchDirectories().workingDirectory;

  if (requestedDirectory != null) {
    workingDirectory = requestedDirectory;
  }

  const config = await readLaunchConfig(workingDirectory);
  let configuredRoots = config.appRoots;

  if (configuredRoots == null) {
    configuredRoots = [workingDirectory];
  }

  function resolveRoot(appRoot: string): string {
    return resolve(workingDirectory, appRoot);
  }

  const resolvedRoots = configuredRoots.map(resolveRoot);

  function discoverRoot(appRoot: string): Promise<AppDescriptor[]> {
    return discoverApps(appRoot);
  }

  const discoveredAppGroups = await Promise.all(resolvedRoots.map(discoverRoot));
  const apps = discoveredAppGroups.flat();

  return { config, apps };
}
