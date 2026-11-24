// Picks the app and applies the variables one build is allowed to see.

import type { AppDescriptor, BuildProfile } from '../types/app.ts';
import { pickOne, type PickOneArgs } from '../services/platform/prompt.ts';
import { readLastApp } from '../distribution/last-run.ts';
import { readBuildSecrets } from './build-secrets.ts';
import {
  keepBuildEnvironment,
  missingKeys,
  readEnv,
  type LaunchEnvironment,
} from '../config/environment-file.ts';
import type { Logger } from '../services/platform/logger.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import { hasMessage } from '../services/platform/error-message.ts';

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

    throw new Error(`App "${appName}" not found. Available: ${availableNames.join(', ')}.`);
  }

  return namedApp;
}

/** Pick the app to build: an explicit `--app`, the sole discovered app */
export async function selectApp(
  apps: readonly AppDescriptor[],
  appName: string | undefined,
): Promise<AppDescriptor> {
  const hasNoApps = apps.length == 0;

  if (hasNoApps) {
    throw new Error('No apps found. Run Launch from a repo containing at least one app.json.');
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
  } catch (cause) {
    const hasCauseMessage = hasMessage(cause);

    if (hasCauseMessage) {
      throw new Error(cause.message, { cause });
    }

    throw new Error('Could not choose an app.', { cause });
  }
}

type CommandEnvironmentRequest = {
  app: AppDescriptor;
  profile: BuildProfile;
  cliEnv?: Record<string, string> | undefined;
  includeLocal?: boolean | undefined;
  envExclude?: readonly string[] | undefined;
};

/** Read keychain, dotenv, profile env, and --env flags for a command. */
export async function readCommandEnv(
  request: CommandEnvironmentRequest,
): Promise<LaunchEnvironment> {
  try {
    var secrets = await readBuildSecrets(request.app.name, request.profile.name);
  } catch (error) {
    throw new Error(`Could not resolve build secrets for ${request.app.name}.`, { cause: error });
  }

  const commandEnvironment = await readEnv({
    appDir: request.app.dir,
    profileName: request.profile.name,
    profileEnv: request.profile.env,
    envFile: request.profile.envFile,
    secrets,
    cliEnv: request.cliEnv,
    includeLocal: request.includeLocal,
    envExclude: request.envExclude,
  });

  return commandEnvironment;
}

/** Hard-fail on missing `.env.example` keys, then drop file secrets from the build env. */
export async function checkLaunchEnvironment(
  appDir: string,
  commandEnvironment: LaunchEnvironment,
  log: Logger,
  exclude: readonly string[] = [],
): Promise<LaunchEnvironment> {
  try {
    var missing = await missingKeys(appDir, commandEnvironment.values, exclude);
  } catch (error) {
    throw new Error(`Could not read ${appDir}/.env.example.`, { cause: error });
  }

  const hasMissingKeys = missing.length > 0;

  if (hasMissingKeys) {
    throw new Error(`Missing ${missing.length} env keys that .env.example lists.`);
  }

  return applyBuildEnvironment(commandEnvironment, log);
}

/** Keep keychain and `--env` secrets. Leave file and profile secrets out of the build. */
export function applyBuildEnvironment(
  commandEnvironment: LaunchEnvironment,
  log: Logger,
): LaunchEnvironment {
  const kept = keepBuildEnvironment(commandEnvironment);
  const hasOmitted = kept.omittedCount > 0;

  if (hasOmitted) {
    log.warn(
      `Left ${kept.omittedCount} secret-looking names out of the build. A build-time one belongs in the keychain via launch-store secret set. A backend-only one belongs in envExclude.`,
    );
  }

  return kept.environment;
}
