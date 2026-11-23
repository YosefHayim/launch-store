import type { AppDescriptor, BuildProfile } from '../types/app.ts';
import { pickOne, type PickOneArgs } from '../services/platform/prompt.ts';
import { readLastApp } from '../distribution/last-run.ts';
import { resolveBuildSecrets } from './build-secrets.ts';
import {
  ENV_SOURCE,
  missingKeys,
  resolveEnv,
  secretLookingKeys,
  type ResolvedEnv,
} from '../config/env.ts';
import type { Logger } from '../services/platform/logger.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import { hasMessage } from '../services/platform/error-message.ts';

/** App selection failed before a build could start. */
export type AppSelectionFailure = Readonly<{
  readonly _tag: 'AppSelectionFailure';
  readonly message: string;
  readonly cause?: unknown;
}>;

function makeAppSelectionFailure(fields: {
  message: string;
  cause?: unknown;
}): AppSelectionFailure {
  const hasCause = fields.cause != null;

  if (hasCause) {
    return { _tag: 'AppSelectionFailure', message: fields.message, cause: fields.cause };
  }

  return { _tag: 'AppSelectionFailure', message: fields.message };
}

/** Build environment resolution or validation failed before artifact creation. */
type BuildEnvironmentFailure = Readonly<{
  readonly _tag: 'BuildEnvironmentFailure';
  readonly stage: 'secrets' | 'validation';
  readonly message: string;
  readonly cause?: unknown;
}>;

function makeBuildEnvironmentFailure(fields: {
  stage: 'secrets' | 'validation';
  message: string;
  cause?: unknown;
}): BuildEnvironmentFailure {
  const hasCause = fields.cause != null;

  if (hasCause) {
    return {
      _tag: 'BuildEnvironmentFailure',
      stage: fields.stage,
      message: fields.message,
      cause: fields.cause,
    };
  }

  return { _tag: 'BuildEnvironmentFailure', stage: fields.stage, message: fields.message };
}

function isOnlyDiscoveredApp(
  apps: readonly AppDescriptor[],
  soleApp: AppDescriptor | undefined,
): soleApp is AppDescriptor {
  const isSingle = apps.length == 1;

  if (isSingle == false) {
    return false;
  }

  return soleApp != null;
}

function readAppName(app: AppDescriptor): string {
  return app.name;
}

function appChoice(app: AppDescriptor): PickOneArgs<AppDescriptor>['choices'][number] {
  const bundleId = app.bundleId;

  const hasBundleId = bundleId != null;

  if (hasBundleId) {
    return { selection: app, label: app.name, hint: bundleId };
  }

  const packageName = app.packageName;

  const hasPackageName = packageName != null;

  if (hasPackageName) {
    return { selection: app, label: app.name, hint: packageName };
  }

  return { selection: app, label: app.name };
}

function findNamedApp(apps: readonly AppDescriptor[], appName: string): AppDescriptor {
  const namedApp = apps.find(function sameName(app: AppDescriptor): boolean {
    return app.name == appName;
  });

  const isMissing = namedApp == null;

  if (isMissing) {
    const availableNames = apps.map(readAppName);

    throw makeAppSelectionFailure({
      message: `App "${appName}" not found. Available: ${availableNames.join(', ')}.`,
    });
  }

  return namedApp;
}

function selectionFailureMessage(cause: unknown): string {
  if (hasMessage(cause)) {
    return cause.message;
  }

  return 'Could not choose an app.';
}

/** Pick the app to build: an explicit `--app`, the sole discovered app */
export async function selectApp(
  apps: readonly AppDescriptor[],
  appName: string | undefined,
): Promise<AppDescriptor> {
  const hasNoApps = apps.length == 0;

  if (hasNoApps) {
    throw makeAppSelectionFailure({
      message: 'No apps found. Run Launch from a repo containing at least one app.json.',
    });
  }

  const hasRequestedName = appName != null;

  if (hasRequestedName) {
    return findNamedApp(apps, appName);
  }

  const soleApp = apps[0];

  const isSoleApp = isOnlyDiscoveredApp(apps, soleApp);

  if (isSoleApp) {
    return soleApp;
  }

  const lastAppName = await readLastApp();
  const lastApp = apps.find(function sameName(app: AppDescriptor): boolean {
    return app.name == lastAppName;
  });
  const canPrompt = checkTerminalIsInteractive();
  const choices = apps.map(appChoice);
  let pickRequest: PickOneArgs<AppDescriptor> = {
    message: `Which app? (${apps.length} found)`,
    choices,
    canPrompt,
    nonInteractive: {
      kind: 'require',
      flagHint: '- pass --app <name> to choose one non-interactively.',
    },
  };

  const hasLastApp = lastApp != null;

  if (hasLastApp) {
    pickRequest = { ...pickRequest, initialSelection: lastApp };
  }

  try {
    const pickedApp = await pickOne(pickRequest);

    return pickedApp;
  } catch (error) {
    throw makeAppSelectionFailure({ message: selectionFailureMessage(error), cause: error });
  }
}

type CommandEnvironmentRequest = {
  app: AppDescriptor;
  profile: BuildProfile;
  cliEnv?: Record<string, string> | undefined;
  includeLocal?: boolean | undefined;
  envExclude?: readonly string[] | undefined;
};

/** Resolve keychain, dotenv, profile env, and --env flags for a command. */
export async function resolveCommandEnv(request: CommandEnvironmentRequest): Promise<ResolvedEnv> {
  let secrets: Awaited<ReturnType<typeof resolveBuildSecrets>>;

  try {
    secrets = await resolveBuildSecrets(request.app.name, request.profile.name);
  } catch (error) {
    throw makeBuildEnvironmentFailure({
      stage: 'secrets',
      message: `Could not resolve build secrets for ${request.app.name}.`,
      cause: error,
    });
  }

  const resolvedEnvironment = await resolveEnv({
    appDir: request.app.dir,
    profileName: request.profile.name,
    profileEnv: request.profile.env,
    envFile: request.profile.envFile,
    secrets,
    cliEnv: request.cliEnv,
    includeLocal: request.includeLocal,
    envExclude: request.envExclude,
  });

  return resolvedEnvironment;
}

/** Hard-fail on missing `.env.example` keys */
export async function validateResolvedEnv(
  appDir: string,
  resolved: ResolvedEnv,
  log: Logger,
  exclude: readonly string[] = [],
): Promise<void> {
  let missing: string[];

  try {
    missing = await missingKeys(appDir, resolved.values, exclude);
  } catch (error) {
    throw makeBuildEnvironmentFailure({
      stage: 'validation',
      message: `Could not read ${appDir}/.env.example.`,
      cause: error,
    });
  }

  const hasMissingKeys = missing.length > 0;

  if (hasMissingKeys) {
    throw makeBuildEnvironmentFailure({
      stage: 'validation',
      message: `Missing env keys (in .env.example, absent from your env): ${missing.join(', ')}`,
    });
  }

  for (const environmentName of secretLookingKeys(resolved.values)) {
    const environmentSource = resolved.sources[environmentName];

    const isKeychainSecret = environmentSource == ENV_SOURCE.secret;

    if (isKeychainSecret) {
      continue;
    }

    const isFlagOverride = environmentSource == ENV_SOURCE.flag;

    if (isFlagOverride) {
      continue;
    }

    log.warn(
      `"${environmentName}" looks like a backend secret (from ${environmentSource}) - it would be bundled into the app. If the app needs it at build time, store it with \`launch-store secret set ${environmentName}\`; if it's backend-only, add it to \`envExclude\` in launch.config.ts.`,
    );
  }
}
