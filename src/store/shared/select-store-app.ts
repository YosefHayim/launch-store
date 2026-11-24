// Loads the Launch project and picks the one app a store command should use.

import { launchConfigForApp, loadConfig } from '../../config/config.ts';
import { errorMessage } from '../../services/platform/error-message.ts';
import { readLaunchDirectories } from '../../services/platform/paths.ts';
import { LaunchPrompt } from '../../services/platform/prompt.ts';
import { checkTerminalIsInteractive } from '../../services/platform/progress.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { LaunchConfig } from '../../types/config.ts';

/** Loaded Launch configuration paired with the selected app. */
type StoreAppContext = Readonly<{
  config: LaunchConfig;
  app: AppDescriptor;
}>;

function appNameOf(discoveredApp: AppDescriptor): string {
  return discoveredApp.name;
}

function choiceFor(discoveredApp: AppDescriptor) {
  let hint = discoveredApp.packageName;

  if (discoveredApp.bundleId != null) {
    hint = discoveredApp.bundleId;
  }

  if (hint == null) {
    return { selection: discoveredApp, label: discoveredApp.name };
  }

  return { selection: discoveredApp, label: discoveredApp.name, hint };
}

async function withAppLaunch(
  fallbackConfig: LaunchConfig,
  selectedApp: AppDescriptor,
): Promise<StoreAppContext> {
  const appLaunch = await launchConfigForApp(fallbackConfig, selectedApp.dir);

  return { config: appLaunch, app: selectedApp };
}

async function oneDiscoveredApp(
  fallbackConfig: LaunchConfig,
  onlyApp: AppDescriptor | undefined,
): Promise<StoreAppContext> {
  if (onlyApp == null) {
    throw new Error('No apps found. Run Launch from a repo containing at least one app.json.', {
      cause: 'no-apps',
    });
  }

  return withAppLaunch(fallbackConfig, onlyApp);
}

function matchesSelector(appSelector: string) {
  return function isSelectedApp(discoveredApp: AppDescriptor): boolean {
    return discoveredApp.name == appSelector;
  };
}

/** Load the project and select one app without guessing in a non-interactive terminal. */
export async function loadStoreAppContext(
  appSelector: string | undefined,
): Promise<StoreAppContext> {
  const launchPaths = readLaunchDirectories();
  try {
    var loadedConfiguration = await loadConfig(launchPaths.workingDirectory);
  } catch (cause) {
    throw new Error('Could not load the Launch configuration.', { cause });
  }

  const hasNoApps = loadedConfiguration.apps.length == 0;

  if (hasNoApps) {
    throw new Error('No apps found. Run Launch from a repo containing at least one app.json.', {
      cause: 'no-apps',
    });
  }

  if (appSelector != null) {
    const selectedApp = loadedConfiguration.apps.find(matchesSelector(appSelector));

    if (selectedApp != null) {
      return withAppLaunch(loadedConfiguration.config, selectedApp);
    }

    const availableAppNames = loadedConfiguration.apps.map(appNameOf).join(', ');

    throw new Error(`App "${appSelector}" not found. Available: ${availableAppNames}.`, {
      cause: appSelector,
    });
  }

  const onlyApp = loadedConfiguration.apps[0];

  const isOnlyApp = loadedConfiguration.apps.length == 1;

  if (isOnlyApp) {
    return oneDiscoveredApp(loadedConfiguration.config, onlyApp);
  }

  const isInteractive = checkTerminalIsInteractive();

  if (isInteractive == false) {
    throw new Error('More than one app found. Pass --app <name> to choose non-interactively.', {
      cause: 'app-selection-required',
    });
  }

  try {
    const selectedApp = await new LaunchPrompt().select({
      message: `Which app? (${loadedConfiguration.apps.length} found)`,
      choices: loadedConfiguration.apps.map(choiceFor),
    });

    return withAppLaunch(loadedConfiguration.config, selectedApp);
  } catch (cause) {
    const failureMessage = errorMessage(cause);
    throw new Error(failureMessage, { cause });
  }
}

/** Select one discovered app from its loaded project context. */
export async function selectStoreApp(appSelector: string | undefined): Promise<AppDescriptor> {
  const storeAppContext = await loadStoreAppContext(appSelector);

  return storeAppContext.app;
}

/** Read the selected app's iOS bundle identifier. */
export async function readStoreBundleId(appSelector: string | undefined): Promise<string> {
  const selectedApp = await selectStoreApp(appSelector);

  if (selectedApp.bundleId != null) {
    return selectedApp.bundleId;
  }

  throw new Error(
    `No iOS bundle identifier for ${selectedApp.name} (set ios.bundleIdentifier in app.json).`,
    { cause: selectedApp },
  );
}
