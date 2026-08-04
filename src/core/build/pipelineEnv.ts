import { Terminal } from '@effect/platform';
import { Data, Effect } from 'effect';
import type { AppDescriptor, BuildProfile } from '../types/app.js';
import { pickOne, type PickOneArgs } from '../services/prompt.js';
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

/** App selection failed before a build could start. */
export type AppSelectionFailure = Readonly<{
  readonly _tag: 'AppSelectionFailure';
  readonly message: string;
  readonly cause?: unknown;
}>;
export const makeAppSelectionFailure = Data.tagged<AppSelectionFailure>('AppSelectionFailure');

/** Build environment resolution or validation failed before artifact creation. */
export type BuildEnvironmentFailure = Readonly<{
  readonly _tag: 'BuildEnvironmentFailure';
  readonly stage: 'secrets' | 'validation';
  readonly message: string;
  readonly cause?: unknown;
}>;
export const makeBuildEnvironmentFailure =
  Data.tagged<BuildEnvironmentFailure>('BuildEnvironmentFailure');
/**
 * Pick the app to build: an explicit `--app`, the sole discovered app, or an interactive prompt. The
 * prompt is the shared {@link pickOne}, which past a threshold (large monorepos) switches the flat list
 * to a fuzzy type-to-search over the name and bundle/package id. With no TTY and more than one app it
 * refuses to guess and tells the user to pass `--app`, rather than silently building the wrong one.
 */
export const selectApp = (apps: readonly AppDescriptor[], appName: string | undefined) =>
  Effect.gen(function* () {
    if (apps.length === 0)
      return yield* Effect.fail(
        makeAppSelectionFailure({
          message: 'No apps found. Run Launch from a repo containing at least one app.json.',
        }),
      );
    if (appName) {
      const match = apps.find((app) => app.name === appName);
      if (!match)
        return yield* Effect.fail(
          makeAppSelectionFailure({
            message: `App "${appName}" not found. Available: ${apps.map((availableApp) => availableApp.name).join(', ')}.`,
          }),
        );
      return match;
    }
    const sole = apps[0];
    if (apps.length === 1 && sole) return sole;
    // Pre-select the app built last time (when it's still discovered) so a re-run is one keystroke; the
    // pick still shows, so a monorepo never silently builds the wrong app.
    const lastAppName = yield* readLastApp();
    const lastApp = apps.find((app) => app.name === lastAppName);
    const terminal = yield* Terminal.Terminal;
    const canPrompt = yield* terminal.isTTY;
    const choices = apps.map((app) => {
      let hint = app.packageName;
      if (app.bundleId !== undefined) hint = app.bundleId;
      if (hint !== undefined) return { selection: app, label: app.name, hint };
      return { selection: app, label: app.name };
    });
    let requestWithInitialSelection: PickOneArgs<AppDescriptor> = {
      message: `Which app? (${apps.length} found)`,
      choices,
      canPrompt,
      nonInteractive: {
        kind: 'require' as const,
        flagHint: '- pass --app <name> to choose one non-interactively.',
      },
    };
    if (lastApp !== undefined) {
      requestWithInitialSelection = { ...requestWithInitialSelection, initialSelection: lastApp };
    }
    return yield* pickOne<AppDescriptor>({
      ...requestWithInitialSelection,
    }).pipe(Effect.mapError((cause) => makeAppSelectionFailure({ message: cause.message, cause })));
  });
/**
 * Resolve the layered env for any command (build / release / update) from an app + profile: keychain
 * secrets resolved here, then handed with the dotenv files, inline `profile.env`, and `--env` flags to
 * the one precedence ladder in {@link resolveEnv}. The single place keychain meets the resolver, so
 * every command injects identical env (issue #25). Pure resolver stays keychain-free for testability.
 */
export const resolveCommandEnv = (input: {
  app: AppDescriptor;
  profile: BuildProfile;
  cliEnv?: Record<string, string> | undefined;
  includeLocal?: boolean | undefined;
  envExclude?: readonly string[] | undefined;
}) =>
  Effect.gen(function* () {
    const secrets = yield* resolveBuildSecrets(input.app.name, input.profile.name).pipe(
      Effect.mapError((cause) =>
        makeBuildEnvironmentFailure({
          stage: 'secrets',
          message: `Could not resolve build secrets for ${input.app.name}.`,
          cause,
        }),
      ),
    );
    return yield* resolveEnv({
      appDir: input.app.dir,
      profileName: input.profile.name,
      profileEnv: input.profile.env,
      envFile: input.profile.envFile,
      secrets,
      cliEnv: input.cliEnv,
      includeLocal: input.includeLocal,
      envExclude: input.envExclude,
    });
  });
/**
 * Gate + warn on a resolved env before an artifact-baking command (build, update): hard-fail on any
 * `.env.example` key that's missing (names matched by `exclude` - the config's `envExclude` - are exempt,
 * since they're intentionally backend-only), then warn about secret-looking names coming from a plaintext
 * source (dotenv files / inline `env:`) since they'd be bundled into the app. Keychain secrets and `--env`
 * flags are exempt - the former are meant to be secret, the latter an explicit override; anything in
 * `envExclude` is already gone from `resolved.values`, so it never reaches this warning. Release does NOT
 * call this: it promotes a prebuilt artifact, so its env never bakes into the app.
 */
export const validateResolvedEnv = (
  appDir: string,
  resolved: ResolvedEnv,
  log: Logger,
  exclude: readonly string[] = [],
) =>
  Effect.gen(function* () {
    const missing = yield* missingKeys(appDir, resolved.values, exclude).pipe(
      Effect.mapError((cause) =>
        makeBuildEnvironmentFailure({
          stage: 'validation',
          message: `Could not read ${appDir}/.env.example.`,
          cause,
        }),
      ),
    );
    if (missing.length > 0) {
      return yield* Effect.fail(
        makeBuildEnvironmentFailure({
          stage: 'validation',
          message: `Missing env keys (in .env.example, absent from your env): ${missing.join(', ')}`,
        }),
      );
    }
    for (const environmentName of secretLookingKeys(resolved.values)) {
      const source = resolved.sources[environmentName];
      if (source === ENV_SOURCE.secret) continue;
      if (source === ENV_SOURCE.flag) continue;
      yield* log
        .warn(
          `"${environmentName}" looks like a backend secret (from ${source}) - it would be bundled into the app. If the app needs it at build time, store it with \`launch secret set ${environmentName}\`; if it's backend-only, add it to \`envExclude\` in launch.config.ts.`,
        )
        .pipe(
          Effect.mapError((cause) =>
            makeBuildEnvironmentFailure({
              stage: 'validation',
              message: `Could not write the environment warning for ${environmentName}.`,
              cause,
            }),
          ),
        );
    }
  });
/**
 * Resolve env exactly as a build would and print the masked provenance table (`--print-env`), with no
 * config preflight or build work - a clean "what env will be injected, and from where" preview.
 */
export const previewEnv = (options: BuildRunOptions) =>
  Effect.gen(function* () {
    const { config, apps } = yield* loadConfig();
    const app = yield* selectApp(apps, options.appName);
    let profile = config.profiles[options.profileName];
    if (profile === undefined) {
      profile = { name: options.profileName, sizeBudgetMB: 200 };
    }
    const resolved = yield* resolveCommandEnv({
      app,
      profile,
      cliEnv: options.envOverrides,
      includeLocal: options.includeLocal,
      envExclude: config.envExclude,
    });
    const logger = yield* createLogger(false);
    yield* logger.line(formatEnvTable(resolved));
  });
