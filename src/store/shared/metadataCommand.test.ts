import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActiveAscKey } from '../../credentials/accounts.js';
import { loadServiceAccount } from '../../credentials/androidKeystore.js';
import { resetLogger, useLoggerSink } from '../../services/platform/logger.js';
import { AppleStoreClientService } from '../../services/stores/appleStoreClient.js';
import { GoogleStoreClientService } from '../../services/stores/googleStoreClient.js';
import type { AppDescriptor } from '../../types/app.js';
import type { LaunchConfig } from '../../types/config.js';
import type { PlayListing } from '../../types/googlePlay.js';
import {
  assertListingPlatform,
  metadataCommandProgram,
  MetadataCommandInputSchema,
  pullAppleListing,
} from './metadataCommand.js';
import { loadStoreAppContext } from './selectStoreApp.js';

vi.mock('./selectStoreApp.js', () => ({ loadStoreAppContext: vi.fn() }));
vi.mock('../../credentials/accounts.js', () => ({ loadActiveAscKey: vi.fn() }));
vi.mock('../../credentials/androidKeystore.js', () => ({
  loadServiceAccount: vi.fn(),
  describeMissingPlayServiceAccount: vi.fn(async () => 'No Play service account.'),
}));

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

  return {
    getAppId: vi.fn(readAppId),
    getCurrentAppInfoId: vi.fn(async () => 'appinfo1'),
    getCurrentVersionId: vi.fn(async () => 'version1'),
    getEditableAppInfoId: vi.fn(async () => 'appinfo1'),
    getEditableVersionId: vi.fn(async () => 'version1'),
    listAppInfoLocalizations: vi.fn(
      async () => [] as { id: string; locale: string; fields: Record<string, string> }[],
    ),
    listVersionLocalizations: vi.fn(
      async () => [] as { id: string; locale: string; fields: Record<string, string> }[],
    ),
    createAppInfoLocalization: vi.fn(async () => undefined),
    createVersionLocalization: vi.fn(async () => undefined),
    updateAppInfoLocalization: vi.fn(async () => undefined),
    updateVersionLocalization: vi.fn(async () => undefined),
  };
}

function makePlayClientFake() {
  return {
    listListings: vi.fn(async () => [] as PlayListing[]),
    updateListings: vi.fn(
      async (_packageName: string, _listings: readonly PlayListing[]) => undefined,
    ),
  };
}

let appleReads = makeAppleReads();
let playClientFake = makePlayClientFake();
const createEffectAppleClient = vi.spyOn(AppleStoreClientService, 'createEffectClient');
const createEffectPlayClient = vi.spyOn(GoogleStoreClientService, 'createEffectClient');

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

describe('MetadataCommandInputSchema', () => {
  it('decodes a pull with omitted optional selectors', () => {
    expect(MetadataCommandInputSchema({ operation: 'pull', dryRun: true })).toEqual({
      operation: 'pull',
      dryRun: true,
    });
  });

  it('rejects an explicit undefined exact optional platform', () => {
    expect(() =>
      MetadataCommandInputSchema({
        operation: 'push',
        platform: undefined,
        dryRun: false,
      }),
    ).toThrow();
  });
});

describe('assertListingPlatform', () => {
  it('allows the iOS and Android listing adapters', () => {
    expect(() => assertListingPlatform('ios')).not.toThrow();
    expect(() => assertListingPlatform('android')).not.toThrow();
  });

  it('rejects unsupported Apple listing targets', () => {
    for (const platform of ['tvos', 'macos', 'visionos'] as const) {
      expect(() => assertListingPlatform(platform)).toThrow(
        /syncs the iOS and Android store listing only/,
      );
    }
  });
});

describe('metadataCommandProgram', () => {
  let workspaceDirectory = '';
  let appDirectory = '';
  let configPath = '';
  let terminalWrites: string[] = [];

  function writeStoreConfig(storeConfig: unknown): void {
    writeFileSync(configPath, `${JSON.stringify(storeConfig, null, 2)}\n`);
  }

  function readStoreConfig(): unknown {
    return JSON.parse(readFileSync(configPath, 'utf8'));
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

  beforeEach(() => {
    workspaceDirectory = mkdtempSync(join(tmpdir(), 'launch-metadata-cmd-'));
    appDirectory = join(workspaceDirectory, 'apps', 'demo');
    mkdirSync(appDirectory, { recursive: true });
    configPath = join(appDirectory, 'store.config.json');
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
  });

  afterEach(() => {
    resetLogger();
    rmSync(workspaceDirectory, { recursive: true, force: true });
  });

  it('fails decode before contacting the store', async () => {
    const commandFailure = await failRawCommand({ operation: 'pull' });
    expect(commandFailure).toMatchObject({
      _tag: 'MetadataCommandFailure',
      operation: 'decode metadata command input',
    });
    expect(loadStoreAppContext).not.toHaveBeenCalled();
  });

  it('rejects listing platforms without a store listing API', async () => {
    const commandFailure = await failRawCommand({
      operation: 'pull',
      platform: 'tvos',
      dryRun: true,
    });
    expect(commandFailure).toMatchObject({
      message: expect.stringMatching(/iOS and Android store listing only/),
    });
    expect(loadStoreAppContext).not.toHaveBeenCalled();
  });

  it('requires a bundle identifier before App Store pull', async () => {
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
  });

  it('requires an Android package before Play pull', async () => {
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
  });

  it('fails App Store pull when no active Apple account is configured', async () => {
    vi.mocked(loadActiveAscKey).mockResolvedValue(null);
    const commandFailure = await failCommand('pull', 'ios', true);
    expect(commandFailure).toMatchObject({
      operation: 'load active Apple account',
      message: expect.stringMatching(/No active Apple account/),
    });
    expect(createEffectAppleClient).not.toHaveBeenCalled();
  });

  it('fails Play pull when no service account is configured', async () => {
    vi.mocked(loadServiceAccount).mockResolvedValue(null);
    const commandFailure = await failCommand('pull', 'android', true);
    expect(commandFailure).toMatchObject({
      operation: 'load Play service account',
      message: expect.stringMatching(/No Play service account/),
    });
    expect(createEffectPlayClient).not.toHaveBeenCalled();
  });

  it('refuses App Store push when store.config.json has no apple section', async () => {
    writeStoreConfig({ android: { info: { 'en-US': { title: 'Demo' } } } });
    const commandFailure = await failCommand('push', 'ios', true);
    expect(commandFailure).toMatchObject({
      operation: 'read App Store metadata',
      message: expect.stringMatching(/no "apple" section/),
    });
    expect(createEffectAppleClient).not.toHaveBeenCalled();
  });

  it('refuses Play push when store.config.json has no android section', async () => {
    writeStoreConfig({ apple: { info: { 'en-US': { title: 'Demo' } } } });
    const commandFailure = await failCommand('push', 'android', true);
    expect(commandFailure).toMatchObject({
      operation: 'read Play metadata',
      message: expect.stringMatching(/no "android" section/),
    });
    expect(createEffectPlayClient).not.toHaveBeenCalled();
  });

  it('refuses push when store.config.json is missing', async () => {
    const commandFailure = await failCommand('push', 'ios', true);
    expect(commandFailure).toMatchObject({
      message: expect.stringMatching(/No store\.config\.json/),
    });
    expect(commandFailure).toMatchObject({
      message: expect.stringMatching(/launch metadata pull/),
    });
  });

  describe('App Store pull', () => {
    beforeEach(() => {
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
    });

    it('reads the live listing and merges it into store.config.json', async () => {
      writeStoreConfig({ android: { info: { 'en-US': { title: 'Droid' } } } });
      await runCommand('pull', 'ios', false);
      expect(createEffectAppleClient).toHaveBeenCalledWith(ascKey);
      expect(readStoreConfig()).toEqual({
        android: { info: { 'en-US': { title: 'Droid' } } },
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
      expect(terminalWrites.join('')).toMatch(/wrote App Store listing/);
    });

    it('keeps the configured App Store categories, which a pull does not read', async () => {
      writeStoreConfig({ apple: { info: { 'en-US': { title: 'Old' } }, categories: ['GAMES'] } });
      await runCommand('pull', 'ios', false);
      expect(readStoreConfig()).toMatchObject({
        apple: { info: { 'en-US': { title: 'Demo' } }, categories: ['GAMES'] },
      });
    });

    it('dry-run reads the store and reports locales without writing the config', async () => {
      await runCommand('pull', 'ios', true);
      expect(existsSync(configPath)).toBe(false);
      expect(terminalWrites.join('')).toMatch(/would write 1 App Store locale\(s\)/);
    });

    it('fails when the app has no App Store Connect record', async () => {
      appleReads.getAppId.mockResolvedValue(null);
      const commandFailure = await failCommand('pull', 'ios', false);
      expect(commandFailure).toMatchObject({
        message: expect.stringMatching(/No App Store Connect app for com\.demo\.app/),
      });
      expect(existsSync(configPath)).toBe(false);
    });

    it('is callable for adopt-style pulls', async () => {
      await pullAppleListing('com.demo.app', configPath, false);
      expect(existsSync(configPath)).toBe(true);
    });
  });

  describe('App Store push', () => {
    beforeEach(() => {
      vi.mocked(loadActiveAscKey).mockResolvedValue(ascKey);
      writeStoreConfig({
        apple: { info: { 'en-US': { title: 'Demo', description: 'A demo app' } } },
      });
    });

    it('dry-run prints the planned actions and writes nothing to the store', async () => {
      await runCommand('push', 'ios', true);
      const output = terminalWrites.join('');
      expect(output).toMatch(/planned: create listing \[en-US\] App Info/);
      expect(output).toMatch(/planned: create listing \[en-US\] App Store version/);
      expect(output).toMatch(/nothing was written to App Store Connect/);
      expect(appleReads.createAppInfoLocalization).not.toHaveBeenCalled();
      expect(appleReads.createVersionLocalization).not.toHaveBeenCalled();
    });

    it('writes the listing through the App Store Connect client', async () => {
      await runCommand('push', 'ios', false);
      expect(appleReads.createAppInfoLocalization).toHaveBeenCalledWith('appinfo1', 'en-US', {
        name: 'Demo',
      });
      expect(appleReads.createVersionLocalization).toHaveBeenCalledWith('version1', 'en-US', {
        description: 'A demo app',
      });
      expect(terminalWrites.join('')).toMatch(/pushed App Store listing for com\.demo\.app/);
    });

    it('fails when the app has no App Store Connect record', async () => {
      appleReads.getAppId.mockResolvedValue(null);
      const commandFailure = await failCommand('push', 'ios', false);
      expect(commandFailure).toMatchObject({
        message: expect.stringMatching(/No App Store Connect app|app record/i),
      });
      expect(appleReads.createAppInfoLocalization).not.toHaveBeenCalled();
    });

    it('fails when a listing write fails', async () => {
      appleReads.createAppInfoLocalization.mockRejectedValue(new Error('rejected by Apple'));
      const commandFailure = await failCommand('push', 'ios', false);
      expect(commandFailure).toMatchObject({
        message: expect.stringMatching(/rejected by Apple/),
      });
    });
  });

  describe('Play pull', () => {
    beforeEach(() => {
      vi.mocked(loadServiceAccount).mockResolvedValue(serviceAccountJson);
      playClientFake.listListings.mockResolvedValue([
        { language: 'en-US', title: 'Demo', shortDescription: 'short', fullDescription: 'full' },
        { language: 'de-DE' },
      ]);
    });

    it('reads the live listings and merges them into store.config.json', async () => {
      writeStoreConfig({ apple: { info: { 'en-US': { title: 'Demo' } } } });
      await runCommand('pull', 'android', false);
      expect(createEffectPlayClient).toHaveBeenCalledWith(serviceAccountJson);
      expect(playClientFake.listListings).toHaveBeenCalledWith('com.demo.app');
      expect(readStoreConfig()).toEqual({
        apple: { info: { 'en-US': { title: 'Demo' } } },
        android: {
          info: { 'en-US': { title: 'Demo', shortDescription: 'short', fullDescription: 'full' } },
        },
      });
    });

    it('dry-run reads the store and reports locales without writing the config', async () => {
      await runCommand('pull', 'android', true);
      expect(existsSync(configPath)).toBe(false);
      expect(terminalWrites.join('')).toMatch(/would write 1 Play locale\(s\)/);
    });
  });

  describe('Play push', () => {
    beforeEach(() => {
      vi.mocked(loadServiceAccount).mockResolvedValue(serviceAccountJson);
      writeStoreConfig({
        android: {
          info: {
            'en-US': { title: 'Demo', shortDescription: 'short' },
            'de-DE': { fullDescription: 'voll' },
          },
        },
      });
    });

    it('dry-run prints the planned listings and never contacts Google Play', async () => {
      await runCommand('push', 'android', true);
      const output = terminalWrites.join('');
      expect(output).toMatch(/planned: update Play listing en-US \(title, shortDescription\)/);
      expect(output).toMatch(/planned: update Play listing de-DE \(fullDescription\)/);
      expect(output).toMatch(/nothing was written to Google Play/);
      expect(createEffectPlayClient).not.toHaveBeenCalled();
      expect(playClientFake.updateListings).not.toHaveBeenCalled();
    });

    it('updates every listing through the Play client in one call', async () => {
      await runCommand('push', 'android', false);
      expect(playClientFake.updateListings).toHaveBeenCalledTimes(1);
      expect(playClientFake.updateListings).toHaveBeenCalledWith('com.demo.app', [
        { language: 'en-US', title: 'Demo', shortDescription: 'short' },
        { language: 'de-DE', fullDescription: 'voll' },
      ]);
      expect(terminalWrites.join('')).toMatch(/pushed 2 Play listing\(s\) for com\.demo\.app/);
    });

    it('fails when the Play update fails', async () => {
      playClientFake.updateListings.mockRejectedValue(new Error('Play said no'));
      const commandFailure = await failCommand('push', 'android', false);
      expect(commandFailure).toMatchObject({
        operation: 'upload Play listings',
        message: expect.stringMatching(/Play said no/),
      });
    });
  });
});
