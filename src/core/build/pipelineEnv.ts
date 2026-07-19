/**
 * App selection and layered env resolution for build (and sibling) commands.
 */

import type { AppDescriptor, BuildProfile } from '../types/index.js';
import { pickOne } from '../services/prompt.js';
import { readLastApp } from '../distribution/lastRun.js';
import { resolveBuildSecrets } from './buildSecrets.js';
import {
  ENV_SOURCE,
  formatEnvTable,
  missingKeys,
  resolveEnv,
  secretLookingKeys,
  type ResolvedEnv,
} from '../config/env.js';
import { loadConfig } from '../config/config.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { BuildRunOptions } from './pipelineTypes.js';
import process from 'node:process';

/**
 * Pick the app to build: an explicit `--app`, the sole discovered app, or an interactive prompt. The
 * prompt is the shared {@link pickOne}, which past a threshold (large monorepos) switches the flat list
 * to a fuzzy type-to-search over the name and bundle/package id. With no TTY and more than one app it
 * refuses to guess and tells the user to pass `--app`, rather than silently building the wrong one.
 */
export async function selectApp(
  apps: AppDescriptor[],
  appName: string | undefined,
): Promise<AppDescriptor> {
  if (apps.length === 0)
    throw new Error('No apps found. Run Launch from a repo containing at least one app.json.');
  if (appName) {
    const match = apps.find((app) => app.name === appName);
    if (!match)
      throw new Error(
        `App "${appName}" not found. Available: ${apps.map((a) => a.name).join(', ')}.`,
      );
    return match;
  }
  const sole = apps[0];
  if (apps.length === 1 && sole) return sole;

  // Pre-select the app built last time (when it's still discovered) so a re-run is one keystroke; the
  // pick still shows, so a monorepo never silently builds the wrong app.
  const lastApp = apps.find((app) => app.name === readLastApp());
  return pickOne<AppDescriptor>({
    message: `Which app? (${apps.length} found)`,
    options: apps.map((app) => {
      const hint = app.bundleId ?? app.packageName;
      return hint ? { value: app, label: app.name, hint } : { value: app, label: app.name };
    }),
    canPrompt: process.stdin.isTTY,
    nonInteractive: {
      kind: 'require',
      flagHint: '— pass --app <name> to choose one non-interactively.',
    },
    ...(lastApp ? { initialValue: lastApp } : {}),
  });
}

/**
 * Resolve the layered env for any command (build / release / update) from an app + profile: keychain
 * secrets resolved here, then handed with the dotenv files, inline `profile.env`, and `--env` flags to
 * the one precedence ladder in {@link resolveEnv}. The single place keychain meets the resolver, so
 * every command injects identical env (issue #25). Pure resolver stays keychain-free for testability.
 */
export async function resolveCommandEnv(input: {
  app: AppDescriptor;
  profile: BuildProfile;
  cliEnv?: Record<string, string> | undefined;
  includeLocal?: boolean | undefined;
  envExclude?: string[] | undefined;
}): Promise<ResolvedEnv> {
  const secrets = await resolveBuildSecrets(input.app.name, input.profile.name);
  return resolveEnv({
    appDir: input.app.dir,
    profileName: input.profile.name,
    profileEnv: input.profile.env,
    envFile: input.profile.envFile,
    secrets,
    cliEnv: input.cliEnv,
    includeLocal: input.includeLocal,
    envExclude: input.envExclude,
  });
}

/**
 * Gate + warn on a resolved env before an artifact-baking command (build, update): hard-fail on any
 * `.env.example` key that's missing (names matched by `exclude` — the config's `envExclude` — are exempt,
 * since they're intentionally backend-only), then warn about secret-looking names coming from a plaintext
 * source (dotenv files / inline `env:`) since they'd be bundled into the app. Keychain secrets and `--env`
 * flags are exempt — the former are meant to be secret, the latter an explicit override; anything in
 * `envExclude` is already gone from `resolved.values`, so it never reaches this warning. Release does NOT
 * call this: it promotes a prebuilt artifact, so its env never bakes into the app.
 */
export function validateResolvedEnv(
  appDir: string,
  resolved: ResolvedEnv,
  log: Logger,
  exclude: string[] = [],
): void {
  const missing = missingKeys(appDir, resolved.values, exclude);
  if (missing.length > 0) {
    throw new Error(
      `Missing env keys (in .env.example, absent from your env): ${missing.join(', ')}`,
    );
  }
  for (const name of secretLookingKeys(resolved.values)) {
    const source = resolved.sources[name];
    if (source === ENV_SOURCE.secret || source === ENV_SOURCE.flag) continue;
    log.warn(
      `"${name}" looks like a backend secret (from ${source}) — it would be bundled into the app. If the app needs it at build time, store it with \`launch secret set ${name}\`; if it's backend-only, add it to \`envExclude\` in launch.config.ts.`,
    );
  }
}

/**
 * Resolve env exactly as a build would and print the masked provenance table (`--print-env`), with no
 * config preflight or build work — a clean "what env will be injected, and from where" preview.
 */
export async function previewEnv(options: BuildRunOptions): Promise<void> {
  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, options.appName);
  const profile = config.profiles[options.profileName] ?? {
    name: options.profileName,
    sizeBudgetMB: 200,
  };
  const resolved = await resolveCommandEnv({
    app,
    profile,
    cliEnv: options.envOverrides,
    includeLocal: options.includeLocal,
    envExclude: config.envExclude,
  });
  createLogger(false).line(formatEnvTable(resolved));
}
