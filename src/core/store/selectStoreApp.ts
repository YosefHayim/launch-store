import { type FileSystem, type Path, Terminal } from '@effect/platform';
import { Data, Effect } from 'effect';
import { loadConfig } from '../config/config.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { AppDescriptor } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';

/** Selecting an app for a store command failed. */
export type StoreAppSelectionFailure = Readonly<{
  readonly _tag: 'StoreAppSelectionFailure';
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeStoreAppSelectionFailure = Data.tagged<StoreAppSelectionFailure>(
  'StoreAppSelectionFailure',
);

export type StoreAppSelectionRequirements =
  | FileSystem.FileSystem
  | LaunchPathsService
  | LaunchPromptService
  | Path.Path
  | Terminal.Terminal;

/** Loaded Launch configuration paired with the selected app. */
export type StoreAppContext = Readonly<{
  config: LaunchConfig;
  app: AppDescriptor;
}>;

/** Load the project and select one app without guessing in a non-interactive terminal. */
export const loadStoreAppContext = (
  appSelector: string | undefined,
): Effect.Effect<StoreAppContext, StoreAppSelectionFailure, StoreAppSelectionRequirements> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory).pipe(
      Effect.mapError((cause) =>
        makeStoreAppSelectionFailure({
          message: 'Could not load the Launch configuration.',
          cause,
        }),
      ),
    );
    if (loadedConfiguration.apps.length === 0) {
      return yield* Effect.fail(
        makeStoreAppSelectionFailure({
          message: 'No apps found. Run Launch from a repo containing at least one app.json.',
          cause: 'no-apps',
        }),
      );
    }
    if (appSelector !== undefined) {
      const selectedApp = loadedConfiguration.apps.find(
        (discoveredApp) => discoveredApp.name === appSelector,
      );
      if (selectedApp !== undefined) {
        return { config: loadedConfiguration.config, app: selectedApp };
      }
      return yield* Effect.fail(
        makeStoreAppSelectionFailure({
          message: `App "${appSelector}" not found. Available: ${loadedConfiguration.apps
            .map((discoveredApp) => discoveredApp.name)
            .join(', ')}.`,
          cause: appSelector,
        }),
      );
    }
    const onlyApp = loadedConfiguration.apps[0];
    if (loadedConfiguration.apps.length === 1 && onlyApp !== undefined) {
      return { config: loadedConfiguration.config, app: onlyApp };
    }
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        makeStoreAppSelectionFailure({
          message: 'More than one app found. Pass --app <name> to choose non-interactively.',
          cause: 'app-selection-required',
        }),
      );
    }
    const prompt = yield* LaunchPrompt;
    const selectedApp = yield* prompt
      .select({
        message: `Which app? (${loadedConfiguration.apps.length} found)`,
        choices: loadedConfiguration.apps.map((discoveredApp) => {
          let hint = discoveredApp.packageName;
          if (discoveredApp.bundleId !== undefined) hint = discoveredApp.bundleId;
          if (hint === undefined) {
            return { selection: discoveredApp, label: discoveredApp.name };
          }
          return { selection: discoveredApp, label: discoveredApp.name, hint };
        }),
      })
      .pipe(
        Effect.mapError((cause) => makeStoreAppSelectionFailure({ message: cause.message, cause })),
      );
    return { config: loadedConfiguration.config, app: selectedApp };
  });

/** Select one discovered app from its loaded project context. */
export const selectStoreApp = (
  appSelector: string | undefined,
): Effect.Effect<AppDescriptor, StoreAppSelectionFailure, StoreAppSelectionRequirements> =>
  loadStoreAppContext(appSelector).pipe(Effect.map((storeAppContext) => storeAppContext.app));

/** Resolve the selected app's iOS bundle identifier. */
export const resolveStoreBundleId = (
  appSelector: string | undefined,
): Effect.Effect<string, StoreAppSelectionFailure, StoreAppSelectionRequirements> =>
  Effect.gen(function* () {
    const selectedApp = yield* selectStoreApp(appSelector);
    if (selectedApp.bundleId !== undefined) return selectedApp.bundleId;
    return yield* Effect.fail(
      makeStoreAppSelectionFailure({
        message: `No iOS bundle identifier for ${selectedApp.name} (set ios.bundleIdentifier in app.json).`,
        cause: selectedApp,
      }),
    );
  });
