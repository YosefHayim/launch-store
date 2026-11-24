// Builds App Store Connect and Google Play page links and opens one in the browser.

import { loadConfig, type LoadedConfig } from '../config/config.ts';
import { executeCommand } from '../services/platform/execute-command.ts';
import { hasMessage } from '../services/platform/error-message.ts';
import { detectHostOperatingSystem } from '../services/platform/host-operating-system.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { isApplePlatform, parsePlatform } from '../services/stores/platform.ts';
import { createAscClientResolver } from '../store/shared/store-clients.ts';
import { selectApps } from '../store/shared/sync-jobs.ts';
import type { AppDescriptor, OpenTarget, Platform } from '../types/app.ts';

const PLAY_CONSOLE_URL = 'https://play.google.com/console';
const ASC_ORIGIN = 'https://appstoreconnect.apple.com';

interface AppleAppLookup {
  getAppId(bundleId: string): Promise<string | null>;
}

export class ConsoleLinks {
  readonly openTargets: readonly OpenTarget[] = [
    'asc',
    'play',
    'testflight',
    'listing',
    'reviews',
    'agreements',
    'app-record',
  ];

  appStoreSectionUrl(target: OpenTarget, appId: string): string {
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

  playUsersAndPermissionsUrl(developerId?: string): string {
    if (developerId == null) {
      return `${PLAY_CONSOLE_URL}/developers/users-and-permissions`;
    }

    const developerAccount = encodeURIComponent(developerId);

    return `${PLAY_CONSOLE_URL}/u/0/developers/${developerAccount}/users-and-permissions`;
  }

  playPaymentsProfileUrl(developerId?: string): string {
    if (developerId == null) {
      return `${PLAY_CONSOLE_URL}/developers/paymentssettings`;
    }

    const developerAccount = encodeURIComponent(developerId);

    return `${PLAY_CONSOLE_URL}/u/0/developers/${developerAccount}/paymentssettings`;
  }

  consolePageUrl(target: OpenTarget, platform: Platform, appId: string | undefined): string {
    if (target == 'play') {
      return PLAY_CONSOLE_URL;
    }

    if (platform == 'android') {
      return PLAY_CONSOLE_URL;
    }

    return this.appStoreConnectUrl(target, appId);
  }

  parseOpenTarget(targetText: string | undefined): OpenTarget {
    if (targetText == null) {
      return 'asc';
    }

    function isKnownTarget(knownTarget: OpenTarget): boolean {
      return knownTarget == targetText;
    }

    const matchedTarget = this.openTargets.find(isKnownTarget);

    if (matchedTarget != null) {
      return matchedTarget;
    }

    const knownTargets = this.openTargets.join(', ');

    throw new Error(`Unknown target "${targetText}". Use one of: ${knownTargets}.`, {
      cause: targetText,
    });
  }

  resolveOpenPlatform(target: OpenTarget, platformFlag: string | undefined): 'ios' | 'android' {
    if (platformFlag != null) {
      return this.readFlaggedOpenPlatform(platformFlag);
    }

    if (target == 'play') {
      return 'android';
    }

    return 'ios';
  }

  async selectOpenApp(
    discoveredApps: AppDescriptor[],
    platform: Platform,
    appSelector: string | undefined,
  ): Promise<AppDescriptor> {
    let selectedApps: readonly AppDescriptor[] = [];

    try {
      selectedApps = await selectApps(discoveredApps, appSelector);
    } catch (cause) {
      throw this.consoleLinkError('select app to open', cause);
    }

    const consoleLinks = this;

    function isOpenPlatformApp(discoveredApp: AppDescriptor): boolean {
      return consoleLinks.hasOpenIdentifier(platform, discoveredApp);
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

    throw new Error(
      `No ${platform} app found${selectorDetails}. Add an ${identifierLabel} in app.json.`,
    );
  }

  async resolveOpenUrl(
    rawTarget: string | undefined,
    openChoice: { platform?: string; app?: string },
  ): Promise<string> {
    const target = this.parseOpenTarget(rawTarget);
    const platform = this.resolveOpenPlatform(target, openChoice.platform);
    const launchPaths = readLaunchDirectories();
    let loadedLaunchFile: LoadedConfig;

    try {
      loadedLaunchFile = await loadConfig(launchPaths.workingDirectory);
    } catch (cause) {
      throw this.consoleLinkError('load configuration for console link', cause);
    }

    const selectedApp = await this.selectOpenApp(loadedLaunchFile.apps, platform, openChoice.app);
    const appId = await this.readOpenAppId(platform, selectedApp);

    return this.consolePageUrl(target, platform, appId);
  }

  async openUrl(url: string): Promise<void> {
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

  private appStoreConnectUrl(target: OpenTarget, appId: string | undefined): string {
    if (target == 'agreements') {
      return `${ASC_ORIGIN}/agreements/`;
    }

    if (appId == null) {
      return `${ASC_ORIGIN}/apps`;
    }

    return this.appStoreSectionUrl(target, appId);
  }

  private readFlaggedOpenPlatform(platformFlag: string): 'ios' | 'android' {
    try {
      const parsedPlatform = parsePlatform(platformFlag);
      const isApple = isApplePlatform(parsedPlatform);

      if (isApple) {
        return 'ios';
      }

      return 'android';
    } catch (cause) {
      throw this.consoleLinkError('parse open platform', cause);
    }
  }

  private hasOpenIdentifier(platform: Platform, discoveredApp: AppDescriptor): boolean {
    if (platform == 'ios') {
      return discoveredApp.bundleId != null;
    }

    return discoveredApp.packageName != null;
  }

  private async connectAppleStore(): Promise<AppleAppLookup | null> {
    const readAppleStore = createAscClientResolver();

    try {
      return await readAppleStore();
    } catch (cause) {
      throw this.consoleLinkError('connect to App Store Connect', cause);
    }
  }

  private async lookupAppleAppId(
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

  private async readOpenAppId(
    platform: 'ios' | 'android',
    selectedApp: AppDescriptor,
  ): Promise<string | undefined> {
    const isAndroid = platform == 'android';

    if (isAndroid) {
      return undefined;
    }

    const bundleId = selectedApp.bundleId;

    if (bundleId == null) {
      return undefined;
    }

    const appleStore = await this.connectAppleStore();

    if (appleStore == null) {
      return undefined;
    }

    return this.lookupAppleAppId(appleStore, bundleId);
  }

  private consoleLinkError(operation: string, cause: unknown): Error {
    let message = `${operation} failed.`;

    if (typeof cause == 'string') {
      const hasCauseText = cause.length > 0;

      if (hasCauseText) {
        message = cause;
      }
    }

    if (hasMessage(cause)) {
      message = cause.message;
    }

    return new Error(message, { cause });
  }
}
