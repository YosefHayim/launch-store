import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActiveAscKey } from '../../credentials/accounts.ts';
import { loadServiceAccount } from '../../credentials/android-keystore-assets.ts';
import { resetLogger, useLoggerSink } from '../../services/platform/logger.ts';
import { AppleStoreClientService } from '../../services/stores/apple-store-client.ts';
import { GoogleStoreClientService } from '../../services/stores/google-store-client.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type { PlayListing } from '../../types/google-play.ts';
import type { StoreConfig } from './store-config.ts';
import {
  assertListingPlatform,
  metadataCommandProgram,
  MetadataCommandInputSchema,
  pullAppleListing,
} from './metadata-command.ts';
import { loadStoreAppContext } from './select-store-app.ts';

vi.mock('./select-store-app.ts', function mockSelectStoreApp() {
  return { loadStoreAppContext: vi.fn() };
});
vi.mock('../../credentials/accounts.ts', function mockAccounts() {
  return { loadActiveAscKey: vi.fn() };
});
vi.mock('../../credentials/android-keystore-assets.ts', function mockAndroidKeystoreAssets() {
  return {
    loadServiceAccount: vi.fn(),
    describeMissingPlayServiceAccount: vi.fn(async () => 'No Play service account.'),
  };
});

const stubLaunchConfig: LaunchConfig = {
  profiles: {},
  credentials: 'local',
  storage: 'local',
  buildEngine: 'xcode',
  submit: 'app-store-connect',
};

const ascKey = { keyId: 'KEY', issuerId: 'ISS', p8: 'pem' };
const serviceAccountJson = '{"type":"service_account"}';

function makeApp(appOverrides: Partial<AppDescriptor> & Pick<AppDescriptor, 'dir'>): AppDescriptor {
  return {
    name: 'demo',
    configPath: join(appOverrides.dir, 'app.json'),
    ...appOverrides,
  };
}

function makeAppleReads() {
  async function readAppId(): Promise<string | null> {
    return 'app1';
  }

  async function mockCall() {
    return 'appinfo1';
  }

  async function mockCall2() {
    return 'version1';
  }

  async function mockCall3() {
    return 'appinfo1';
  }

  async function mockCall4() {
    return 'version1';
  }

  async function mockCall5() {
    return [] as { id: string; locale: string; fields: Record<string, string> }[];
  }

  async function mockCall6() {
    return [] as { id: string; locale: string; fields: Record<string, string> }[];
  }

  async function mockCall7() {
    return undefined;
  }

  async function mockCall8() {
    return undefined;
  }

  async function mockCall9() {
    return undefined;
  }

  async function mockCall10() {
    return undefined;
  }

  return {
    getAppId: vi.fn(readAppId),
    getCurrentAppInfoId: vi.fn(mockCall),
    getCurrentVersionId: vi.fn(mockCall2),
    getEditableAppInfoId: vi.fn(mockCall3),
    getEditableVersionId: vi.fn(mockCall4),
    listAppInfoLocalizations: vi.fn(mockCall5),
    listVersionLocalizations: vi.fn(mockCall6),
    createAppInfoLocalization: vi.fn(mockCall7),
    createVersionLocalization: vi.fn(mockCall8),
    updateAppInfoLocalization: vi.fn(mockCall9),
    updateVersionLocalization: vi.fn(mockCall10),
  };
}

function makePlayClientFake() {
  async function mockCall11() {
    return [] as PlayListing[];
  }

  async function mockCall12(_packageName: string, _listings: readonly PlayListing[]) {
    return undefined;
  }

  return {
    listListings: vi.fn(mockCall11),
    updateListings: vi.fn(mockCall12),
  };
}

let appleReads = makeAppleReads();
let playClientFake = makePlayClientFake();
const createEffectAppleClient = vi.spyOn(AppleStoreClientService.prototype, 'createClient');
const createEffectPlayClient = vi.spyOn(GoogleStoreClientService.prototype, 'createClient');

function installStoreFakes(): void {
  appleReads = makeAppleReads();
  playClientFake = makePlayClientFake();
  createEffectAppleClient.mockReset();
  createEffectAppleClient.mockImplementation(function createAppleClient() {
    return appleReads as never;
  });
  createEffectPlayClient.mockReset();
  createEffectPlayClient.mockReturnValue(playClientFake as never);
}

function describeMetadataCommandPieceSchema() {
  function decodesAPullWithOmittedOptionalSelectors() {
    const metadataCommandSchema = MetadataCommandInputSchema({ operation: 'pull', dryRun: true });

    expect(metadataCommandSchema).toEqual({
      operation: 'pull',
      dryRun: true,
    });
  }

  it('decodes a pull with omitted optional selectors', decodesAPullWithOmittedOptionalSelectors);

  function rejectsAnExplicitUndefinedExactOptionalPlatform() {
    function callMetadataCommandPieceSchema() {
      return MetadataCommandInputSchema({
        operation: 'push',
        platform: undefined,
        dryRun: false,
      });
    }

    expect(callMetadataCommandPieceSchema).toThrow();
  }

  it(
    'rejects an explicit undefined exact optional platform',
    rejectsAnExplicitUndefinedExactOptionalPlatform,
  );
}

describe('MetadataCommandInputSchema', describeMetadataCommandPieceSchema);

function describeAssertListingPlatform() {
  function allowsTheIOSAndAndroidListingAdapters() {
    function callAssertListingPlatform() {
      return assertListingPlatform('ios');
    }

    expect(callAssertListingPlatform).not.toThrow();

    function callAssertListingPlatform2() {
      return assertListingPlatform('android');
    }

    expect(callAssertListingPlatform2).not.toThrow();
  }

  it('allows the iOS and Android listing adapters', allowsTheIOSAndAndroidListingAdapters);

  function rejectsUnsupportedAppleListingTargets() {
    for (const platform of ['tvos', 'macos', 'visionos'] as const) {
      function callAssertListingPlatform3() {
        return assertListingPlatform(platform);
      }

      expect(callAssertListingPlatform3).toThrow(/syncs the iOS and Android store listing only/);
    }
  }

  it('rejects unsupported Apple listing targets', rejectsUnsupportedAppleListingTargets);
}

describe('assertListingPlatform', describeAssertListingPlatform);

function describeMetadataCommandProgram() {
  let workspaceDirectory = '';
  let appDirectory = '';
  let configPath = '';
  let terminalWrites: string[] = [];

  function writeStoreConfig(storeConfig: StoreConfig): void {
    vi.mocked(loadStoreAppContext).mockResolvedValue({
      config: {
        ...stubLaunchConfig,
        listing: { 'com.demo.app': storeConfig },
      },
      app: makeApp({
        dir: appDirectory,
        bundleId: 'com.demo.app',
        packageName: 'com.demo.app',
      }),
    });
  }

  function printedListing(): unknown {
    function startsWithObject(text: string) {
      return text.trimStart().startsWith('{');
    }

    const listingText = terminalWrites.find(startsWithObject);

    if (listingText == null) {
      throw new Error('expected a printed listing');
    }

    return JSON.parse(listingText);
  }

  function runCommand(operation: 'pull' | 'push', platform: 'ios' | 'android', dryRun: boolean) {
    return metadataCommandProgram({ operation, platform, dryRun, config: configPath });
  }

  async function failCommand(
    operation: 'pull' | 'push',
    platform: 'ios' | 'android',
    dryRun: boolean,
  ) {
    try {
      await runCommand(operation, platform, dryRun);
    } catch (error) {
      return error;
    }

    throw new Error('expected the metadata command to fail');
  }

  async function failRawCommand(rawCommandInput: unknown) {
    try {
      await metadataCommandProgram(rawCommandInput);
    } catch (error) {
      return error;
    }

    throw new Error('expected the metadata command to fail');
  }

  function prepareMetadataCommandProgram() {
    const systemTemporaryDirectory = tmpdir();
    const launchMetadataCmdPath = join(systemTemporaryDirectory, 'launch-metadata-cmd-');

    workspaceDirectory = mkdtempSync(launchMetadataCmdPath);
    appDirectory = join(workspaceDirectory, 'apps', 'demo');
    mkdirSync(appDirectory, { recursive: true });
    configPath = join(appDirectory, 'launch.config.ts');
    terminalWrites = [];
    useLoggerSink(function captureTerminal(text: string) {
      terminalWrites.push(text);
    });
    vi.clearAllMocks();
    installStoreFakes();
    vi.mocked(loadStoreAppContext).mockResolvedValue({
      config: stubLaunchConfig,
      app: makeApp({
        dir: appDirectory,
        bundleId: 'com.demo.app',
        packageName: 'com.demo.app',
      }),
    });
  }

  beforeEach(prepareMetadataCommandProgram);

  function cleanupMetadataCommandProgram() {
    resetLogger();
    rmSync(workspaceDirectory, { recursive: true, force: true });
  }

  afterEach(cleanupMetadataCommandProgram);

  async function failsDecodeBeforeContactingTheStore() {
    const commandFailure = await failRawCommand({ operation: 'pull' });

    expect(commandFailure).toMatchObject({
      _tag: 'MetadataCommandFailure',
      operation: 'decode metadata command input',
    });
    expect(loadStoreAppContext).not.toHaveBeenCalled();
  }

  it('fails decode before contacting the store', failsDecodeBeforeContactingTheStore);

  async function rejectsListingPlatformsWithoutAStoreListingAPI() {
    const commandFailure = await failRawCommand({
      operation: 'pull',
      platform: 'tvos',
      dryRun: true,
    });

    expect(commandFailure).toMatchObject({
      message: expect.stringMatching(/iOS and Android store listing only/),
    });
    expect(loadStoreAppContext).not.toHaveBeenCalled();
  }

  it(
    'rejects listing platforms without a store listing API',
    rejectsListingPlatformsWithoutAStoreListingAPI,
  );

  async function requiresABundleIdentifierBeforeAppStorePull() {
    vi.mocked(loadStoreAppContext).mockResolvedValue({
      config: stubLaunchConfig,
      app: makeApp({ dir: appDirectory, name: 'no-bundle' }),
    });

    const commandFailure = await failRawCommand({
      operation: 'pull',
      platform: 'ios',
      dryRun: true,
    });

    expect(commandFailure).toMatchObject({
      operation: 'resolve App Store listing',
      message: expect.stringMatching(/bundle identifier/),
    });
  }

  it(
    'requires a bundle identifier before App Store pull',
    requiresABundleIdentifierBeforeAppStorePull,
  );

  async function requiresAnAndroidPackageBeforePlayPull() {
    vi.mocked(loadStoreAppContext).mockResolvedValue({
      config: stubLaunchConfig,
      app: makeApp({ dir: appDirectory, name: 'no-package' }),
    });

    const commandFailure = await failRawCommand({
      operation: 'pull',
      platform: 'android',
      dryRun: true,
    });

    expect(commandFailure).toMatchObject({
      operation: 'resolve Play listing',
      message: expect.stringMatching(/android\.package/),
    });
  }

  it('requires an Android package before Play pull', requiresAnAndroidPackageBeforePlayPull);

  async function failsAppStorePullWhenNoActiveAppleAccountIsConfigured() {
    vi.mocked(loadActiveAscKey).mockResolvedValue(null);

    const commandFailure = await failCommand('pull', 'ios', true);

    expect(commandFailure).toMatchObject({
      operation: 'load active Apple account',
      message: expect.stringMatching(/No active Apple account/),
    });
    expect(createEffectAppleClient).not.toHaveBeenCalled();
  }

  it(
    'fails App Store pull when no active Apple account is configured',
    failsAppStorePullWhenNoActiveAppleAccountIsConfigured,
  );

  async function failsPlayPullWhenNoServiceAccountIsConfigured() {
    vi.mocked(loadServiceAccount).mockResolvedValue(null);

    const commandFailure = await failCommand('pull', 'android', true);

    expect(commandFailure).toMatchObject({
      operation: 'load Play service account',
      message: expect.stringMatching(/No Play service account/),
    });
    expect(createEffectPlayClient).not.toHaveBeenCalled();
  }

  it(
    'fails Play pull when no service account is configured',
    failsPlayPullWhenNoServiceAccountIsConfigured,
  );

  async function refusesAppStorePushWhenStorePiecePieceHasNoAppleSection() {
    writeStoreConfig({ android: { info: { 'en-US': { title: 'Demo' } } } });

    const commandFailure = await failCommand('push', 'ios', true);

    expect(commandFailure).toMatchObject({
      operation: 'read App Store metadata',
      message: expect.stringMatching(/No App Store listing for com\.demo\.app/),
    });
    expect(createEffectAppleClient).not.toHaveBeenCalled();
  }

  it(
    'refuses App Store push when launch.config.ts has no apple listing',
    refusesAppStorePushWhenStorePiecePieceHasNoAppleSection,
  );

  async function refusesPlayPushWhenStorePiecePieceHasNoAndroidSection() {
    writeStoreConfig({ apple: { info: { 'en-US': { title: 'Demo' } } } });

    const commandFailure = await failCommand('push', 'android', true);

    expect(commandFailure).toMatchObject({
      operation: 'read Play metadata',
      message: expect.stringMatching(/No Play listing for com\.demo\.app/),
    });
    expect(createEffectPlayClient).not.toHaveBeenCalled();
  }

  it(
    'refuses Play push when launch.config.ts has no Play listing',
    refusesPlayPushWhenStorePiecePieceHasNoAndroidSection,
  );

  async function refusesPushWhenStorePiecePieceIsMissing() {
    const commandFailure = await failCommand('push', 'ios', true);

    expect(commandFailure).toMatchObject({
      message: expect.stringMatching(/No App Store listing for com\.demo\.app/),
    });
    expect(commandFailure).toMatchObject({
      message: expect.stringMatching(/launch\.config\.ts/),
    });
  }

  it('refuses push when launch.config.ts has no listing', refusesPushWhenStorePiecePieceIsMissing);

  function describeAppStorePull() {
    function prepareAppStorePull() {
      vi.mocked(loadActiveAscKey).mockResolvedValue(ascKey);
      appleReads.listAppInfoLocalizations.mockResolvedValue([
        { id: 'ai-en', locale: 'en-US', fields: { name: 'Demo', subtitle: 'Sub' } },
      ]);
      appleReads.listVersionLocalizations.mockResolvedValue([
        {
          id: 'v-en',
          locale: 'en-US',
          fields: { description: 'A demo app', keywords: 'fast, local', whatsNew: 'v1' },
        },
      ]);
    }

    beforeEach(prepareAppStorePull);

    async function readsTheLiveListingAndMergesItIntoStorePiecePiece() {
      await runCommand('pull', 'ios', false);
      expect(createEffectAppleClient).toHaveBeenCalledWith(ascKey);

      expect(printedListing()).toEqual({
        apple: {
          info: {
            'en-US': {
              title: 'Demo',
              subtitle: 'Sub',
              description: 'A demo app',
              keywords: ['fast', 'local'],
              releaseNotes: 'v1',
            },
          },
        },
      });
      expect(existsSync(configPath)).toBe(false);
      expect(terminalWrites.join('')).toMatch(/listing\.com\.demo\.app/);
    }

    it(
      'prints the live App Store listing to paste under listing',
      readsTheLiveListingAndMergesItIntoStorePiecePiece,
    );

    async function keepsTheConfiguredAppStoreCategoriesWhichAPullDoesNotRead() {
      await runCommand('pull', 'ios', false);
      const printed = printedListing() as { apple?: { categories?: string[] } };

      expect(printed.apple?.categories).toBeUndefined();
      expect(existsSync(configPath)).toBe(false);
    }

    it(
      'prints the live listing without categories, which a pull does not read',
      keepsTheConfiguredAppStoreCategoriesWhichAPullDoesNotRead,
    );

    async function dryRunReadsTheStoreAndReportsLocalesWithoutWritingThePiece() {
      await runCommand('pull', 'ios', true);
      const pathExists = existsSync(configPath);
      expect(pathExists).toBe(false);
      expect(terminalWrites.join('')).toMatch(/would add 1 App Store locale/);
    }

    it(
      'dry-run reads the store and reports locales without writing the config',
      dryRunReadsTheStoreAndReportsLocalesWithoutWritingThePiece,
    );

    async function failsWhenTheAppHasNoAppStoreConnectPiece() {
      appleReads.getAppId.mockResolvedValue(null);

      const commandFailure = await failCommand('pull', 'ios', false);

      expect(commandFailure).toMatchObject({
        message: expect.stringMatching(/No App Store Connect app for com\.demo\.app/),
      });

      const pathExists = existsSync(configPath);

      expect(pathExists).toBe(false);
    }

    it(
      'fails when the app has no App Store Connect record',
      failsWhenTheAppHasNoAppStoreConnectPiece,
    );

    async function isCallableForAdoptStylePulls() {
      await pullAppleListing('com.demo.app', false);
      const pathExists = existsSync(configPath);

      expect(pathExists).toBe(false);
      expect(printedListing()).toMatchObject({
        apple: { info: { 'en-US': { title: 'Demo' } } },
      });
    }

    it('is callable for adopt-style pulls', isCallableForAdoptStylePulls);
  }

  describe('App Store pull', describeAppStorePull);

  function describeAppStorePush() {
    function prepareAppStorePush() {
      vi.mocked(loadActiveAscKey).mockResolvedValue(ascKey);
      writeStoreConfig({
        apple: { info: { 'en-US': { title: 'Demo', description: 'A demo app' } } },
      });
    }

    beforeEach(prepareAppStorePush);

    async function dryRunPrintsThePlannedActionsAndWritesNothingToTheStore() {
      await runCommand('push', 'ios', true);

      const output = terminalWrites.join('');

      expect(output).toMatch(/planned: create listing \[en-US\] App Info/);
      expect(output).toMatch(/planned: create listing \[en-US\] App Store version/);
      expect(output).toMatch(/nothing was written to App Store Connect/);
      expect(appleReads.createAppInfoLocalization).not.toHaveBeenCalled();
      expect(appleReads.createVersionLocalization).not.toHaveBeenCalled();
    }

    it(
      'dry-run prints the planned actions and writes nothing to the store',
      dryRunPrintsThePlannedActionsAndWritesNothingToTheStore,
    );

    async function writesTheListingThroughTheAppStoreConnectClient() {
      await runCommand('push', 'ios', false);
      expect(appleReads.createAppInfoLocalization).toHaveBeenCalledWith('appinfo1', 'en-US', {
        name: 'Demo',
      });
      expect(appleReads.createVersionLocalization).toHaveBeenCalledWith('version1', 'en-US', {
        description: 'A demo app',
      });
      expect(terminalWrites.join('')).toMatch(/pushed App Store listing for com\.demo\.app/);
    }

    it(
      'writes the listing through the App Store Connect client',
      writesTheListingThroughTheAppStoreConnectClient,
    );

    async function failsWhenTheAppHasNoAppStoreConnectPiece2() {
      appleReads.getAppId.mockResolvedValue(null);

      const commandFailure = await failCommand('push', 'ios', false);

      expect(commandFailure).toMatchObject({
        message: expect.stringMatching(/No App Store Connect app|app record/i),
      });
      expect(appleReads.createAppInfoLocalization).not.toHaveBeenCalled();
    }

    it(
      'fails when the app has no App Store Connect record',
      failsWhenTheAppHasNoAppStoreConnectPiece2,
    );

    async function failsWhenAListingWriteFails() {
      appleReads.createAppInfoLocalization.mockRejectedValue(new Error('rejected by Apple'));

      const commandFailure = await failCommand('push', 'ios', false);

      expect(commandFailure).toMatchObject({
        message: expect.stringMatching(/rejected by Apple/),
      });
    }

    it('fails when a listing write fails', failsWhenAListingWriteFails);
  }

  describe('App Store push', describeAppStorePush);

  function describePlayPull() {
    function preparePlayPull() {
      vi.mocked(loadServiceAccount).mockResolvedValue(serviceAccountJson);
      playClientFake.listListings.mockResolvedValue([
        { language: 'en-US', title: 'Demo', shortDescription: 'short', fullDescription: 'full' },
        { language: 'de-DE' },
      ]);
    }

    beforeEach(preparePlayPull);

    async function readsTheLiveListingsAndMergesThemIntoStorePiecePiece() {
      await runCommand('pull', 'android', false);
      expect(createEffectPlayClient).toHaveBeenCalledWith(serviceAccountJson);
      expect(playClientFake.listListings).toHaveBeenCalledWith('com.demo.app');

      expect(printedListing()).toEqual({
        android: {
          info: { 'en-US': { title: 'Demo', shortDescription: 'short', fullDescription: 'full' } },
        },
      });
      expect(existsSync(configPath)).toBe(false);
    }

    it(
      'prints the live Play listing to paste under listing',
      readsTheLiveListingsAndMergesThemIntoStorePiecePiece,
    );

    async function dryRunReadsTheStoreAndReportsLocalesWithoutWritingThePiece2() {
      await runCommand('pull', 'android', true);
      const pathExists = existsSync(configPath);
      expect(pathExists).toBe(false);
      expect(terminalWrites.join('')).toMatch(/would add 1 Play locale/);
    }

    it(
      'dry-run reads the store and reports locales without writing the config',
      dryRunReadsTheStoreAndReportsLocalesWithoutWritingThePiece2,
    );
  }

  describe('Play pull', describePlayPull);

  function describePlayPush() {
    function preparePlayPush() {
      vi.mocked(loadServiceAccount).mockResolvedValue(serviceAccountJson);
      writeStoreConfig({
        android: {
          info: {
            'en-US': { title: 'Demo', shortDescription: 'short' },
            'de-DE': { fullDescription: 'voll' },
          },
        },
      });
    }

    beforeEach(preparePlayPush);

    async function dryRunPrintsThePlannedListingsAndNeverContactsGooglePlay() {
      await runCommand('push', 'android', true);

      const output = terminalWrites.join('');

      expect(output).toMatch(/planned: update Play listing en-US \(title, shortDescription\)/);
      expect(output).toMatch(/planned: update Play listing de-DE \(fullDescription\)/);
      expect(output).toMatch(/nothing was written to Google Play/);
      expect(createEffectPlayClient).not.toHaveBeenCalled();
      expect(playClientFake.updateListings).not.toHaveBeenCalled();
    }

    it(
      'dry-run prints the planned listings and never contacts Google Play',
      dryRunPrintsThePlannedListingsAndNeverContactsGooglePlay,
    );

    async function updatesEveryListingThroughThePlayClientInOneCall() {
      await runCommand('push', 'android', false);
      expect(playClientFake.updateListings).toHaveBeenCalledTimes(1);
      expect(playClientFake.updateListings).toHaveBeenCalledWith('com.demo.app', [
        { language: 'en-US', title: 'Demo', shortDescription: 'short' },
        { language: 'de-DE', fullDescription: 'voll' },
      ]);
      expect(terminalWrites.join('')).toMatch(/pushed 2 Play listing\(s\) for com\.demo\.app/);
    }

    it(
      'updates every listing through the Play client in one call',
      updatesEveryListingThroughThePlayClientInOneCall,
    );

    async function failsWhenThePlayUpdateFails() {
      playClientFake.updateListings.mockRejectedValue(new Error('Play said no'));

      const commandFailure = await failCommand('push', 'android', false);

      expect(commandFailure).toMatchObject({
        operation: 'upload Play listings',
        message: expect.stringMatching(/Play said no/),
      });
    }

    it('fails when the Play update fails', failsWhenThePlayUpdateFails);
  }

  describe('Play push', describePlayPush);
}

describe('metadataCommandProgram', describeMetadataCommandProgram);
