import { FileSystem, Path } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { createHash } from 'node:crypto';
import { Effect, Option, Schema } from 'effect';
import { captureCommandOutput, provideNodeCommandServices } from '../services/exec.js';
import { resolveLaunchHomeDirectory, type LaunchPathsService } from '../services/paths.js';
import type { Platform } from '../types/app.js';

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

const BuildEstimateSchema = Schema.Struct({
  ms: Schema.Number,
  steps: Schema.Number,
});

const BuildStateSchema: Schema.Schema<BuildState> = Schema.Struct({
  fingerprint: Schema.String,
  builtAt: Schema.String,
  cleanBuilt: Schema.Boolean,
  estimates: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: BuildEstimateSchema }),
    { exact: true },
  ),
});

const NativeConfigFieldsSchema = Schema.Struct({
  plugins: Schema.optionalWith(Schema.Unknown, { exact: true }),
  newArchEnabled: Schema.optionalWith(Schema.Unknown, { exact: true }),
  ios: Schema.optionalWith(
    Schema.Struct({
      deploymentTarget: Schema.optionalWith(Schema.Unknown, { exact: true }),
    }),
    { exact: true },
  ),
});

const AppConfigSchema = Schema.Struct({
  expo: Schema.optionalWith(NativeConfigFieldsSchema, { exact: true }),
  plugins: Schema.optionalWith(Schema.Unknown, { exact: true }),
  newArchEnabled: Schema.optionalWith(Schema.Unknown, { exact: true }),
  ios: Schema.optionalWith(
    Schema.Struct({
      deploymentTarget: Schema.optionalWith(Schema.Unknown, { exact: true }),
    }),
    { exact: true },
  ),
});

type BuildStateRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

/** Weight assigned to a new duration sample. */
const EMA_ALPHA = 0.5;

/** Fold a completed build into its moving estimate. */
export const updateEstimate = (
  previousEstimate: BuildEstimate | undefined,
  sample: BuildEstimate,
  alpha: number = EMA_ALPHA,
): BuildEstimate => {
  if (previousEstimate === undefined) {
    return { ms: Math.round(sample.ms), steps: Math.round(sample.steps) };
  }
  return {
    ms: Math.round(previousEstimate.ms * (1 - alpha) + sample.ms * alpha),
    steps: Math.round(previousEstimate.steps * (1 - alpha) + sample.steps * alpha),
  };
};

/** Read the estimate recorded for one build kind. */
export const estimateFor = (
  buildState: BuildState | null,
  buildKind: string,
): BuildEstimate | undefined => buildState?.estimates?.[buildKind];

/** Clean or incremental decision for the next build. */
export type CleanDecision = Readonly<{
  clean: boolean;
  nativeChanged: boolean;
  reason: string;
}>;

/** Turn an absent optional config field into the stable JSON null marker. */
const nullableConfigField = (configField: unknown): unknown => {
  if (configField === undefined) return null;
  if (configField === null) return null;
  return configField;
};

/** Keep only Expo config fields that change the generated native project. */
export const extractNativeConfigSlice = (configText: string): string => {
  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(configText);
  } catch {
    return configText;
  }
  const decodedConfig = Option.getOrUndefined(
    Schema.decodeUnknownOption(AppConfigSchema)(parsedConfig),
  );
  if (decodedConfig === undefined) return configText;
  let nativeFields = decodedConfig;
  if (decodedConfig.expo !== undefined) nativeFields = decodedConfig.expo;
  let deploymentTarget: unknown;
  if (nativeFields.ios !== undefined) deploymentTarget = nativeFields.ios.deploymentTarget;
  return JSON.stringify({
    plugins: nullableConfigField(nativeFields.plugins),
    newArchEnabled: nullableConfigField(nativeFields.newArchEnabled),
    iosDeploymentTarget: nullableConfigField(deploymentTarget),
  });
};

/** Hash native build inputs in a fixed field order. */
export const computeBuildFingerprint = (fingerprintParts: FingerprintParts): string => {
  const canonicalFingerprint = [
    `podfile.lock:${fingerprintParts.podfileLock}`,
    `podfile.properties:${fingerprintParts.podfileProperties}`,
    `config:${fingerprintParts.appConfigSlice}`,
    `toolchain:${fingerprintParts.toolchainVersion}`,
  ].join('\n\u0000\n');
  return createHash('sha256').update(canonicalFingerprint).digest('hex');
};

/** Decide whether the next build can reuse native caches. */
export const resolveClean = (
  forceClean: boolean,
  storedBuild: BuildState | null,
  currentFingerprint: string,
): CleanDecision => {
  const nativeChanged = storedBuild?.fingerprint !== currentFingerprint;
  if (forceClean) {
    let reason = 'clean forced (--clean)';
    if (nativeChanged) reason = 'clean forced (--clean); native deps also changed';
    return { clean: true, nativeChanged, reason };
  }
  if (nativeChanged) {
    let reason = 'first build on this host';
    if (storedBuild !== null) reason = 'native deps changed (Podfile.lock)';
    return { clean: true, nativeChanged, reason };
  }
  return { clean: false, nativeChanged, reason: 'cache warm - incremental' };
};

/** Resolve the build-state directory or a test override. */
const buildStateDirectory = (
  directoryOverride: string | undefined,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> => {
  if (directoryOverride !== undefined) return Effect.succeed(directoryOverride);
  return Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveLaunchHomeDirectory(), 'build-state');
  });
};

/** Resolve the state file for one app and platform. */
const buildStatePath = (
  appName: string,
  platform: Platform,
  directoryOverride?: string,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const directoryPath = yield* buildStateDirectory(directoryOverride);
    return pathService.join(directoryPath, `${appName}-${platform}.json`);
  });

/** Load a stored build state, treating absent or malformed files as a cold cache. */
export const readBuildState = (
  appName: string,
  platform: Platform,
  directoryOverride?: string,
): Effect.Effect<BuildState | null, never, BuildStateRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const filePath = yield* buildStatePath(appName, platform, directoryOverride);
    const fileExists = yield* fileSystem.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!fileExists) return null;
    return yield* fileSystem.readFileString(filePath).pipe(
      Effect.flatMap((stateText) =>
        Effect.try({
          try: (): unknown => JSON.parse(stateText),
          catch: () => null,
        }),
      ),
      Effect.map((parsedState) => {
        if (parsedState === null) return null;
        return Option.getOrNull(Schema.decodeUnknownOption(BuildStateSchema)(parsedState));
      }),
      Effect.orElseSucceed(() => null),
    );
  });

/** Persist the build state used by the next cache decision. */
export const writeBuildState = (
  appName: string,
  platform: Platform,
  buildState: BuildState,
  directoryOverride?: string,
): Effect.Effect<void, PlatformError, BuildStateRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directoryPath = yield* buildStateDirectory(directoryOverride);
    const filePath = yield* buildStatePath(appName, platform, directoryOverride);
    yield* fileSystem.makeDirectory(directoryPath, { recursive: true });
    yield* fileSystem.writeFileString(filePath, JSON.stringify(buildState, null, 2));
  });

/** Read one optional fingerprint input without making a fresh native tree fail. */
const readFingerprintInput = (
  filePath: string,
): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const fileExists = yield* fileSystem.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!fileExists) return '';
    return yield* fileSystem.readFileString(filePath).pipe(Effect.orElseSucceed(() => ''));
  });

/** Read and hash the iOS native dependency graph. */
export const gatherIosFingerprint = (
  iosDirectory: string,
  configPath: string,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const podfileLock = yield* readFingerprintInput(pathService.join(iosDirectory, 'Podfile.lock'));
    const podfileProperties = yield* readFingerprintInput(
      pathService.join(iosDirectory, 'Podfile.properties.json'),
    );
    const appConfigText = yield* readFingerprintInput(configPath);
    const toolchainVersion = yield* provideNodeCommandServices(
      captureCommandOutput('xcodebuild', ['-version']),
    ).pipe(Effect.orElseSucceed(() => ''));
    return computeBuildFingerprint({
      podfileLock,
      podfileProperties,
      appConfigSlice: extractNativeConfigSlice(appConfigText),
      toolchainVersion,
    });
  });
