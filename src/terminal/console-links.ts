import { loadConfig, type LoadedConfig } from '../config/config.ts';
import { executeCommand } from '../services/platform/exec.ts';
import { hasMessage } from '../services/platform/error-message.ts';
import { detectHostOperatingSystem } from '../services/platform/os.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { isApplePlatform, parsePlatform } from '../services/stores/platform.ts';
import { createAscClientResolver } from '../store/shared/store-clients.ts';
import { selectApps } from '../store/shared/sync-jobs.ts';
import type { AppDescriptor, OpenTarget, Platform } from '../types/app.ts';
import { PLAY_CONSOLE_URL } from './play-console-urls.ts';

export const OPEN_TARGETS: readonly OpenTarget[] = [
  'asc',
  'play',
  'testflight',
  'listing',
  'reviews',
  'agreements',
  'app-record',
];

type OpenUrlOptions = Readonly<{
  platform?: string;
  app?: string;
}>;

type ConsoleLinkFailure = Readonly<{
  readonly _tag: 'ConsoleLinkFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

interface AppleAppLookup {
  getAppId(bundleId: string): Promise<string | null>;
}

const ASC_ORIGIN = 'https://appstoreconnect.apple.com';

function makeConsoleLinkFailure(fields: {
  operation: string;
  message: string;
  cause?: unknown;
}): ConsoleLinkFailure {
  if (fields.cause == null) {
    return { _tag: 'ConsoleLinkFailure', operation: fields.operation, message: fields.message };
  }

  return {
    _tag: 'ConsoleLinkFailure',
    operation: fields.operation,
    message: fields.message,
    cause: fields.cause,
  };
}

function isNonEmptyText(cause: unknown): cause is string {
  if (typeof cause != 'string') {
    return false;
  }

  return cause.length > 0;
}

function consoleLinkFailure(operation: string, cause: unknown): ConsoleLinkFailure {
  let message = `${operation} failed.`;

  if (isNonEmptyText(cause)) {
    message = cause;
  }

  if (hasMessage(cause)) {
    message = cause.message;
  }

  return makeConsoleLinkFailure({ operation, message, cause });
}

function appStoreSectionUrl(target: OpenTarget, appId: string): string {
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
    case 'agreements':
      return appBase;
  }
}

function appStoreConnectUrl(target: OpenTarget, appId: string | undefined): string {
  if (target == 'agreements') {
    return `${ASC_ORIGIN}/agreements/`;
  }

  if (appId == null) {
    return `${ASC_ORIGIN}/apps`;
  }

  return appStoreSectionUrl(target, appId);
}

export function buildConsoleUrl(
  target: OpenTarget,
  platform: Platform,
  appId: string | undefined,
): string {
  if (target == 'play') {
    return PLAY_CONSOLE_URL;
  }

  if (platform == 'android') {
    return PLAY_CONSOLE_URL;
  }

  return appStoreConnectUrl(target, appId);
}

export function parseOpenTarget(targetText: string | undefined): OpenTarget {
  if (targetText == null) {
    return 'asc';
  }

  function isKnownTarget(knownTarget: OpenTarget): boolean {
    return knownTarget == targetText;
  }

  const matchedTarget = OPEN_TARGETS.find(isKnownTarget);

  if (matchedTarget != null) {
    return matchedTarget;
  }

  throw makeConsoleLinkFailure({
    operation: 'parse open target',
    message: `Unknown target "${targetText}". Use one of: ${OPEN_TARGETS.join(', ')}.`,
    cause: targetText,
  });
}

function readFlaggedOpenPlatform(platformFlag: string): 'ios' | 'android' {
  try {
    const parsedPlatform = parsePlatform(platformFlag);

    if (isApplePlatform(parsedPlatform)) {
      return 'ios';
    }

    return 'android';
  } catch (cause) {
    throw consoleLinkFailure('parse open platform', cause);
  }
}

export function resolveOpenPlatform(
  target: OpenTarget,
  platformFlag: string | undefined,
): 'ios' | 'android' {
  if (platformFlag != null) {
    return readFlaggedOpenPlatform(platformFlag);
  }

  if (target == 'play') {
    return 'android';
  }

  return 'ios';
}

function hasOpenIdentifier(platform: Platform, discoveredApp: AppDescriptor): boolean {
  if (platform == 'ios') {
    return discoveredApp.bundleId != null;
  }

  return discoveredApp.packageName != null;
}

export async function selectOpenApp(
  discoveredApps: AppDescriptor[],
  platform: Platform,
  appSelector: string | undefined,
): Promise<AppDescriptor> {
  let selectedApps: readonly AppDescriptor[] = [];

  try {
    selectedApps = await selectApps(discoveredApps, appSelector);
  } catch (cause) {
    throw consoleLinkFailure('select app to open', cause);
  }

  function isOpenPlatformApp(discoveredApp: AppDescriptor): boolean {
    return hasOpenIdentifier(platform, discoveredApp);
  }

  const selectedApp = selectedApps.find(isOpenPlatformApp);

  if (selectedApp != null) {
    return selectedApp;
  }

  let identifierLabel = 'android.package';

  const isIosPlatform = platform == 'ios';

  if (isIosPlatform) {
    identifierLabel = 'ios.bundleIdentifier';
  }

  let selectorDetails = '';

  const hasAppSelector = appSelector != null;

  if (hasAppSelector) {
    selectorDetails = ` matching "${appSelector}"`;
  }

  throw makeConsoleLinkFailure({
    operation: 'select app to open',
    message: `No ${platform} app found${selectorDetails}. Add an ${identifierLabel} in app.json.`,
    cause: appSelector,
  });
}

async function connectAppleStore(): Promise<AppleAppLookup | null> {
  const readAppleStore = createAscClientResolver();

  try {
    return await readAppleStore();
  } catch (cause) {
    throw consoleLinkFailure('connect to App Store Connect', cause);
  }
}

async function lookupAppleAppId(
  appleStore: AppleAppLookup,
  bundleId: string,
): Promise<string | undefined> {
  try {
    const lookedUpAppId = await appleStore.getAppId(bundleId);

    if (lookedUpAppId == null) {
      return undefined;
    }

    return lookedUpAppId;
  } catch (cause) {
    // A failed lookup still opens the apps list.
    const lookupFailed = cause != null;

    if (lookupFailed) {
      return undefined;
    }

    return undefined;
  }
}

async function readOpenAppId(
  platform: 'ios' | 'android',
  selectedApp: AppDescriptor,
): Promise<string | undefined> {
  const isIosApp = platform == 'ios';

  if (isIosApp == false) {
    return undefined;
  }

  const bundleId = selectedApp.bundleId;

  if (bundleId == null) {
    return undefined;
  }

  const appleStore = await connectAppleStore();

  if (appleStore == null) {
    return undefined;
  }

  return lookupAppleAppId(appleStore, bundleId);
}

export async function resolveOpenUrl(
  rawTarget: string | undefined,
  openOptions: OpenUrlOptions,
): Promise<string> {
  const target = parseOpenTarget(rawTarget);
  const platform = resolveOpenPlatform(target, openOptions.platform);
  const launchPaths = readLaunchDirectories();
  let loadedConfiguration: LoadedConfig;

  try {
    loadedConfiguration = await loadConfig(launchPaths.workingDirectory);
  } catch (cause) {
    throw consoleLinkFailure('load configuration for console link', cause);
  }

  const selectedApp = await selectOpenApp(loadedConfiguration.apps, platform, openOptions.app);
  const appId = await readOpenAppId(platform, selectedApp);

  return buildConsoleUrl(target, platform, appId);
}

export async function openUrl(url: string): Promise<void> {
  const hostOperatingSystem = detectHostOperatingSystem();

  switch (hostOperatingSystem) {
    case 'macos':
      await executeCommand('open', [url]);
      return;
    case 'linux':
      await executeCommand('xdg-open', [url]);
      return;
    case 'windows':
      await executeCommand('cmd', ['/c', 'start', '', url]);
      return;
  }
}
