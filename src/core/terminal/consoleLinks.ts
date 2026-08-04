import { Data, Effect } from 'effect';
import { loadConfig } from '../config/config.js';
import { executeCommand, provideNodeCommandServices } from '../services/exec.js';
import { detectHostOperatingSystem } from '../services/os.js';
import { LaunchPaths } from '../services/paths.js';
import { isApplePlatform, parsePlatform } from '../services/platform.js';
import type { ActiveAppleStoreRequirements } from '../store/appleStoreCommand.js';
import { selectApps } from '../store/syncJobs.js';
import { createAscClientResolver } from '../store/storeClients.js';
import type { AppDescriptor, OpenTarget, Platform } from '../types/app.js';

export const OPEN_TARGETS: readonly OpenTarget[] = [
  'asc',
  'play',
  'testflight',
  'listing',
  'reviews',
  'agreements',
  'app-record',
];

export type OpenUrlOptions = Readonly<{
  platform?: string;
  app?: string;
}>;

/** Resolving or opening a store-console link failed. */
export type ConsoleLinkFailure = Readonly<{
  readonly _tag: 'ConsoleLinkFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;
export const makeConsoleLinkFailure = Data.tagged<ConsoleLinkFailure>('ConsoleLinkFailure');

const ASC_ORIGIN = 'https://appstoreconnect.apple.com';
const PLAY_CONSOLE_URL = 'https://play.google.com/console';

/** Convert a dependency failure into the console-link channel. */
const consoleLinkFailure = (operation: string, cause: unknown): ConsoleLinkFailure => {
  let message = `${operation} failed.`;
  if (typeof cause === 'string' && cause.length > 0) message = cause;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makeConsoleLinkFailure({ operation, message, cause });
};

/** Build an App Store Connect URL, falling back to the apps list without an app id. */
const appStoreConnectUrl = (target: OpenTarget, appId: string | undefined): string => {
  if (target === 'agreements') return `${ASC_ORIGIN}/agreements/`;
  if (appId === undefined) return `${ASC_ORIGIN}/apps`;
  const appBase = `${ASC_ORIGIN}/apps/${appId}`;
  switch (target) {
    case 'testflight':
      return `${appBase}/testflight/ios`;
    case 'listing':
      return `${appBase}/appstore`;
    case 'reviews':
      return `${appBase}/ratings-and-reviews/ios`;
    case 'asc':
    case 'play':
    case 'app-record':
      return appBase;
  }
};

/** Build the web-console URL for a resolved target and platform. */
export const buildConsoleUrl = (
  target: OpenTarget,
  platform: Platform,
  appId: string | undefined,
): string => {
  if (target === 'play') return PLAY_CONSOLE_URL;
  if (platform === 'android') return PLAY_CONSOLE_URL;
  return appStoreConnectUrl(target, appId);
};

/** Validate the optional target, defaulting to App Store Connect. */
export const parseOpenTarget = (
  targetText: string | undefined,
): Effect.Effect<OpenTarget, ConsoleLinkFailure> => {
  if (targetText === undefined) return Effect.succeed('asc');
  const matchedTarget = OPEN_TARGETS.find((knownTarget) => knownTarget === targetText);
  if (matchedTarget !== undefined) return Effect.succeed(matchedTarget);
  return Effect.fail(
    makeConsoleLinkFailure({
      operation: 'parse open target',
      message: `Unknown target "${targetText}". Use one of: ${OPEN_TARGETS.join(', ')}.`,
      cause: targetText,
    }),
  );
};

/** Resolve the explicit platform or the target-based default. */
export const resolveOpenPlatform = (
  target: OpenTarget,
  platformFlag: string | undefined,
): Effect.Effect<'ios' | 'android', ConsoleLinkFailure> =>
  Effect.gen(function* () {
    if (platformFlag !== undefined) {
      const parsedPlatform = yield* parsePlatform(platformFlag).pipe(
        Effect.mapError((cause) => consoleLinkFailure('parse open platform', cause)),
      );
      if (isApplePlatform(parsedPlatform)) return 'ios';
      return 'android';
    }
    if (target === 'play') return 'android';
    return 'ios';
  });

/** Pick the selected app that has an identifier for the target platform. */
export const selectOpenApp = (
  discoveredApps: AppDescriptor[],
  platform: Platform,
  appSelector: string | undefined,
): Effect.Effect<AppDescriptor, ConsoleLinkFailure> =>
  Effect.gen(function* () {
    const selectedApps = yield* selectApps(discoveredApps, appSelector).pipe(
      Effect.mapError((cause) => consoleLinkFailure('select app to open', cause)),
    );
    const selectedApp = selectedApps.find((discoveredApp) => {
      if (platform === 'ios') return discoveredApp.bundleId !== undefined;
      return discoveredApp.packageName !== undefined;
    });
    if (selectedApp !== undefined) return selectedApp;
    let identifierLabel = 'android.package';
    if (platform === 'ios') identifierLabel = 'ios.bundleIdentifier';
    let selectorDetails = '';
    if (appSelector !== undefined) selectorDetails = ` matching "${appSelector}"`;
    return yield* Effect.fail(
      makeConsoleLinkFailure({
        operation: 'select app to open',
        message: `No ${platform} app found${selectorDetails}. Add an ${identifierLabel} in app.json.`,
        cause: appSelector,
      }),
    );
  });

/** Resolve open-command input to one store-console URL. */
export const resolveOpenUrl = (
  rawTarget: string | undefined,
  openOptions: OpenUrlOptions,
): Effect.Effect<string, ConsoleLinkFailure, ActiveAppleStoreRequirements> =>
  Effect.gen(function* () {
    const target = yield* parseOpenTarget(rawTarget);
    const platform = yield* resolveOpenPlatform(target, openOptions.platform);
    const launchPaths = yield* LaunchPaths;
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory).pipe(
      Effect.mapError((cause) => consoleLinkFailure('load configuration for console link', cause)),
    );
    const selectedApp = yield* selectOpenApp(loadedConfiguration.apps, platform, openOptions.app);
    let appId: string | undefined;
    if (platform === 'ios' && selectedApp.bundleId !== undefined) {
      const resolveAppleStore = createAscClientResolver();
      const appleStore = yield* resolveAppleStore().pipe(
        Effect.mapError((cause) => consoleLinkFailure('connect to App Store Connect', cause)),
      );
      if (appleStore !== null) {
        const resolvedAppId = yield* appleStore
          .getAppId(selectedApp.bundleId)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (resolvedAppId !== null) appId = resolvedAppId;
      }
    }
    return buildConsoleUrl(target, platform, appId);
  });

/** Open a URL with the host platform's shell-free browser command. */
export const openUrl = (url: string): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const hostOperatingSystem = yield* detectHostOperatingSystem;
    switch (hostOperatingSystem) {
      case 'macos':
        return yield* provideNodeCommandServices(executeCommand('open', [url]));
      case 'linux':
        return yield* provideNodeCommandServices(executeCommand('xdg-open', [url]));
      case 'windows':
        return yield* provideNodeCommandServices(executeCommand('cmd', ['/c', 'start', '', url]));
    }
  });
