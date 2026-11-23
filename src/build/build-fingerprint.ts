import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../path-exists.ts';
import { captureCommandOutput } from '../services/platform/exec.ts';
import { ensureDirectoryExists, resolveLaunchHomeDirectory } from '../services/platform/paths.ts';
import type { Platform } from '../types/app.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

/** Native inputs that determine whether an iOS build cache is reusable. */
export type FingerprintParts = Readonly<{
  podfileLock: string;
  podfileProperties: string;
  appConfigSlice: string;
  toolchainVersion: string;
}>;

/** Learned duration and step count for one build kind. */
export type BuildEstimate = Readonly<{
  ms: number;
  steps: number;
}>;

/** Persisted cache state for one app and platform. */
export type BuildState = Readonly<{
  fingerprint: string;
  builtAt: string;
  cleanBuilt: boolean;
  estimates?: Readonly<Record<string, BuildEstimate>>;
}>;

/** Weight assigned to a new duration sample. */
const emaAlpha = 0.5;

/** Fold a completed build into its moving estimate. */
export function updateEstimate(
  previousEstimate: BuildEstimate | undefined,
  sample: BuildEstimate,
  alpha: number = emaAlpha,
): BuildEstimate {
  if (previousEstimate == null) {
    return { ms: Math.round(sample.ms), steps: Math.round(sample.steps) };
  }

  return {
    ms: Math.round(previousEstimate.ms * (1 - alpha) + sample.ms * alpha),
    steps: Math.round(previousEstimate.steps * (1 - alpha) + sample.steps * alpha),
  };
}

/** Read the estimate recorded for one build kind. */
export function estimateFor(
  buildState: BuildState | null,
  buildKind: string,
): BuildEstimate | undefined {
  return buildState?.estimates?.[buildKind];
}

/** Clean or incremental decision for the next build. */
export type CleanDecision = Readonly<{
  clean: boolean;
  nativeChanged: boolean;
  reason: string;
}>;

/** Turn an absent optional config field into the stable JSON null marker. */
function nullableConfigField(configField: unknown): unknown {
  if (configField == null) {
    return null;
  }

  return configField;
}

function readNativeFields(parsedConfig: Record<string, unknown>): Record<string, unknown> | null {
  const hasExpo = Object.hasOwn(parsedConfig, 'expo');

  if (hasExpo == false) {
    return parsedConfig;
  }

  const expoFields = parsedConfig['expo'];

  const expoIsUndefined = typeof expoFields == 'undefined';

  if (expoIsUndefined) {
    return parsedConfig;
  }

  const expoFieldsObject = readPlainObject(expoFields);

  if (expoFieldsObject == null) {
    return null;
  }

  return expoFieldsObject;
}

type NativeSlice = Readonly<{
  plugins: unknown;
  newArchEnabled: unknown;
  iosDeploymentTarget: unknown;
}>;

function readNativeSlice(parsedConfig: Record<string, unknown>): NativeSlice | null {
  const nativeFields = readNativeFields(parsedConfig);

  if (nativeFields == null) {
    return null;
  }

  const hasIos = Object.hasOwn(nativeFields, 'ios');

  if (hasIos == false) {
    return {
      plugins: nativeFields['plugins'],
      newArchEnabled: nativeFields['newArchEnabled'],
      iosDeploymentTarget: undefined,
    };
  }

  const iosFields = nativeFields['ios'];
  const iosFieldsObject = readPlainObject(iosFields);

  if (iosFieldsObject == null) {
    return null;
  }

  return {
    plugins: nativeFields['plugins'],
    newArchEnabled: nativeFields['newArchEnabled'],
    iosDeploymentTarget: iosFieldsObject['deploymentTarget'],
  };
}

function parseConfigText(configText: string): unknown {
  try {
    return JSON.parse(configText);
  } catch (error) {
    const parseFailed = error != null;

    if (parseFailed) {
      return null;
    }

    return null;
  }
}

/** Keep only Expo config fields that change the generated native project. */
export function extractNativeConfigSlice(configText: string): string {
  const parsedConfig = parseConfigText(configText);
  const parsedConfigObject = readPlainObject(parsedConfig);

  if (parsedConfigObject == null) {
    return configText;
  }

  const nativeSlice = readNativeSlice(parsedConfigObject);

  if (nativeSlice == null) {
    return configText;
  }

  const nullableField = nullableConfigField(nativeSlice.plugins);

  return JSON.stringify({
    plugins: nullableField,
    newArchEnabled: nullableConfigField(nativeSlice.newArchEnabled),
    iosDeploymentTarget: nullableConfigField(nativeSlice.iosDeploymentTarget),
  });
}

/** Hash native build inputs in a fixed field order. */
export function computeBuildFingerprint(fingerprintParts: FingerprintParts): string {
  const canonicalFingerprint = [
    `podfile.lock:${fingerprintParts.podfileLock}`,
    `podfile.properties:${fingerprintParts.podfileProperties}`,
    `config:${fingerprintParts.appConfigSlice}`,
    `toolchain:${fingerprintParts.toolchainVersion}`,
  ].join('\n\u0000\n');

  return createHash('sha256').update(canonicalFingerprint).digest('hex');
}

/** Decide whether the next build can reuse native caches. */
export function resolveClean(
  forceClean: boolean,
  storedBuild: BuildState | null,
  currentFingerprint: string,
): CleanDecision {
  const storedFingerprint = storedBuild?.fingerprint;
  const nativeChanged = storedFingerprint != currentFingerprint;

  const isForced = forceClean == true;

  if (isForced) {
    let reason = 'clean forced (--clean)';

    if (nativeChanged) {
      reason = 'clean forced (--clean); native deps also changed';
    }

    return { clean: true, nativeChanged, reason };
  }

  if (nativeChanged) {
    let reason = 'first build on this host';

    if (storedBuild != null) {
      reason = 'native deps changed (Podfile.lock)';
    }

    return { clean: true, nativeChanged, reason };
  }

  return { clean: false, nativeChanged, reason: 'cache warm - incremental' };
}

function buildStateDirectory(directoryOverride: string | undefined): string {
  if (directoryOverride != null) {
    return directoryOverride;
  }

  const launchHomeDirectory = resolveLaunchHomeDirectory();

  return join(launchHomeDirectory, 'build-state');
}

function buildStatePath(appName: string, platform: Platform, directoryOverride?: string): string {
  const directoryPath = buildStateDirectory(directoryOverride);

  return join(directoryPath, `${appName}-${platform}.json`);
}

function isBuildEstimate(candidate: unknown): candidate is BuildEstimate {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return false;
  }

  const durationIsNumber = typeof candidateObject['ms'] == 'number';

  if (durationIsNumber == false) {
    return false;
  }

  return typeof candidateObject['steps'] == 'number';
}

function decodeEstimates(candidate: unknown): Readonly<Record<string, BuildEstimate>> | null {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return null;
  }

  const estimates: Record<string, BuildEstimate> = {};

  for (const estimateKey of Object.keys(candidateObject)) {
    const estimate = candidateObject[estimateKey];
    const isEstimate = isBuildEstimate(estimate);

    if (isEstimate == false) {
      return null;
    }

    estimates[estimateKey] = { ms: estimate.ms, steps: estimate.steps };
  }

  return estimates;
}

function decodeBuildState(parsedState: unknown): BuildState | null {
  const parsedStateObject = readPlainObject(parsedState);

  if (parsedStateObject == null) {
    return null;
  }

  const fingerprint = parsedStateObject['fingerprint'];
  const fingerprintIsString = typeof fingerprint == 'string';

  if (fingerprintIsString == false) {
    return null;
  }

  const builtAt = parsedStateObject['builtAt'];
  const builtAtIsString = typeof builtAt == 'string';

  if (builtAtIsString == false) {
    return null;
  }

  const cleanBuilt = parsedStateObject['cleanBuilt'];
  const cleanIsBoolean = typeof cleanBuilt == 'boolean';

  if (cleanIsBoolean == false) {
    return null;
  }

  const hasEstimates = Object.hasOwn(parsedStateObject, 'estimates');

  if (hasEstimates == false) {
    return { fingerprint, builtAt, cleanBuilt };
  }

  const estimates = decodeEstimates(parsedStateObject['estimates']);

  if (estimates == null) {
    return null;
  }

  return { fingerprint, builtAt, cleanBuilt, estimates };
}

/** Load a stored build state, treating absent or malformed files as a cold cache. */
export async function readBuildState(
  appName: string,
  platform: Platform,
  directoryOverride?: string,
): Promise<BuildState | null> {
  const filePath = buildStatePath(appName, platform, directoryOverride);

  try {
    const fileExists = await pathExists(filePath);

    if (fileExists == false) {
      return null;
    }

    const stateText = await readFile(filePath, 'utf8');
    const parsedState: unknown = JSON.parse(stateText);

    return decodeBuildState(parsedState);
  } catch (error) {
    const readFailed = error != null;

    if (readFailed) {
      return null;
    }

    return null;
  }
}

/** Persist the build state used by the next cache decision. */
export async function writeBuildState(
  appName: string,
  platform: Platform,
  buildState: BuildState,
  directoryOverride?: string,
): Promise<void> {
  const directoryPath = buildStateDirectory(directoryOverride);
  const filePath = buildStatePath(appName, platform, directoryOverride);

  await ensureDirectoryExists(directoryPath);

  const serialized = JSON.stringify(buildState, null, 2);

  await writeFile(filePath, serialized);
}

async function readFingerprintInput(filePath: string): Promise<string> {
  try {
    const fileExists = await pathExists(filePath);

    if (fileExists == false) {
      return '';
    }

    return await readFile(filePath, 'utf8');
  } catch (error) {
    const readFailed = error != null;

    if (readFailed) {
      return '';
    }

    return '';
  }
}

/** Read and hash the iOS native dependency graph. */
export async function gatherIosFingerprint(
  iosDirectory: string,
  configPath: string,
): Promise<string> {
  const podfilePath = join(iosDirectory, 'Podfile.lock');
  const podfileLock = await readFingerprintInput(podfilePath);
  const joinedPath = join(iosDirectory, 'Podfile.properties.json');
  const podfileProperties = await readFingerprintInput(joinedPath);
  const appConfigText = await readFingerprintInput(configPath);
  let toolchainVersion = '';

  try {
    toolchainVersion = await captureCommandOutput('xcodebuild', ['-version']);
  } catch (error) {
    const commandFailed = error != null;

    if (commandFailed) {
      toolchainVersion = '';
    }
  }

  const appConfigSlice = extractNativeConfigSlice(appConfigText);

  return computeBuildFingerprint({
    podfileLock,
    podfileProperties,
    appConfigSlice,
    toolchainVersion,
  });
}
