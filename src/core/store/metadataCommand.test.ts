import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect, Schema, unsafeCoerce } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { makeLaunchPromptTest } from '../services/prompt.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';
import type { AppDescriptor } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';

vi.mock('./selectStoreApp.js', () => ({ loadStoreAppContext: vi.fn() }));
vi.mock('../credentials/accounts.js', () => ({ loadActiveAscKey: vi.fn() }));
vi.mock('../credentials/androidKeystore.js', () => ({ loadServiceAccount: vi.fn() }));
vi.mock('../services/exec.js', () => ({ executeCommand: vi.fn() }));

import { loadActiveAscKey } from '../credentials/accounts.js';
import { loadServiceAccount } from '../credentials/androidKeystore.js';
import { executeCommand } from '../services/exec.js';
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
  buildEngine: 'fastlane',
  submit: 'app-store-connect',
};

const makeApp = (
  appOverrides: Partial<AppDescriptor> & Pick<AppDescriptor, 'dir'>,
): AppDescriptor => ({
  name: 'demo',
  configPath: join(appOverrides.dir, 'app.json'),
  ...appOverrides,
});

const runMetadata = <Success, Failure, Requirements>(
  program: Effect.Effect<Success, Failure, Requirements>,
  workingDirectory: string,
  terminalWrites: string[],
): Promise<Success> =>
  Effect.runPromise(
    unsafeCoerce<Effect.Effect<Success, Failure, Requirements>, Effect.Effect<Success, Failure>>(
      program.pipe(
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

  beforeEach(() => {
    workspaceDirectory = mkdtempSync(join(tmpdir(), 'launch-metadata-cmd-'));
    appDirectory = join(workspaceDirectory, 'apps', 'demo');
    mkdirSync(appDirectory, { recursive: true });
    configPath = join(appDirectory, 'store.config.json');
    terminalWrites = [];
    vi.clearAllMocks();
    vi.mocked(executeCommand).mockReturnValue(Effect.void);
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

  it('rejects listing platforms without a fastlane adapter', async () => {
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

  it('dry-runs App Store pull after credentials without invoking fastlane', async () => {
    vi.mocked(loadActiveAscKey).mockReturnValue(
      Effect.succeed({ keyId: 'KEY', issuerId: 'ISS', p8: 'pem' }),
    );
    await runMetadata(
      metadataCommandProgram({
        operation: 'pull',
        platform: 'ios',
        dryRun: true,
        config: configPath,
      }),
      workspaceDirectory,
      terminalWrites,
    );
    expect(executeCommand).not.toHaveBeenCalled();
    expect(terminalWrites.join('')).toMatch(/would run `fastlane deliver download_metadata`/);
  });

  it('fails App Store pull when no active Apple account is configured', async () => {
    vi.mocked(loadActiveAscKey).mockReturnValue(Effect.succeed(null));
    const commandFailure = await flipMetadata(
      metadataCommandProgram({
        operation: 'pull',
        platform: 'ios',
        dryRun: true,
        config: configPath,
      }),
      workspaceDirectory,
    );
    expect(commandFailure).toMatchObject({
      operation: 'load active Apple account',
      message: expect.stringMatching(/No active Apple account/),
    });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('dry-runs Play pull after the service account without invoking fastlane', async () => {
    vi.mocked(loadServiceAccount).mockReturnValue(Effect.succeed('{"type":"service_account"}'));
    await runMetadata(
      metadataCommandProgram({
        operation: 'pull',
        platform: 'android',
        dryRun: true,
        config: configPath,
      }),
      workspaceDirectory,
      terminalWrites,
    );
    expect(executeCommand).not.toHaveBeenCalled();
    expect(terminalWrites.join('')).toMatch(/would run `fastlane supply init`/);
  });

  it('fails Play pull when no service account is configured', async () => {
    vi.mocked(loadServiceAccount).mockReturnValue(Effect.succeed(null));
    const commandFailure = await flipMetadata(
      metadataCommandProgram({
        operation: 'pull',
        platform: 'android',
        dryRun: true,
        config: configPath,
      }),
      workspaceDirectory,
    );
    expect(commandFailure).toMatchObject({
      operation: 'load Play service account',
      message: expect.stringMatching(/No Play service account/),
    });
  });

  it('refuses App Store push when store.config.json has no apple section', async () => {
    writeFileSync(
      configPath,
      `${JSON.stringify({ android: { info: { 'en-US': { title: 'Demo' } } } }, null, 2)}\n`,
    );
    const commandFailure = await flipMetadata(
      metadataCommandProgram({
        operation: 'push',
        platform: 'ios',
        dryRun: true,
        config: configPath,
      }),
      workspaceDirectory,
    );
    expect(commandFailure).toMatchObject({
      operation: 'read App Store metadata',
      message: expect.stringMatching(/no "apple" section/),
    });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('dry-runs App Store push by staging fields without upload', async () => {
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          apple: {
            info: {
              'en-US': {
                title: 'Demo',
                description: 'A demo app',
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    await runMetadata(
      metadataCommandProgram({
        operation: 'push',
        platform: 'ios',
        dryRun: true,
        config: configPath,
      }),
      workspaceDirectory,
      terminalWrites,
    );
    expect(executeCommand).not.toHaveBeenCalled();
    expect(terminalWrites.join('')).toMatch(/would push 2 App Store field\(s\)/);
    expect(terminalWrites.join('')).toMatch(/rehearsed into/);
  });

  it('refuses push when store.config.json is missing', async () => {
    const commandFailure = await flipMetadata(
      metadataCommandProgram({
        operation: 'push',
        platform: 'ios',
        dryRun: true,
        config: configPath,
      }),
      workspaceDirectory,
    );
    expect(commandFailure.message).toMatch(/No store\.config\.json/);
    expect(commandFailure.message).toMatch(/launch metadata pull/);
  });
});

describe('pullAppleListing', () => {
  let workspaceDirectory = '';
  let configPath = '';
  let terminalWrites: string[] = [];

  beforeEach(() => {
    workspaceDirectory = mkdtempSync(join(tmpdir(), 'launch-metadata-pull-'));
    configPath = join(workspaceDirectory, 'store.config.json');
    terminalWrites = [];
    vi.clearAllMocks();
    vi.mocked(executeCommand).mockReturnValue(Effect.void);
  });

  afterEach(() => {
    rmSync(workspaceDirectory, { recursive: true, force: true });
  });

  it('is callable for adopt-style pulls and dry-runs without fastlane', async () => {
    vi.mocked(loadActiveAscKey).mockReturnValue(
      Effect.succeed({ keyId: 'KEY', issuerId: 'ISS', p8: 'pem' }),
    );
    await runMetadata(
      pullAppleListing('com.demo.app', configPath, true),
      workspaceDirectory,
      terminalWrites,
    );
    expect(executeCommand).not.toHaveBeenCalled();
    expect(terminalWrites.join('')).toMatch(/deliver download_metadata/);
  });
});
