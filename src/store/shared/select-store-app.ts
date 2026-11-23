// Loads the Launch project and picks the one app a store command should use.

import { launchConfigForApp, loadConfig } from '@/config/config.js';
import { errorMessage } from '@/services/platform/error-message.js';
import { readLaunchDirectories } from '@/services/platform/paths.js';
import { LaunchPrompt } from '@/services/platform/prompt.js';
import { checkTerminalIsInteractive } from '@/services/platform/progress.js';
import type { AppDescriptor } from '@/types/app.js';
import type { LaunchConfig } from '@/types/config.js';

/** Selecting an app for a store command failed. */
type StoreAppSelectionFailure = Readonly<{
  readonly _tag: 'StoreAppSelectionFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

export function makeStoreAppSelectionFailure(fields: {
  message: string;
  cause: unknown;
}): StoreAppSelectionFailure {
  return { _tag: 'StoreAppSelectionFailure', ...fields };
}

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
    throw makeStoreAppSelectionFailure({
      message: 'No apps found. Run Launch from a repo containing at least one app.json.',
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
  let loadedConfiguration: { config: LaunchConfig; apps: readonly AppDescriptor[] };

  try {
    loadedConfiguration = await loadConfig(launchPaths.workingDirectory);
  } catch (cause) {
    throw makeStoreAppSelectionFailure({
      message: 'Could not load the Launch configuration.',
      cause,
    });
  }

  const hasNoApps = loadedConfiguration.apps.length == 0;

  if (hasNoApps) {
    throw makeStoreAppSelectionFailure({
      message: 'No apps found. Run Launch from a repo containing at least one app.json.',
      cause: 'no-apps',
    });
  }

  if (appSelector != null) {
    const selectedApp = loadedConfiguration.apps.find(matchesSelector(appSelector));

    if (selectedApp != null) {
      return withAppLaunch(loadedConfiguration.config, selectedApp);
    }

    throw makeStoreAppSelectionFailure({
      message: `App "${appSelector}" not found. Available: ${loadedConfiguration.apps.map(appNameOf).join(', ')}.`,
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
    throw makeStoreAppSelectionFailure({
      message: 'More than one app found. Pass --app <name> to choose non-interactively.',
      cause: 'app-selection-required',
    });
  }

  try {
    const selectedApp = await LaunchPrompt.select({
      message: `Which app? (${loadedConfiguration.apps.length} found)`,
      choices: loadedConfiguration.apps.map(choiceFor),
    });

    return withAppLaunch(loadedConfiguration.config, selectedApp);
  } catch (cause) {
    const failureMessage = errorMessage(cause);
    throw makeStoreAppSelectionFailure({ message: failureMessage, cause });
  }
}

/** Select one discovered app from its loaded project context. */
export async function selectStoreApp(appSelector: string | undefined): Promise<AppDescriptor> {
  const storeAppContext = await loadStoreAppContext(appSelector);

  return storeAppContext.app;
}

/** Resolve the selected app's iOS bundle identifier. */
export async function resolveStoreBundleId(appSelector: string | undefined): Promise<string> {
  const selectedApp = await selectStoreApp(appSelector);

  if (selectedApp.bundleId != null) {
    return selectedApp.bundleId;
  }

  throw makeStoreAppSelectionFailure({
    message: `No iOS bundle identifier for ${selectedApp.name} (set ios.bundleIdentifier in app.json).`,
    cause: selectedApp,
  });
}
