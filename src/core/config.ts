/**
 * Loads Launch's hybrid configuration: CLI-specific settings come from `launch.config.ts`, while
 * app FACTS (bundle id, version) are auto-discovered from each app's existing Expo config
 * (`app.json`, or a dynamic `app.config.{ts,js,mjs}`) — so nothing is duplicated across a 40+ app
 * monorepo and the app's own config stays the source of truth.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import type { AppDescriptor, LaunchConfig } from "./types.js";

/**
 * Absolute path to THIS package's own public entry (`defineConfig` + the config types), resolved
 * relative to the loader so it points at whichever copy is actually running — the globally-installed
 * `dist/index.js` in production, the TypeScript source under vitest. The layout `<root>/{src,dist}/core/`
 * makes `../index.js` the entry from either tree.
 */
const SELF_ENTRY = fileURLToPath(new URL("../index.js", import.meta.url));

/**
 * On-the-fly loader for the user's config. The compiled `launch` binary runs on plain Node, which
 * can't `import()` a TypeScript file — jiti transpiles `launch.config.ts` in memory. The `alias` pins
 * the config's `import { defineConfig } from "launch-store"` to {@link SELF_ENTRY}, so a globally
 * installed `launch` loads the config even when the user's project has no local `launch-store`
 * dependency (issue #8), and the config always binds to the exact `defineConfig` of the CLI consuming
 * it — no dual-package version skew. (jiti chosen over bundling a TS toolchain ourselves; it's the
 * same loader Nuxt/ESLint use for config files.)
 */
const jiti = createJiti(import.meta.url, { alias: { "launch-store": SELF_ENTRY } });

/** Input to {@link defineConfig}: `profiles` is required; provider names default sensibly. */
export type LaunchConfigInput = Pick<LaunchConfig, "profiles"> & Partial<Omit<LaunchConfig, "profiles">>;

/**
 * Author a typed `launch.config.ts`. Fills in the v1 defaults (`local` credentials + storage,
 * `fastlane` engine) so a minimal config only needs to declare profiles.
 */
export function defineConfig(input: LaunchConfigInput): LaunchConfig {
  return {
    credentials: input.credentials ?? "local",
    storage: input.storage ?? "local",
    buildEngine: input.buildEngine ?? "fastlane",
    submit: input.submit ?? "app-store-connect",
    profiles: input.profiles,
    ...(input.appRoots ? { appRoots: input.appRoots } : {}),
    ...(input.products ? { products: input.products } : {}),
    ...(input.notify ? { notify: input.notify } : {}),
    ...(input.release ? { release: input.release } : {}),
    ...(input.aws ? { aws: input.aws } : {}),
    ...(input.storageConfig ? { storageConfig: input.storageConfig } : {}),
  };
}

/** The fully-resolved configuration plus every app Launch found. */
export interface LoadedConfig {
  config: LaunchConfig;
  apps: AppDescriptor[];
}

const DEFAULT_CONFIG: LaunchConfig = {
  credentials: "local",
  storage: "local",
  buildEngine: "fastlane",
  submit: "app-store-connect",
  profiles: { production: { name: "production", sizeBudgetMB: 200 } },
};

const SKIP_DIRS = new Set(["node_modules", ".git", "ios", "android", "dist", ".expo", ".launch"]);

/** Read `launch.config.{ts,js,mjs}` from `root` if present, else fall back to defaults. */
async function readLaunchConfig(root: string): Promise<LaunchConfig> {
  for (const file of ["launch.config.ts", "launch.config.mjs", "launch.config.js"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const loaded = await jiti.import<{ default?: LaunchConfig }>(path);
    if (!loaded.default) throw new Error(`${file} must \`export default defineConfig({ ... })\`.`);
    return loaded.default;
  }
  return DEFAULT_CONFIG;
}

/** The static (JSON) and dynamic (evaluated) Expo config filenames, each in Expo's precedence order. */
const STATIC_CONFIGS = ["app.config.json", "app.json"] as const;
const DYNAMIC_CONFIGS = ["app.config.ts", "app.config.js", "app.config.mjs"] as const;

/** A dynamic Expo config exported as a function — Expo hands it the static config to extend. */
type DynamicConfigFn = (arg: { config: Record<string, unknown> }) => unknown;

/** Narrow an unknown value to a plain object, or null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Build an {@link AppDescriptor} from a parsed/evaluated Expo config. Tolerates an `{ expo: {...} }`
 * wrapper or a flat shape (Expo or bare React Native), and a config missing the iOS, Android, or
 * version fields. Returns null when there's no usable app handle (neither `slug` nor `name`).
 */
function toDescriptor(raw: Record<string, unknown>, dir: string, configPath: string): AppDescriptor | null {
  const expo = asRecord(raw["expo"]) ?? raw;
  const slug = typeof expo["slug"] === "string" ? expo["slug"] : undefined;
  const name = typeof expo["name"] === "string" ? expo["name"] : undefined;
  const handle = slug ?? name;
  if (!handle) return null;

  const descriptor: AppDescriptor = { name: handle.toLowerCase(), dir, configPath };
  const ios = asRecord(expo["ios"]);
  if (ios && typeof ios["bundleIdentifier"] === "string") descriptor.bundleId = ios["bundleIdentifier"];
  const entitlements = ios ? asRecord(ios["entitlements"]) : null;
  if (entitlements) descriptor.iosEntitlements = entitlements;
  const android = asRecord(expo["android"]);
  if (android && typeof android["package"] === "string") descriptor.packageName = android["package"];
  if (android && typeof android["versionCode"] === "number") descriptor.androidVersionCode = android["versionCode"];
  if (typeof expo["version"] === "string") descriptor.version = expo["version"];
  return descriptor;
}

/** Read the highest-precedence static (JSON) config in a directory, if any. */
function readStaticConfig(dir: string): { raw: Record<string, unknown>; path: string } | null {
  for (const file of STATIC_CONFIGS) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    try {
      const raw = asRecord(JSON.parse(readFileSync(path, "utf8")));
      if (raw) return { raw, path };
    } catch {
      // malformed JSON — try the next candidate
    }
  }
  return null;
}

/**
 * Evaluate the highest-precedence dynamic config (`app.config.{ts,js,mjs}`) in a directory, if any.
 * A dynamic config may export an object or a function; Expo calls the function with the static
 * config so it can extend it, so we pass the same. A config that throws when evaluated is skipped
 * (we fall back to the static JSON), keeping discovery resilient when the repo's own deps are absent.
 */
async function readDynamicConfig(
  dir: string,
  staticConfig: Record<string, unknown>,
): Promise<{ raw: Record<string, unknown>; path: string } | null> {
  for (const file of DYNAMIC_CONFIGS) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    try {
      const mod = await jiti.import<{ default?: unknown }>(path);
      if (mod.default === undefined) continue;
      const evaluated =
        typeof mod.default === "function" ? (mod.default as DynamicConfigFn)({ config: staticConfig }) : mod.default;
      const raw = asRecord(await evaluated);
      if (raw) return { raw, path };
    } catch {
      // a config that fails to load/evaluate — fall back to the static JSON
    }
  }
  return null;
}

/**
 * Resolve a directory's single app config: a dynamic config wins over the static JSON (Expo's
 * precedence) and is handed the static config to extend; null when neither is present. Shared by
 * descriptor discovery ({@link readAppAt}) and the raw-config reader ({@link readResolvedConfig}).
 */
async function resolveConfig(dir: string): Promise<{ raw: Record<string, unknown>; path: string } | null> {
  const fromStatic = readStaticConfig(dir);
  const fromDynamic = await readDynamicConfig(dir, fromStatic?.raw ?? {});
  return fromDynamic ?? fromStatic;
}

/** Resolve the single app config in a directory into an {@link AppDescriptor}, or null when there's no app. */
async function readAppAt(dir: string): Promise<AppDescriptor | null> {
  const chosen = await resolveConfig(dir);
  return chosen ? toDescriptor(chosen.raw, dir, chosen.path) : null;
}

/**
 * Read a directory's fully-resolved Expo config (the static JSON extended by any dynamic
 * `app.config.*`), exactly as discovery sees it. Exposed for the preflight validator
 * (`core/configCheck.ts`), which inspects fields the {@link AppDescriptor} doesn't carry — splash,
 * icon, scheme. Returns null when the directory has no Expo config.
 */
export async function readResolvedConfig(dir: string): Promise<Record<string, unknown> | null> {
  return (await resolveConfig(dir))?.raw ?? null;
}

/** Recursively scan a root for Expo configs (static or dynamic), skipping heavy/generated directories. */
async function discoverApps(root: string, maxDepth = 4): Promise<AppDescriptor[]> {
  const found: AppDescriptor[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    const app = await readAppAt(dir);
    if (app) found.push(app);
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const child = join(dir, entry);
      if (statSync(child).isDirectory()) await walk(child, depth + 1);
    }
  };
  await walk(root, 0);
  return found;
}

/**
 * Persist a new marketing version into an app's static Expo config (`expo.version`, or a flat
 * `version`), written back as 2-space JSON. Returns whether it wrote: a dynamic config
 * (`app.config.{ts,js,mjs}`) can't be safely rewritten — its `version` may be computed — so the
 * caller stamps the native project instead and leaves the source untouched. Re-reads from disk
 * rather than trusting the in-memory descriptor, so a concurrent edit since discovery isn't clobbered.
 */
export function writeAppVersion(app: AppDescriptor, version: string): boolean {
  if (!app.configPath.endsWith(".json")) return false;
  let raw: Record<string, unknown> | null;
  try {
    raw = asRecord(JSON.parse(readFileSync(app.configPath, "utf8")));
  } catch {
    return false;
  }
  if (!raw) return false;
  const expo = asRecord(raw["expo"]);
  if (expo) expo["version"] = version;
  else raw["version"] = version;
  writeFileSync(app.configPath, `${JSON.stringify(raw, null, 2)}\n`);
  return true;
}

/** Load the Launch config and discover apps under its `appRoots` (defaulting to `cwd`). */
export async function loadConfig(cwd: string = process.cwd()): Promise<LoadedConfig> {
  const config = await readLaunchConfig(cwd);
  const roots = config.appRoots ?? [cwd];
  const apps = (await Promise.all(roots.map((root) => discoverApps(root)))).flat();
  return { config, apps };
}
