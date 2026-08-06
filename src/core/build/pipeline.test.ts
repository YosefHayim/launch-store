import { NodeContext, NodeHttpClient } from '@effect/platform-node';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// A dry-run must never shell out; make any spawn an immediate, obvious failure.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    throw new Error('spawn must not run during --dry-run');
  }),
}));
import { AppleCredentialsClientLive } from '../services/appleCredentialsClient.js';
import { AppleStoreClientLive } from '../services/appleStoreClient.js';
import { AppStoreIdentityLive } from '../services/appStoreIdentity.js';
import { LaunchEnvironmentTest } from '../services/environment.js';
import { GoogleStoreClientLive } from '../services/googleStoreClient.js';
import { makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { makeLaunchPromptTest } from '../services/prompt.js';
import { registerBuildEngine, registerSubmitter } from '../services/registry.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';
import { runBuild } from './pipeline.js';
import { sizeSummary, uploadSizeReadout, worstDownloadBytes } from './pipelineArtifact.js';
import { selectApp } from './pipelineEnv.js';
import {
  androidReleaseNotesFromLocaleMap,
  resolveAndroidSubmitReleaseNotes,
  resolveBuildTransport,
  resolveSizeBudgetMB,
  resolveSubmitters,
  submitToStores,
} from './pipelineProviders.js';
import { DEFAULT_SIZE_BUDGET_MB } from './pipelineTypes.js';
import { resolveBumpKind } from './pipelineVersion.js';
import type { AppDescriptor, BuildProfile } from '../types/app.js';
import type { SizeReport } from '../types/artifacts.js';
import type { LaunchConfig, ResolvedBuildContext } from '../types/config.js';
import type { BuildCredentials } from '../types/credentials.js';
import type { Submitter } from '../types/providers.js';
import process from 'node:process';

/** Run a build-core test with deterministic service layers and no CLI/provider bootstrap. */
type BuildCoreTestRequirements =
  | Effect.Effect.Context<ReturnType<typeof runBuild>>
  | Effect.Effect.Context<ReturnType<typeof selectApp>>;
const runBuildCoreTest = <Success, Failure>(
  program: Effect.Effect<Success, Failure, BuildCoreTestRequirements>,
): Promise<Success> =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(AppStoreIdentityLive),
      Effect.provide(AppleCredentialsClientLive),
      Effect.provide(AppleStoreClientLive),
      Effect.provide(GoogleStoreClientLive),
      Effect.provide(LaunchEnvironmentTest),
      Effect.provide(makeLaunchPathsTest(tempRepo, tempRepo)),
      Effect.provide(makeLaunchPromptTest()),
      Effect.provide(makeLaunchSecretStoreTest()),
      Effect.provide(makeLaunchLoggerTest([])),
      Effect.provide(NodeHttpClient.layer),
      Effect.provide(NodeContext.layer),
    ),
  );

/** Register requirement-free build engines used only by dry-run orchestration tests. */
const registerDryRunBuildEngines = (): void => {
  for (const engineName of ['fastlane', 'gradle']) {
    registerBuildEngine({
      name: engineName,
      buildArtifact: () =>
        Effect.succeed({
          artifactPath: '(dry-run, not built)',
          sizeReport: { artifactBytes: 0, entries: [] },
          cleanBuilt: false,
        }),
    });
  }
};
/** Any fetch during a dry-run is a bug - the rehearsal makes no account changes. */
const fetchGuard = vi.fn(() => {
  throw new Error('fetch must not run during --dry-run');
});
let originalCwd = '';
let tempRepo = '';
beforeEach(() => {
  originalCwd = process.cwd();
  fetchGuard.mockClear();
  vi.stubGlobal('fetch', fetchGuard);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  registerDryRunBuildEngines();
});
afterEach(() => {
  process.chdir(originalCwd);
  if (tempRepo) {
    rmSync(tempRepo, { recursive: true, force: true });
    tempRepo = '';
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
/** Create a one-app repo (no launch.config.ts, so loadConfig uses defaults - no jiti, fully hermetic). */
const writeRepo = (expo: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'launch-pipeline-'));
  writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo }));
  return dir;
};
describe('runBuild --dry-run (the end-to-end spine)', () => {
  it('rehearses every iOS step with no network and no spawned process', async () => {
    tempRepo = writeRepo({
      slug: 'hello',
      version: '1.0.0',
      ios: { bundleIdentifier: 'com.example.hello' },
    });
    process.chdir(tempRepo);
    await expect(
      runBuildCoreTest(
        runBuild({
          platform: 'ios',
          profileName: 'production',
          appName: undefined,
          explain: false,
          submit: true,
          target: 'testing',
          dryRun: true,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  });
  it('rehearses every Android step with no network and no spawned process', async () => {
    tempRepo = writeRepo({
      slug: 'hello',
      version: '1.0.0',
      android: { package: 'com.example.hello', versionCode: 3 },
    });
    process.chdir(tempRepo);
    await expect(
      runBuildCoreTest(
        runBuild({
          platform: 'android',
          profileName: 'production',
          appName: undefined,
          explain: false,
          submit: true,
          target: 'testing',
          dryRun: true,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  });
});
describe('selectApp', () => {
  const app = (name: string, bundleId?: string): AppDescriptor => {
    const descriptor: AppDescriptor = { name, dir: '/repo', configPath: '/repo/app.json' };
    if (bundleId === undefined) return descriptor;
    return { ...descriptor, bundleId };
  };
  it('fails when no apps were discovered', async () => {
    await expect(runBuildCoreTest(selectApp([], undefined))).rejects.toThrow(/No apps found/);
  });
  it('returns the sole app without prompting', async () => {
    const only = app('solo', 'com.example.solo');
    expect(await runBuildCoreTest(selectApp([only], undefined))).toBe(only);
  });
  it('resolves an explicit --app and errors on a miss', async () => {
    const alpha = app('alpha');
    const beta = app('beta');
    expect(await runBuildCoreTest(selectApp([alpha, beta], 'beta'))).toBe(beta);
    await expect(
      runBuildCoreTest(Effect.flip(selectApp([alpha, beta], 'gamma'))),
    ).resolves.toMatchObject({ message: expect.stringMatching(/App "gamma" not found/) });
  });
  it('refuses to guess with multiple apps and no TTY, pointing at --app', async () => {
    // The vitest process has no TTY, so the picker must not hang - it throws an actionable error.
    await expect(
      runBuildCoreTest(selectApp([app('alpha'), app('beta')], undefined)),
    ).rejects.toThrow(/--app/);
  });
});
describe('size helpers - the both-numbers headline (F2)', () => {
  const MB = 1024 * 1024;
  const report = (entries: SizeReport['entries'], artifactBytes = 64 * MB): SizeReport => ({
    artifactBytes,
    entries,
  });
  it('worstDownloadBytes picks the largest per-device download', () => {
    const r = report([
      { device: 'a', downloadBytes: 40 * MB, installBytes: 0 },
      { device: 'b', downloadBytes: 47 * MB, installBytes: 0 },
    ]);
    expect(worstDownloadBytes(r)).toBe(47 * MB);
  });
  it('worstDownloadBytes falls back to the on-disk size with no per-device entries', () => {
    expect(worstDownloadBytes(report([], 61 * MB))).toBe(61 * MB);
  });
  it('sizeSummary shows both numbers when a per-device estimate exists', () => {
    const r = report([{ device: 'a', downloadBytes: 47.2 * MB, installBytes: 0 }], 61.3 * MB);
    expect(sizeSummary(r)).toBe('download 47.2 MB - on disk 61.3 MB');
  });
  it("sizeSummary falls back to on-disk alone when there's no per-device estimate", () => {
    expect(sizeSummary(report([], 61.3 * MB))).toBe('on disk 61.3 MB (no per-device estimate)');
  });
});
describe('uploadSizeReadout - pre-upload size lines + growth warning', () => {
  const MB = 1024 * 1024;
  const report = (downloadMB: number, artifactMB = 64): SizeReport => ({
    artifactBytes: artifactMB * MB,
    entries: [{ device: 'iphone', downloadBytes: downloadMB * MB, installBytes: 0 }],
  });
  it('shows download + on-disk and no delta on the first build', () => {
    const { lines, grew } = uploadSizeReadout(report(38, 61));
    expect(lines).toEqual(['download 38.0 MB', 'on disk 61.0 MB']);
    expect(grew).toBeNull();
  });
  it('appends a signed delta against the previous build', () => {
    const { lines } = uploadSizeReadout(report(38), { downloadBytes: 33.8 * MB, buildNumber: 41 });
    expect(lines[0]).toBe('download 38.0 MB (+4.2 MB since build 41)');
  });
  it('warns when the download grows more than 10% over the previous build', () => {
    const { grew } = uploadSizeReadout(report(38), { downloadBytes: 33.8 * MB, buildNumber: 41 });
    expect(grew).toEqual({ pct: 12, buildNumber: 41 });
  });
  it('does not warn for growth at or under 10%', () => {
    const { grew } = uploadSizeReadout(report(36), { downloadBytes: 33.8 * MB, buildNumber: 41 });
    expect(grew).toBeNull();
  });
  it('shows a negative delta and no warning when the build shrank', () => {
    const { lines, grew } = uploadSizeReadout(report(30), {
      downloadBytes: 33.8 * MB,
      buildNumber: 41,
    });
    expect(lines[0]).toBe('download 30.0 MB (-3.8 MB since build 41)');
    expect(grew).toBeNull();
  });
  it("falls back to on-disk only (no delta) when there's no per-device estimate", () => {
    const readout = uploadSizeReadout(
      { artifactBytes: 61 * MB, entries: [] },
      { downloadBytes: 10 * MB, buildNumber: 1 },
    );
    expect(readout.lines).toEqual(['on disk 61.0 MB (no per-device estimate)']);
    expect(readout.grew).toBeNull();
  });
});
describe('resolveBuildTransport - which fork a run takes', () => {
  const resolveTransport = (
    platform: Parameters<typeof resolveBuildTransport>[0],
    buildEngine: string,
    remoteTarget: Parameters<typeof resolveBuildTransport>[2],
  ) => Effect.runSync(resolveBuildTransport(platform, buildEngine, remoteTarget));

  it('always builds Android locally - no off-Mac fork applies, even with a stray --remote', () => {
    expect(resolveTransport('android', 'gradle', undefined)).toEqual({ kind: 'local' });
    expect(resolveTransport('android', 'gradle', { kind: 'aws' })).toEqual({ kind: 'local' });
  });
  it('builds iOS locally by default', () => {
    expect(resolveTransport('ios', 'fastlane', undefined)).toEqual({ kind: 'local' });
  });
  it('routes iOS to the remote pipeline on --remote, carrying the target', () => {
    expect(resolveTransport('ios', 'fastlane', { kind: 'aws' })).toEqual({
      kind: 'remote',
      remote: { kind: 'aws' },
    });
    expect(resolveTransport('ios', 'fastlane', { kind: 'ssh', target: 'ec2-user@host' })).toEqual({
      kind: 'remote',
      remote: { kind: 'ssh', target: 'ec2-user@host' },
    });
  });
  it("defaults a buildEngine: 'remote-mac' config to an AWS remote when no --remote is passed", () => {
    expect(resolveTransport('ios', 'remote-mac', undefined)).toEqual({
      kind: 'remote',
      remote: { kind: 'aws' },
    });
  });
  it("hands iOS off to EAS when buildEngine is 'eas'", () => {
    expect(resolveTransport('ios', 'eas', undefined)).toEqual({ kind: 'eas' });
  });
  it('lets --remote win over an eas / remote-mac config (the flag is the override)', () => {
    expect(resolveTransport('ios', 'eas', { kind: 'aws' })).toEqual({
      kind: 'remote',
      remote: { kind: 'aws' },
    });
    expect(resolveTransport('ios', 'remote-mac', { kind: 'ssh', target: 'u@h' })).toEqual({
      kind: 'remote',
      remote: { kind: 'ssh', target: 'u@h' },
    });
  });
  it('builds tvOS/macOS/visionOS locally (off-Mac forks are iOS-only in v1)', () => {
    expect(resolveTransport('tvos', 'fastlane', undefined)).toEqual({ kind: 'local' });
    expect(resolveTransport('macos', 'fastlane', undefined)).toEqual({ kind: 'local' });
    expect(resolveTransport('visionos', 'fastlane', undefined)).toEqual({ kind: 'local' });
  });
  it('fails fast when an off-Mac fork is explicitly requested for a non-iOS Apple platform', () => {
    expect(() => resolveTransport('tvos', 'fastlane', { kind: 'aws' })).toThrow(
      /Remote builds are iOS-only/,
    );
    expect(() => resolveTransport('macos', 'remote-mac', undefined)).toThrow(
      /Remote builds are iOS-only/,
    );
    expect(() => resolveTransport('visionos', 'eas', undefined)).toThrow(
      /EAS does not build visionOS/,
    );
  });
});
describe('resolveBumpKind - flag > remembered > prompt precedence', () => {
  it('applies an explicit --bump kind, even non-interactively (scriptable in CI)', () => {
    expect(resolveBumpKind({ flag: 'minor', remembered: 'patch', canPrompt: true })).toEqual({
      mode: 'apply',
      kind: 'minor',
      source: 'flag',
    });
    expect(resolveBumpKind({ flag: 'major', remembered: undefined, canPrompt: false })).toEqual({
      mode: 'apply',
      kind: 'major',
      source: 'flag',
    });
  });
  it('forces the prompt on --bump ask, ignoring a remembered pick', () => {
    expect(resolveBumpKind({ flag: 'ask', remembered: 'patch', canPrompt: true })).toEqual({
      mode: 'prompt',
    });
  });
  it('auto-applies a remembered pick when no flag is given and we can prompt', () => {
    expect(resolveBumpKind({ flag: undefined, remembered: 'patch', canPrompt: true })).toEqual({
      mode: 'apply',
      kind: 'patch',
      source: 'remembered',
    });
  });
  it('prompts on a first run (no flag, nothing remembered)', () => {
    expect(resolveBumpKind({ flag: undefined, remembered: undefined, canPrompt: true })).toEqual({
      mode: 'prompt',
    });
  });
  it('leaves the config version untouched under --yes/CI with no flag', () => {
    expect(resolveBumpKind({ flag: undefined, remembered: 'patch', canPrompt: false })).toEqual({
      mode: 'leave',
    });
  });
});
describe('resolveSizeBudgetMB - per-run override > profile > default precedence', () => {
  const profile = (sizeBudgetMB?: number): Pick<BuildProfile, 'sizeBudgetMB'> => {
    if (sizeBudgetMB === undefined) return {};
    return { sizeBudgetMB };
  };
  it('uses the per-run override over both the profile and the default', () => {
    expect(resolveSizeBudgetMB({ sizeBudgetMB: 250 }, profile(150))).toBe(250);
  });
  it('falls back to the profile budget when no per-run override is given', () => {
    expect(resolveSizeBudgetMB({}, profile(150))).toBe(150);
  });
  it('falls back to the default when neither the run nor the profile sets one', () => {
    expect(resolveSizeBudgetMB({}, profile())).toBe(DEFAULT_SIZE_BUDGET_MB);
  });
});
describe('resolveSubmitters - the platformstore seam (ADR 0006)', () => {
  const launchConfig = (submit: LaunchConfig['submit']): LaunchConfig => ({
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit,
  });
  it('string form yields one store, mapping the iOS default to Play on Android', () => {
    expect(resolveSubmitters(launchConfig('app-store-connect'), 'ios')).toEqual([
      'app-store-connect',
    ]);
    expect(resolveSubmitters(launchConfig('app-store-connect'), 'android')).toEqual([
      'google-play',
    ]);
  });
  it('a non-default string (e.g. eas) is used as-is on both platforms', () => {
    expect(resolveSubmitters(launchConfig('eas'), 'ios')).toEqual(['eas']);
    expect(resolveSubmitters(launchConfig('eas'), 'android')).toEqual(['eas']);
  });
  it('map form returns the configured store list per platform', () => {
    const config = launchConfig({
      ios: ['app-store-connect'],
      android: ['google-play', 'amazon-appstore'],
    });
    expect(resolveSubmitters(config, 'android')).toEqual(['google-play', 'amazon-appstore']);
    expect(resolveSubmitters(config, 'ios')).toEqual(['app-store-connect']);
  });
  it("map form defaults to the platform's standard store when it's omitted or empty", () => {
    expect(resolveSubmitters(launchConfig({ android: ['amazon-appstore'] }), 'ios')).toEqual([
      'app-store-connect',
    ]);
    expect(resolveSubmitters(launchConfig({ ios: [] }), 'ios')).toEqual(['app-store-connect']);
    expect(resolveSubmitters(launchConfig({ ios: ['app-store-connect'] }), 'android')).toEqual([
      'google-play',
    ]);
  });
  it("tvOS/macOS/visionOS default to App Store Connect with no config change (ADR 0006 'grows for free')", () => {
    for (const platform of ['tvos', 'macos', 'visionos'] as const) {
      expect(resolveSubmitters(launchConfig('app-store-connect'), platform)).toEqual([
        'app-store-connect',
      ]);
      expect(resolveSubmitters(launchConfig({ android: ['google-play'] }), platform)).toEqual([
        'app-store-connect',
      ]);
    }
  });
  it('a per-platform map can target the new Apple platforms explicitly', () => {
    const config = launchConfig({
      tvos: ['app-store-connect'],
      macos: ['app-store-connect'],
    });
    expect(resolveSubmitters(config, 'tvos')).toEqual(['app-store-connect']);
    expect(resolveSubmitters(config, 'macos')).toEqual(['app-store-connect']);
  });
});
describe('submitToStores - fans one build out to every configured store', () => {
  const buildContext: ResolvedBuildContext = {
    platform: 'android',
    app: { name: 'Demo', dir: '/tmp/demo', configPath: '/tmp/demo/app.json' },
    profile: { name: 'production' },
    env: {},
    explain: false,
    dryRun: false,
    forceClean: false,
  };
  const buildCredentials: BuildCredentials = { platform: 'android', serviceAccountJson: '{}' };
  it('submits to each store in order and returns their names', async () => {
    const calls: string[] = [];
    const fakeStore = (name: string): Submitter => ({
      name,
      submit: (artifactPath) =>
        Effect.sync(() => {
          calls.push(`${name}:${artifactPath}`);
        }),
    });
    registerSubmitter(fakeStore('alt-store-a'));
    registerSubmitter(fakeStore('alt-store-b'));
    const config: LaunchConfig = {
      profiles: {},
      credentials: 'local',
      storage: 'local',
      buildEngine: 'gradle',
      submit: { android: ['alt-store-a', 'alt-store-b'] },
    };
    const stores = await Effect.runPromise(
      submitToStores(
        config,
        'android',
        '/tmp/app.aab',
        'production',
        buildCredentials,
        buildContext,
      ),
    );
    expect(stores).toEqual(['alt-store-a', 'alt-store-b']);
    expect(calls).toEqual(['alt-store-a:/tmp/app.aab', 'alt-store-b:/tmp/app.aab']);
  });
});
describe('android release notes for submit (issue #309)', () => {
  it('maps a locale document into Play release-note rows', () => {
    expect(
      androidReleaseNotesFromLocaleMap({
        'en-US': 'Bug fixes',
        'iw-IL': 'תיקונים',
      }),
    ).toEqual([
      { language: 'en-US', text: 'Bug fixes' },
      { language: 'iw-IL', text: 'תיקונים' },
    ]);
  });
  it('reads --notes JSON when provided', async () => {
    const notesDirectory = mkdtempSync(join(tmpdir(), 'launch-notes-'));
    const notesPath = join(notesDirectory, 'notes.json');
    writeFileSync(notesPath, JSON.stringify({ 'en-US': 'From CLI notes file' }));
    try {
      const releaseNotes = await Effect.runPromise(
        resolveAndroidSubmitReleaseNotes(
          {
            profiles: {},
            credentials: 'local',
            storage: 'local',
            buildEngine: 'gradle',
            submit: 'google-play',
          },
          notesDirectory,
          notesPath,
        ).pipe(Effect.provide(NodeContext.layer)),
      );
      expect(releaseNotes).toEqual([{ language: 'en-US', text: 'From CLI notes file' }]);
    } finally {
      rmSync(notesDirectory, { recursive: true, force: true });
    }
  });
  it('falls back to release.releaseNotes from launch config when no --notes path', async () => {
    const appDirectory = mkdtempSync(join(tmpdir(), 'launch-app-'));
    try {
      const releaseNotes = await Effect.runPromise(
        resolveAndroidSubmitReleaseNotes(
          {
            profiles: {},
            credentials: 'local',
            storage: 'local',
            buildEngine: 'gradle',
            submit: 'google-play',
            release: { releaseNotes: { 'en-US': 'From launch.config' }, primaryLocale: 'en-US' },
          },
          appDirectory,
          undefined,
        ).pipe(Effect.provide(NodeContext.layer)),
      );
      expect(releaseNotes).toEqual([{ language: 'en-US', text: 'From launch.config' }]);
    } finally {
      rmSync(appDirectory, { recursive: true, force: true });
    }
  });
});
