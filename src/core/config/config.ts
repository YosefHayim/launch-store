import { FileSystem, Path } from '@effect/platform';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { Data, Effect, Option, Schema } from 'effect';
import type { AppDescriptor } from '../types/app.js';
import type { LaunchConfig, LaunchConfigInput } from '../types/config.js';
import {
  DEFAULT_BUILD_ENGINE,
  DEFAULT_CREDENTIALS_PROVIDER,
  DEFAULT_STORAGE_PROVIDER,
  DEFAULT_SUBMITTER,
} from '../types/config.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
/**
 * Absolute path to THIS package's own public entry (`defineConfig` + the config types), resolved
 * relative to the loader so it points at whichever copy is actually running - the globally-installed
 * `dist/index.js` in production, the TypeScript source under vitest. The layout `<root>/{src,dist}/core/`
 * makes `../index.js` the entry from either tree.
 */
const SELF_ENTRY = fileURLToPath(new URL('../../index.js', import.meta.url));
/**
 * On-the-fly loader for the user's config. The compiled `launch` binary runs on plain Node, which
 * can't `import()` a TypeScript file - jiti transpiles `launch.config.ts` in memory. The `alias` pins
 * the config's `import { defineConfig } from "launch-store"` to {@link SELF_ENTRY}, so a globally
 * installed `launch` loads the config even when the user's project has no local `launch-store`
 * dependency (issue #8), and the config always binds to the exact `defineConfig` of the CLI consuming
 * it - no dual-package version skew. (jiti chosen over bundling a TS toolchain ourselves; it's the
 * same loader Nuxt/ESLint use for config files.)
 */
const jiti = createJiti(import.meta.url, { alias: { 'launch-store': SELF_ENTRY } });
// Re-exported so `import { LaunchConfigInput } from "launch-store"` (via src/index.ts -> here) still
// resolves; the type itself is `LaunchConfigInput`, owned by `types/config.ts`.
export type { LaunchConfigInput };
/**
 * Author a typed `launch.config.ts`. Fills in the v1 defaults (`local` credentials + storage,
 * `fastlane` engine) so a minimal config only needs to declare profiles.
 *
 * The whole `input` is spread through first, so anything the user wrote - including a typo'd top-level
 * key the type system can't catch in an un-compiled config - survives onto the resolved object. That lets
 * `launch config validate` flag unknown keys on the `.ts` path the same way the schema's
 * `additionalProperties: false` root already catches them on the `.json` path (issue #197), instead of
 * silently dropping them. Known keys are inert noise to the pipeline; an unknown one becomes a reported
 * violation rather than a swallowed mistake.
 *
 * Deliberately fills defaults by hand rather than Effect Schema parse - parsing would strip those
 * unknown top-level keys (defeating #197) and throw on a not-yet-valid field at load time, whereas
 * `launch config validate` is the explicit gate. The defaults come from the same `DEFAULT_*` constants
 * the schema's `.default(...)` uses, so the two paths can't disagree.
 */
export const defineConfig = (input: LaunchConfigInput): LaunchConfig => {
  let credentials = input.credentials;
  if (credentials === undefined) credentials = DEFAULT_CREDENTIALS_PROVIDER;
  let storage = input.storage;
  if (storage === undefined) storage = DEFAULT_STORAGE_PROVIDER;
  let buildEngine = input.buildEngine;
  if (buildEngine === undefined) buildEngine = DEFAULT_BUILD_ENGINE;
  let submit = input.submit;
  if (submit === undefined) submit = DEFAULT_SUBMITTER;
  return {
    ...input,
    credentials,
    storage,
    buildEngine,
    submit,
  };
};
/**
 * Resolve a Launch-native config section that can be declared either as a typed field on
 * `launch.config.ts` (the single-config path - issue #101) or as its standalone `*.config.json`
 * sidecar (back-compat). Precedence, highest first:
 *   1. an explicitly-passed `--config <path>` - the user pointed at a sidecar on purpose, so load it;
 *   2. the typed field, when present on the loaded config;
 *   3. the sidecar at its default path, when that file exists.
 * Returns `undefined` when none apply, so the caller throws a feature-specific "nothing declared" hint.
 * `load` is the section's existing JSON loader (which itself throws a helpful error on a missing path).
 */
export const resolveSidecarConfig = <T>(params: {
  /** The typed value read off the loaded config (e.g. `config.gameCenter?.[bundleId]`), if any. */
  typed: NoInfer<T> | undefined;
  /** The `--config` path (defaulted by the command); used for both the explicit and fallback loads. */
  configPath: string;
  /** Whether `--config` was passed on the CLI (`command.getOptionValueSource("config") === "cli"`). */
  explicitPath: boolean;
  /** The section's JSON loader, e.g. `loadGameCenterConfig`. */
  load: (path: string) => Effect.Effect<T, unknown, FileSystem.FileSystem>;
}): Effect.Effect<T | undefined, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (params.explicitPath) return yield* params.load(params.configPath);
    if (params.typed !== undefined) return params.typed;
    const fileSystem = yield* FileSystem.FileSystem;
    if (yield* fileSystem.exists(params.configPath)) return yield* params.load(params.configPath);
    return undefined;
  });
/** The fully-resolved configuration plus every app Launch found. */
export type LoadedConfig = {
  config: LaunchConfig;
  apps: AppDescriptor[];
};
const DEFAULT_CONFIG: LaunchConfig = {
  credentials: 'local',
  storage: 'local',
  buildEngine: 'fastlane',
  submit: 'app-store-connect',
  profiles: { production: { name: 'production', sizeBudgetMB: 200 } },
};
const SKIP_DIRS = new Set(['node_modules', '.git', 'ios', 'android', 'dist', '.expo', '.launch']);
/** A located Launch config: the resolved `launch.config.{ts,mjs,js}` path and the config it exports. */
export type FoundConfig = {
  path: string;
  config: LaunchConfig;
};
export type ConfigLoadFailure = Readonly<{
  readonly _tag: 'ConfigLoadFailure';
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}>;
export const makeConfigLoadFailure = Data.tagged<ConfigLoadFailure>('ConfigLoadFailure');
/**
 * Find and load the user's `launch.config.{ts,mjs,js}` under `cwd`, returning the resolved path with the
 * loaded config - or `null` when none exists, so a caller (e.g. `launch config validate`) can tell "no
 * config here" apart from "a config that loaded". jiti transpiles a `.ts` config in memory so it runs on
 * plain Node. Throws when a config file exists but doesn't `export default`.
 */
export const findLaunchConfig = (
  requestedDirectory?: string,
): Effect.Effect<
  FoundConfig | null,
  ConfigLoadFailure,
  FileSystem.FileSystem | LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    let workingDirectory = requestedDirectory;
    if (workingDirectory === undefined) workingDirectory = (yield* LaunchPaths).workingDirectory;
    for (const fileName of ['launch.config.ts', 'launch.config.mjs', 'launch.config.js']) {
      const configPath = pathService.join(workingDirectory, fileName);
      const configExists = yield* fileSystem
        .exists(configPath)
        .pipe(Effect.orElseSucceed(() => false));
      if (!configExists) continue;
      const loaded = yield* Effect.tryPromise({
        try: () => jiti.import<{ default?: LaunchConfig }>(configPath),
        catch: (cause) =>
          makeConfigLoadFailure({
            path: configPath,
            message: `Could not load ${fileName}.`,
            cause,
          }),
      });
      if (!loaded.default)
        return yield* Effect.fail(
          makeConfigLoadFailure({
            path: configPath,
            message: `${fileName} must \`export default defineConfig({ ... })\`.`,
          }),
        );
      return { path: configPath, config: loaded.default };
    }
    return null;
  });
/** Read `launch.config.{ts,js,mjs}` from `root` if present, else fall back to defaults. */
const readLaunchConfig = (root: string) =>
  findLaunchConfig(root).pipe(
    Effect.map((foundConfig) => {
      if (foundConfig === null) return DEFAULT_CONFIG;
      return foundConfig.config;
    }),
  );
/** The static (JSON) and dynamic (evaluated) Expo config filenames, each in Expo's precedence order. */
const STATIC_CONFIGS = ['app.config.json', 'app.json'] as const;
const DYNAMIC_CONFIGS = ['app.config.ts', 'app.config.js', 'app.config.mjs'] as const;
/** Narrow an unknown value to a plain object, or null. */
const UnknownRecordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const decodeUnknownRecord = Schema.decodeUnknownOption(UnknownRecordSchema);
const decodedRecordOrNull = (candidateValue: unknown): Record<string, unknown> | null => {
  return Option.getOrNull(decodeUnknownRecord(candidateValue));
};
/**
 * Build an {@link AppDescriptor} from a parsed/evaluated Expo config. Tolerates an `{ expo: {...} }`
 * wrapper or a flat shape (Expo or bare React Native), and a config missing the iOS, Android, or
 * version fields. Returns null when there's no usable app handle (neither `slug` nor `name`).
 */
const toDescriptor = (
  rawConfig: Record<string, unknown>,
  appDirectory: string,
  configPath: string,
): AppDescriptor | null => {
  let expoConfig = decodedRecordOrNull(rawConfig['expo']);
  if (expoConfig === null) expoConfig = rawConfig;
  let appHandle: string | undefined;
  if (typeof expoConfig['slug'] === 'string') appHandle = expoConfig['slug'];
  if (appHandle === undefined && typeof expoConfig['name'] === 'string') {
    appHandle = expoConfig['name'];
  }
  if (appHandle === undefined) return null;
  const descriptor: AppDescriptor = {
    name: appHandle.toLowerCase(),
    dir: appDirectory,
    configPath,
  };
  const ios = decodedRecordOrNull(expoConfig['ios']);
  if (ios && typeof ios['bundleIdentifier'] === 'string')
    descriptor.bundleId = ios['bundleIdentifier'];
  let entitlements: Record<string, unknown> | null = null;
  if (ios) entitlements = decodedRecordOrNull(ios['entitlements']);
  if (entitlements) descriptor.iosEntitlements = entitlements;
  const extensions = ios?.['extensions'];
  if (Array.isArray(extensions)) {
    const ids = extensions.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length > 0) descriptor.iosExtensions = ids;
  }
  let iosConfig: Record<string, unknown> | null = null;
  if (ios) iosConfig = decodedRecordOrNull(ios['config']);
  if (iosConfig && typeof iosConfig['usesNonExemptEncryption'] === 'boolean') {
    descriptor.usesNonExemptEncryption = iosConfig['usesNonExemptEncryption'];
  }
  const android = decodedRecordOrNull(expoConfig['android']);
  if (android && typeof android['package'] === 'string')
    descriptor.packageName = android['package'];
  if (android && typeof android['versionCode'] === 'number')
    descriptor.androidVersionCode = android['versionCode'];
  if (typeof expoConfig['version'] === 'string') descriptor.version = expoConfig['version'];
  return descriptor;
};
/** Read the highest-precedence static (JSON) config in a directory, if any. */
const readStaticConfig = (
  appDirectory: string,
): Effect.Effect<
  {
    rawConfig: Record<string, unknown>;
    path: string;
  } | null,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    for (const fileName of STATIC_CONFIGS) {
      const configPath = pathService.join(appDirectory, fileName);
      const configExists = yield* fileSystem
        .exists(configPath)
        .pipe(Effect.orElseSucceed(() => false));
      if (!configExists) continue;
      const decodedConfig = yield* fileSystem.readFileString(configPath).pipe(
        Effect.flatMap((configText) => Effect.try(() => JSON.parse(configText))),
        Effect.map(decodedRecordOrNull),
        Effect.orElseSucceed(() => null),
      );
      if (decodedConfig !== null) return { rawConfig: decodedConfig, path: configPath };
    }
    return null;
  });
/**
 * Evaluate the highest-precedence dynamic config (`app.config.{ts,js,mjs}`) in a directory, if any.
 * A dynamic config may export an object or a function; Expo calls the function with the static
 * config so it can extend it, so we pass the same. A config that throws when evaluated is skipped
 * (we fall back to the static JSON), keeping discovery resilient when the repo's own deps are absent.
 */
const readDynamicConfig = (
  appDirectory: string,
  staticConfig: Record<string, unknown>,
): Effect.Effect<
  {
    rawConfig: Record<string, unknown>;
    path: string;
  } | null,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    for (const fileName of DYNAMIC_CONFIGS) {
      const configPath = pathService.join(appDirectory, fileName);
      const configExists = yield* fileSystem
        .exists(configPath)
        .pipe(Effect.orElseSucceed(() => false));
      if (!configExists) continue;
      const configAttempt = yield* Effect.tryPromise(() =>
        jiti.import<{ default?: unknown }>(configPath),
      ).pipe(Effect.either);
      if (configAttempt._tag === 'Left') continue;
      const exportedConfig = configAttempt.right.default;
      if (exportedConfig === undefined) continue;
      let evaluatedConfig: unknown = exportedConfig;
      if (typeof exportedConfig === 'function') {
        const evaluationAttempt = yield* Effect.tryPromise(() =>
          globalThis.Promise.resolve(exportedConfig({ config: staticConfig })),
        ).pipe(Effect.either);
        if (evaluationAttempt._tag === 'Left') continue;
        evaluatedConfig = evaluationAttempt.right;
      }
      const rawConfig = decodedRecordOrNull(evaluatedConfig);
      if (rawConfig !== null) return { rawConfig, path: configPath };
    }
    return null;
  });
/**
 * Resolve a directory's single app config: a dynamic config wins over the static JSON (Expo's
 * precedence) and is handed the static config to extend; null when neither is present. Shared by
 * descriptor discovery ({@link readAppAt}) and the raw-config reader ({@link readResolvedConfig}).
 */
const resolveConfig = (
  appDirectory: string,
): Effect.Effect<
  {
    rawConfig: Record<string, unknown>;
    path: string;
  } | null,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const staticConfig = yield* readStaticConfig(appDirectory);
    let staticConfigDocument: Record<string, unknown> = {};
    if (staticConfig !== null) staticConfigDocument = staticConfig.rawConfig;
    const dynamicConfig = yield* readDynamicConfig(appDirectory, staticConfigDocument);
    if (dynamicConfig !== null) return dynamicConfig;
    return staticConfig;
  });
/** Resolve the single app config in a directory into an {@link AppDescriptor}, or null when there's no app. */
const readAppAt = (appDirectory: string) =>
  Effect.gen(function* () {
    const chosenConfig = yield* resolveConfig(appDirectory);
    if (chosenConfig === null) return null;
    return toDescriptor(chosenConfig.rawConfig, appDirectory, chosenConfig.path);
  });
/**
 * Read a directory's fully-resolved Expo config (the static JSON extended by any dynamic
 * `app.config.*`), exactly as discovery sees it. Exposed for the preflight validator
 * (`core/configCheck.ts`), which inspects fields the {@link AppDescriptor} doesn't carry - splash,
 * icon, scheme. Returns null when the directory has no Expo config.
 */
export const readResolvedConfig = (appDirectory: string) =>
  resolveConfig(appDirectory).pipe(
    Effect.map((resolvedConfig) => {
      if (resolvedConfig === null) return null;
      return resolvedConfig.rawConfig;
    }),
  );
/** Recursively scan a root for Expo configs (static or dynamic), skipping heavy/generated directories. */
const discoverApps = (
  root: string,
  maxDepth = 4,
): Effect.Effect<AppDescriptor[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const discoveredApps: AppDescriptor[] = [];
    const walk = (
      directory: string,
      depth: number,
    ): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
      Effect.gen(function* () {
        if (depth > maxDepth) return;
        const directoryEntries = yield* fileSystem
          .readDirectory(directory)
          .pipe(Effect.orElseSucceed(() => []));
        const appDescriptor = yield* readAppAt(directory);
        if (appDescriptor !== null) discoveredApps.push(appDescriptor);
        yield* Effect.forEach(
          directoryEntries,
          (entryName) =>
            Effect.gen(function* () {
              if (SKIP_DIRS.has(entryName)) return;
              if (entryName.startsWith('.')) return;
              const childPath = pathService.join(directory, entryName);
              const childMetadata = yield* fileSystem.stat(childPath).pipe(Effect.option);
              if (Option.isSome(childMetadata) && childMetadata.value.type === 'Directory') {
                yield* walk(childPath, depth + 1);
              }
            }),
          { concurrency: 1, discard: true },
        );
      });
    yield* walk(root, 0);
    return discoveredApps;
  });
/**
 * Persist a new marketing version into an app's static Expo config (`expo.version`, or a flat
 * `version`), written back as 2-space JSON. Returns whether it wrote: a dynamic config
 * (`app.config.{ts,js,mjs}`) can't be safely rewritten - its `version` may be computed - so the
 * caller stamps the native project instead and leaves the source untouched. Re-reads from disk
 * rather than trusting the in-memory descriptor, so a concurrent edit since discovery isn't clobbered.
 */
export const writeAppVersion = (
  app: AppDescriptor,
  version: string,
): Effect.Effect<boolean, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (!app.configPath.endsWith('.json')) return false;
    const fileSystem = yield* FileSystem.FileSystem;
    const configText = yield* fileSystem
      .readFileString(app.configPath)
      .pipe(Effect.orElseSucceed(() => null));
    if (configText === null) return false;
    const parsedConfig = yield* Effect.try(() => JSON.parse(configText)).pipe(
      Effect.orElseSucceed(() => null),
    );
    const rawConfig = decodedRecordOrNull(parsedConfig);
    if (rawConfig === null) return false;
    const expoConfig = decodedRecordOrNull(rawConfig['expo']);
    if (expoConfig !== null) rawConfig['expo'] = { ...expoConfig, version };
    else rawConfig['version'] = version;
    yield* fileSystem.writeFileString(app.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`);
    return true;
  });
/**
 * Merge entitlement key->value pairs into an app's static Expo config (`expo.ios.entitlements`, or a flat
 * `ios.entitlements`), adding only keys not already present - it never overwrites a value you've set - and
 * return the keys actually added, written back as 2-space JSON. Returns `[]` without writing for a dynamic
 * config (`app.config.{ts,js,mjs}`), whose entitlements may be computed, so `launch adopt` prints the block
 * to paste instead. Re-reads from disk (like {@link writeAppVersion}) so a concurrent edit isn't clobbered.
 * The value type is `unknown` so this stays decoupled from the adopt feature that calls it.
 */
export const writeAppEntitlements = (
  app: AppDescriptor,
  entitlements: Record<string, unknown>,
): Effect.Effect<string[], unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (!app.configPath.endsWith('.json')) return [];
    const fileSystem = yield* FileSystem.FileSystem;
    const configText = yield* fileSystem
      .readFileString(app.configPath)
      .pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (configText === null) return [];
    const parsedConfig = yield* Effect.try(() => JSON.parse(configText)).pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    );
    const rawConfig = decodedRecordOrNull(parsedConfig);
    if (rawConfig === null) return [];
    const decodedExpo = decodedRecordOrNull(rawConfig['expo']);
    let expoConfig = rawConfig;
    if (decodedExpo !== null) expoConfig = decodedExpo;
    let iosConfig = decodedRecordOrNull(expoConfig['ios']);
    if (iosConfig === null) iosConfig = {};
    let currentEntitlements = decodedRecordOrNull(iosConfig['entitlements']);
    if (currentEntitlements === null) currentEntitlements = {};
    const added: string[] = [];
    for (const [key, entitlementValue] of Object.entries(entitlements)) {
      if (key in currentEntitlements) continue;
      currentEntitlements[key] = entitlementValue;
      added.push(key);
    }
    if (added.length === 0) return [];
    iosConfig['entitlements'] = currentEntitlements;
    expoConfig['ios'] = iosConfig;
    if (decodedExpo !== null) rawConfig['expo'] = expoConfig;
    yield* fileSystem.writeFileString(app.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`);
    return added;
  });
/** Load the Launch config and discover apps under its `appRoots` (defaulting to `cwd`). */
export const loadConfig = (requestedDirectory?: string) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    let workingDirectory = requestedDirectory;
    if (workingDirectory === undefined) workingDirectory = (yield* LaunchPaths).workingDirectory;
    const config = yield* readLaunchConfig(workingDirectory);
    let configuredRoots = config.appRoots;
    if (configuredRoots === undefined) configuredRoots = [workingDirectory];
    const resolvedRoots = configuredRoots.map((appRoot) =>
      pathService.resolve(workingDirectory, appRoot),
    );
    const discoveredAppGroups = yield* Effect.forEach(
      resolvedRoots,
      (appRoot) => discoverApps(appRoot),
      { concurrency: 'unbounded' },
    );
    const apps = discoveredAppGroups.flat();
    return { config, apps };
  });
