import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { makeAscCatalogApiFake } from '@testkit/ascCatalogApi.testkit.js';
import { Effect, Schema, unsafeCoerce } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppleStoreClientService,
  type EffectAppStoreConnectClient,
} from '../services/appleStoreClient.js';
import {
  type EffectGooglePlayClient,
  GoogleStoreClientService,
} from '../services/googleStoreClient.js';
import { makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { makeLaunchPromptTest } from '../services/prompt.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';
import type { AppDescriptor } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';
import type { PlayListing } from '../types/googlePlay.js';

vi.mock('./selectStoreApp.js', () => ({ loadStoreAppContext: vi.fn() }));
vi.mock('../credentials/accounts.js', () => ({ loadActiveAscKey: vi.fn() }));
vi.mock('../credentials/androidKeystore.js', () => ({ loadServiceAccount: vi.fn() }));

import { loadActiveAscKey } from '../credentials/accounts.js';
import { loadServiceAccount } from '../credentials/androidKeystore.js';
import {
  assertListingPlatform,
  metadataCommandProgram,
  MetadataCommandInputSchema,
  pullAppleListing,
} from './metadataCommand.js';
import { loadStoreAppContext } from './selectStoreApp.js';

const stubLaunchConfig: LaunchConfig = {
  profiles: {},
  credentials: 'local',
  storage: 'local',
  buildEngine: 'xcode',
  submit: 'app-store-connect',
};

const ascKey = { keyId: 'KEY', issuerId: 'ISS', p8: 'pem' };
const serviceAccountJson = '{"type":"service_account"}';

const makeApp = (
  appOverrides: Partial<AppDescriptor> & Pick<AppDescriptor, 'dir'>,
): AppDescriptor => ({
  name: 'demo',
  configPath: join(appOverrides.dir, 'app.json'),
  ...appOverrides,
});

const makePlayClientFake = () => ({
  listListings: vi.fn(() => Effect.succeed<PlayListing[]>([])),
  updateListings: vi.fn(
    (_packageName: string, _listings: readonly PlayListing[]): Effect.Effect<void, Error> =>
      Effect.void,
  ),
});

let ascCatalogApi = makeAscCatalogApiFake();
let playClientFake = makePlayClientFake();
const currentListingLookups = {
  getCurrentAppInfoId: vi.fn(() => Effect.succeed('appinfo1')),
  getCurrentVersionId: vi.fn(() => Effect.succeed('version1')),
};
const createEffectAppleClient = vi.fn((_ascKey: unknown) => {
  const ascClientFake = { ...ascCatalogApi, ...currentListingLookups };
  return Effect.succeed(unsafeCoerce<unknown, EffectAppStoreConnectClient>(ascClientFake));
});
const createEffectPlayClient = vi.fn((_serviceAccountJson: string) =>
  Effect.succeed(unsafeCoerce<unknown, EffectGooglePlayClient>(playClientFake)),
);

const appleStoreClientTest = unsafeCoerce<unknown, AppleStoreClientService>({
  createEffectClient: createEffectAppleClient,
});
const googleStoreClientTest = unsafeCoerce<unknown, GoogleStoreClientService>({
  createEffectClient: createEffectPlayClient,
});

const resetStoreFakes = (): void => {
  ascCatalogApi = makeAscCatalogApiFake();
  playClientFake = makePlayClientFake();
};

const runMetadata = <Success, Failure, Requirements>(
  program: Effect.Effect<Success, Failure, Requirements>,
  workingDirectory: string,
  terminalWrites: string[],
): Promise<Success> =>
  Effect.runPromise(
    unsafeCoerce<Effect.Effect<Success, Failure, Requirements>, Effect.Effect<Success, Failure>>(
      program.pipe(
        Effect.provideService(AppleStoreClientService, appleStoreClientTest),
        Effect.provideService(GoogleStoreClientService, googleStoreClientTest),
        Effect.provide(NodeContext.layer),
        Effect.provide(makeLaunchPathsTest(workingDirectory, workingDirectory)),
        Effect.provide(makeLaunchLoggerTest(terminalWrites)),
        Effect.provide(makeLaunchPromptTest()),
        Effect.provide(makeLaunchSecretStoreTest()),
      ),
    ),
  );

const flipMetadata = <Success, Failure, Requirements>(
  program: Effect.Effect<Success, Failure, Requirements>,
  workingDirectory: string,
  terminalWrites: string[] = [],
): Promise<Failure> => runMetadata(Effect.flip(program), workingDirectory, terminalWrites);

describe('MetadataCommandInputSchema', () => {
  it('decodes a pull with omitted optional selectors', () => {
    expect(
      Schema.decodeUnknownSync(MetadataCommandInputSchema)({
        operation: 'pull',
        dryRun: true,
      }),
    ).toEqual({ operation: 'pull', dryRun: true });
  });

  it('rejects an explicit undefined exact optional platform', () => {
    expect(() =>
      Schema.decodeUnknownSync(MetadataCommandInputSchema)({
        operation: 'push',
        platform: undefined,
        dryRun: false,
      }),
    ).toThrow();
  });
});

describe('assertListingPlatform', () => {
  it('allows the iOS and Android listing adapters', () => {
    expect(Effect.runSync(assertListingPlatform('ios'))).toBeUndefined();
    expect(Effect.runSync(assertListingPlatform('android'))).toBeUndefined();
  });

  it('rejects unsupported Apple listing targets', () => {
    for (const platform of ['tvos', 'macos', 'visionos'] as const) {
      const platformFailure = Effect.runSync(Effect.flip(assertListingPlatform(platform)));
      expect(platformFailure.message).toMatch(/syncs the iOS and Android store listing only/);
    }
  });
});

describe('metadataCommandProgram', () => {
  let workspaceDirectory = '';
  let appDirectory = '';
  let configPath = '';
  let terminalWrites: string[] = [];

  const writeStoreConfig = (storeConfig: unknown): void => {
    writeFileSync(configPath, `${JSON.stringify(storeConfig, null, 2)}\n`);
  };

  const readStoreConfig = (): unknown => JSON.parse(readFileSync(configPath, 'utf8'));

  const runCommand = (
    operation: 'pull' | 'push',
    platform: 'ios' | 'android',
    dryRun: boolean,
  ): Promise<void> =>
    runMetadata(
      metadataCommandProgram({ operation, platform, dryRun, config: configPath }),
      workspaceDirectory,
      terminalWrites,
    );

  const failCommand = (operation: 'pull' | 'push', platform: 'ios' | 'android', dryRun: boolean) =>
    flipMetadata(
      metadataCommandProgram({ operation, platform, dryRun, config: configPath }),
      workspaceDirectory,
    );

  beforeEach(() => {
    workspaceDirectory = mkdtempSync(join(tmpdir(), 'launch-metadata-cmd-'));
    appDirectory = join(workspaceDirectory, 'apps', 'demo');
    mkdirSync(appDirectory, { recursive: true });
    configPath = join(appDirectory, 'store.config.json');
    terminalWrites = [];
    vi.clearAllMocks();
    resetStoreFakes();
    vi.mocked(loadStoreAppContext).mockReturnValue(
      Effect.succeed({
        config: stubLaunchConfig,
        app: makeApp({
          dir: appDirectory,
          bundleId: 'com.demo.app',
          packageName: 'com.demo.app',
        }),
      }),
    );
  });

  afterEach(() => {
    rmSync(workspaceDirectory, { recursive: true, force: true });
  });

  it('fails decode before contacting the store', async () => {
    const commandFailure = await flipMetadata(
      metadataCommandProgram({ operation: 'pull' }),
      workspaceDirectory,
    );
    expect(commandFailure).toMatchObject({
      _tag: 'MetadataCommandFailure',
      operation: 'decode metadata command input',
    });
    expect(loadStoreAppContext).not.toHaveBeenCalled();
  });

  it('rejects listing platforms without a store listing API', async () => {
    const commandFailure = await flipMetadata(
      metadataCommandProgram({ operation: 'pull', platform: 'tvos', dryRun: true }),
      workspaceDirectory,
    );
    expect(commandFailure.message).toMatch(/iOS and Android store listing only/);
    expect(loadStoreAppContext).not.toHaveBeenCalled();
  });

  it('requires a bundle identifier before App Store pull', async () => {
    vi.mocked(loadStoreAppContext).mockReturnValue(
      Effect.succeed({
        config: stubLaunchConfig,
        app: makeApp({ dir: appDirectory, name: 'no-bundle' }),
      }),
    );
    const commandFailure = await flipMetadata(
      metadataCommandProgram({ operation: 'pull', platform: 'ios', dryRun: true }),
      workspaceDirectory,
    );
    expect(commandFailure).toMatchObject({
      operation: 'resolve App Store listing',
      message: expect.stringMatching(/bundle identifier/),
    });
  });

  it('requires an Android package before Play pull', async () => {
    vi.mocked(loadStoreAppContext).mockReturnValue(
      Effect.succeed({
        config: stubLaunchConfig,
        app: makeApp({ dir: appDirectory, name: 'no-package' }),
      }),
    );
    const commandFailure = await flipMetadata(
      metadataCommandProgram({ operation: 'pull', platform: 'android', dryRun: true }),
      workspaceDirectory,
    );
    expect(commandFailure).toMatchObject({
      operation: 'resolve Play listing',
      message: expect.stringMatching(/android\.package/),
    });
  });

  it('fails App Store pull when no active Apple account is configured', async () => {
    vi.mocked(loadActiveAscKey).mockReturnValue(Effect.succeed(null));
    const commandFailure = await failCommand('pull', 'ios', true);
    expect(commandFailure).toMatchObject({
      operation: 'load active Apple account',
      message: expect.stringMatching(/No active Apple account/),
    });
    expect(createEffectAppleClient).not.toHaveBeenCalled();
  });

  it('fails Play pull when no service account is configured', async () => {
    vi.mocked(loadServiceAccount).mockReturnValue(Effect.succeed(null));
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
    expect(commandFailure.message).toMatch(/No store\.config\.json/);
    expect(commandFailure.message).toMatch(/launch metadata pull/);
  });

  describe('App Store pull', () => {
    beforeEach(() => {
      vi.mocked(loadActiveAscKey).mockReturnValue(Effect.succeed(ascKey));
      ascCatalogApi = makeAscCatalogApiFake({
        listAppInfoLocalizations: vi.fn(() =>
          Effect.succeed([
            { id: 'ai-en', locale: 'en-US', fields: { name: 'Demo', subtitle: 'Sub' } },
          ]),
        ),
        listVersionLocalizations: vi.fn(() =>
          Effect.succeed([
            {
              id: 'v-en',
              locale: 'en-US',
              fields: { description: 'A demo app', keywords: 'fast, local', whatsNew: 'v1' },
            },
          ]),
        ),
      });
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
      ascCatalogApi = makeAscCatalogApiFake({ getAppId: vi.fn(() => Effect.succeed(null)) });
      const commandFailure = await failCommand('pull', 'ios', false);
      expect(commandFailure.message).toMatch(/No App Store Connect app for com\.demo\.app/);
      expect(existsSync(configPath)).toBe(false);
    });

    it('is callable for adopt-style pulls', async () => {
      await runMetadata(
        pullAppleListing('com.demo.app', configPath, false),
        workspaceDirectory,
        terminalWrites,
      );
      expect(existsSync(configPath)).toBe(true);
    });
  });

  describe('App Store push', () => {
    beforeEach(() => {
      vi.mocked(loadActiveAscKey).mockReturnValue(Effect.succeed(ascKey));
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
      expect(ascCatalogApi.createAppInfoLocalization).not.toHaveBeenCalled();
      expect(ascCatalogApi.createVersionLocalization).not.toHaveBeenCalled();
    });

    it('writes the listing through the App Store Connect client', async () => {
      await runCommand('push', 'ios', false);
      expect(ascCatalogApi.createAppInfoLocalization).toHaveBeenCalledWith('appinfo1', 'en-US', {
        name: 'Demo',
      });
      expect(ascCatalogApi.createVersionLocalization).toHaveBeenCalledWith('version1', 'en-US', {
        description: 'A demo app',
      });
      expect(terminalWrites.join('')).toMatch(/pushed App Store listing for com\.demo\.app/);
    });

    it('fails when the app has no App Store Connect record', async () => {
      ascCatalogApi = makeAscCatalogApiFake({ getAppId: vi.fn(() => Effect.succeed(null)) });
      const commandFailure = await failCommand('push', 'ios', false);
      expect(commandFailure.message).toMatch(/No App Store Connect app|app record/i);
      expect(ascCatalogApi.createAppInfoLocalization).not.toHaveBeenCalled();
    });

    it('fails when a listing write fails', async () => {
      ascCatalogApi = makeAscCatalogApiFake({
        createAppInfoLocalization: vi.fn(() => Effect.fail(new Error('rejected by Apple'))),
      });
      const commandFailure = await failCommand('push', 'ios', false);
      expect(commandFailure.message).toMatch(/rejected by Apple/);
    });
  });

  describe('Play pull', () => {
    beforeEach(() => {
      vi.mocked(loadServiceAccount).mockReturnValue(Effect.succeed(serviceAccountJson));
      playClientFake.listListings.mockReturnValue(
        Effect.succeed([
          { language: 'en-US', title: 'Demo', shortDescription: 'short', fullDescription: 'full' },
          { language: 'de-DE' },
        ]),
      );
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
      vi.mocked(loadServiceAccount).mockReturnValue(Effect.succeed(serviceAccountJson));
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
      playClientFake.updateListings.mockReturnValue(Effect.fail(new Error('Play said no')));
      const commandFailure = await failCommand('push', 'android', false);
      expect(commandFailure).toMatchObject({
        operation: 'upload Play listings',
        message: expect.stringMatching(/Play said no/),
      });
    });
  });
});
