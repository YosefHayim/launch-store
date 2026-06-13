/**
 * Loads Relay's hybrid configuration: CLI-specific settings come from `relay.config.ts`, while
 * app FACTS (bundle id, version) are auto-discovered from each app's existing `app.json` — so
 * nothing is duplicated across a 40+ app monorepo and `app.json` stays the source of truth.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createJiti } from "jiti";
import type { AppDescriptor, RelayConfig } from "./types.js";

/**
 * On-the-fly loader for the user's config. The compiled `relay` binary runs on plain Node, which
 * can't `import()` a TypeScript file — jiti transpiles `relay.config.ts` in memory and resolves its
 * `relaybuild` import from the user's project. (Chosen over bundling a TS toolchain ourselves; it's
 * the same loader Nuxt/ESLint use for config files.)
 */
const jiti = createJiti(import.meta.url);

/** Input to {@link defineConfig}: `profiles` is required; provider names default sensibly. */
export type RelayConfigInput = Pick<RelayConfig, "profiles"> & Partial<Omit<RelayConfig, "profiles">>;

/**
 * Author a typed `relay.config.ts`. Fills in the v1 defaults (`local` credentials + storage,
 * `fastlane` engine) so a minimal config only needs to declare profiles.
 */
export function defineConfig(input: RelayConfigInput): RelayConfig {
  return {
    credentials: input.credentials ?? "local",
    storage: input.storage ?? "local",
    buildEngine: input.buildEngine ?? "fastlane",
    profiles: input.profiles,
    ...(input.appRoots ? { appRoots: input.appRoots } : {}),
  };
}

/** The fully-resolved configuration plus every app Relay found. */
export interface LoadedConfig {
  config: RelayConfig;
  apps: AppDescriptor[];
}

const DEFAULT_CONFIG: RelayConfig = {
  credentials: "local",
  storage: "local",
  buildEngine: "fastlane",
  profiles: { production: { name: "production", sizeBudgetMB: 200 } },
};

const SKIP_DIRS = new Set(["node_modules", ".git", "ios", "android", "dist", ".expo", ".relay"]);

/** Read `relay.config.{ts,js,mjs}` from `root` if present, else fall back to defaults. */
async function readRelayConfig(root: string): Promise<RelayConfig> {
  for (const file of ["relay.config.ts", "relay.config.mjs", "relay.config.js"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const loaded = await jiti.import<{ default?: RelayConfig }>(path);
    if (!loaded.default) throw new Error(`${file} must \`export default defineConfig({ ... })\`.`);
    return loaded.default;
  }
  return DEFAULT_CONFIG;
}

/**
 * Read one Expo `app.json`/`app.config.json` into an {@link AppDescriptor}. Returns null if the
 * file isn't a recognizable Expo config (it tolerates either an `{ expo: {...} }` wrapper or a
 * flat shape).
 */
function readAppConfig(configPath: string, dir: string): AppDescriptor | null {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const expo = (parsed["expo"] ?? parsed) as {
      name?: string;
      slug?: string;
      version?: string;
      ios?: { bundleIdentifier?: string };
    };
    const handle = expo.slug ?? expo.name;
    if (!handle) return null;
    const descriptor: AppDescriptor = { name: handle.toLowerCase(), dir, configPath };
    if (expo.ios?.bundleIdentifier) descriptor.bundleId = expo.ios.bundleIdentifier;
    if (expo.version) descriptor.version = expo.version;
    return descriptor;
  } catch {
    return null;
  }
}

/** Recursively scan a root for `app.json`/`app.config.json`, skipping heavy/generated directories. */
function discoverApps(root: string, maxDepth = 4): AppDescriptor[] {
  const found: AppDescriptor[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const candidate of ["app.json", "app.config.json"]) {
      if (entries.includes(candidate)) {
        const app = readAppConfig(join(dir, candidate), dir);
        if (app) found.push(app);
      }
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const child = join(dir, entry);
      if (statSync(child).isDirectory()) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

/** Load the Relay config and discover apps under its `appRoots` (defaulting to `cwd`). */
export async function loadConfig(cwd: string = process.cwd()): Promise<LoadedConfig> {
  const config = await readRelayConfig(cwd);
  const roots = config.appRoots ?? [cwd];
  const apps = roots.flatMap((root) => discoverApps(root));
  return { config, apps };
}
