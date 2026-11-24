import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetSecretStore, useSecretStore } from '../services/credentials/secret-store.ts';
import { resetLaunchEnvironment, useLaunchEnvironment } from '../services/platform/environment.ts';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { resetPrompts } from '../services/platform/prompt.ts';
import { registerBuildEngine, registerSubmitter } from '../services/provider-support/registry.ts';
import { runBuild } from './pipeline.ts';
import { sizeSummary, uploadSizeReadout, worstDownloadBytes } from './pipeline-artifact.ts';
import { selectApp } from './pipeline-environment.ts';
import {
  androidReleaseNotesFromLocaleMap,
  resolveAndroidSubmitReleaseNotes,
  resolveBuildTransport,
  resolveSizeBudgetMB,
  resolveSubmitters,
  submitToStores,
  DEFAULT_SIZE_BUDGET_MB,
} from './pipeline-providers.ts';
import { resolveBumpKind } from './pipeline-version.ts';
import type { AppDescriptor, BuildProfile } from '../types/app.ts';
import type { SizeReport } from '../types/artifacts.ts';
import type { LaunchConfig, ResolvedBuildContext } from '../types/config.ts';
import type { BuildCredentials } from '../types/credentials.ts';
import type { Submitter } from '../types/providers.ts';
import process from 'node:process';
// A dry-run must never shell out; make any spawn an immediate, obvious failure.
vi.mock('node:child_process', function mockChildProcess() {
  return {
    spawn: vi.fn(() => {
      throw new Error('spawn must not run during --dry-run');
    }),
  };
});

/** Run a build-core test with deterministic services and no CLI/provider bootstrap. */
async function runBuildCoreTest<Success>(
  runCase: () => Promise<Success>,
  loggedLines: string[] = [],
): Promise<Success> {
  const hasTempRepo = tempRepo != '';

  if (hasTempRepo) {
    useLaunchDirectories({ homeDirectory: tempRepo, workingDirectory: tempRepo });
  }

  useLoggerSink(function keepLine(text: string): void {
    loggedLines.push(text);
  });
  useLaunchEnvironment({});
  useSecretStore(new Map());
  resetPrompts();

  try {
    return await runCase();
  } finally {
    resetLaunchDirectories();
    resetLogger();
    resetLaunchEnvironment();
    resetPrompts();
    resetSecretStore();
  }
}

/** Register requirement-free build engines used only by dry-run orchestration tests. */
function registerDryRunBuildEngines(): void {
  for (const engineName of ['xcode', 'gradle']) {
    registerBuildEngine({
      name: engineName,
      async buildArtifact() {
        return {
          artifactPath: '(dry-run, not built)',
          sizeReport: { artifactBytes: 0, entries: [] },
          cleanBuilt: false,
        };
      },
    });
  }
}

function mockCall() {
  throw new Error('fetch must not run during --dry-run');
}

/** Any fetch during a dry-run is a bug - the rehearsal makes no account changes. */
const fetchGuard = vi.fn(mockCall);
let originalCwd = '';
let tempRepo = '';

function prepare() {
  originalCwd = process.cwd();
  fetchGuard.mockClear();
  vi.stubGlobal('fetch', fetchGuard);

  function mockImplementationPiece() {
    return undefined;
  }

  vi.spyOn(console, 'log').mockImplementation(mockImplementationPiece);

  function mockImplementationPiece2() {
    return undefined;
  }

  vi.spyOn(console, 'warn').mockImplementation(mockImplementationPiece2);

  function mockImplementationPiece3() {
    return undefined;
  }

  vi.spyOn(console, 'error').mockImplementation(mockImplementationPiece3);
  registerDryRunBuildEngines();
}

beforeEach(prepare);

function cleanup() {
  process.chdir(originalCwd);

  if (tempRepo) {
    rmSync(tempRepo, { recursive: true, force: true });
    tempRepo = '';
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

afterEach(cleanup);

/** Create a one-app repo (no launch.config.ts, so loadConfig uses defaults - no jiti, fully hermetic). */
function writeRepo(expo: Record<string, unknown>): string {
  const systemTemporaryDirectory = tmpdir();
  const launchPipelinePath = join(systemTemporaryDirectory, 'launch-pipeline-');
  const dir = mkdtempSync(launchPipelinePath);
  const appPath = join(dir, 'app.json');
  const serialized = JSON.stringify({ expo });

  writeFileSync(appPath, serialized);

  return dir;
}

function describeRunBuildDryRunTheEndToEndSpine() {
  async function rehearsesEveryIOSStepWithNoNetworkAndNoSpawnedProcess() {
    tempRepo = writeRepo({
      slug: 'hello',
      version: '1.0.0',
      ios: { bundleIdentifier: 'com.example.hello' },
    });
    process.chdir(tempRepo);

    function runBuildCoreTestPiece() {
      return runBuild({
        platform: 'ios',
        profileName: 'production',
        appName: undefined,
        explain: false,
        submit: true,
        dryRun: true,
      });
    }

    const buildCoreTest = runBuildCoreTest(runBuildCoreTestPiece);

    await expect(buildCoreTest).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  }

  it(
    'rehearses every iOS step with no network and no spawned process',
    rehearsesEveryIOSStepWithNoNetworkAndNoSpawnedProcess,
  );

  async function rehearsesEveryAndroidStepWithNoNetworkAndNoSpawnedProcess() {
    tempRepo = writeRepo({
      slug: 'hello',
      version: '1.0.0',
      android: { package: 'com.example.hello', versionCode: 3 },
    });
    process.chdir(tempRepo);

    function runBuildCoreTestPiece2() {
      return runBuild({
        platform: 'android',
        profileName: 'production',
        appName: undefined,
        explain: false,
        submit: true,
        dryRun: true,
      });
    }

    const buildCoreTest = runBuildCoreTest(runBuildCoreTestPiece2);

    await expect(buildCoreTest).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  }

  it(
    'rehearses every Android step with no network and no spawned process',
    rehearsesEveryAndroidStepWithNoNetworkAndNoSpawnedProcess,
  );

  async function rejectsAnUnregisteredBuildEngineBeforeAnyNativeWork() {
    tempRepo = writeRepo({
      slug: 'hello',
      version: '1.0.0',
      ios: { bundleIdentifier: 'com.example.hello' },
    });

    const launchPath = join(tempRepo, 'launch.config.mjs');

    writeFileSync(
      launchPath,
      "export default { buildEngine: 'missing-engine', profiles: { production: { name: 'production' } } };",
    );
    process.chdir(tempRepo);

    const loggedLines: string[] = [];

    function runBuildCoreTestPiece3() {
      return runBuild({
        platform: 'ios',
        profileName: 'production',
        appName: undefined,
        explain: false,
        submit: true,
        dryRun: true,
      });
    }

    const iosBuild = runBuildCoreTest(runBuildCoreTestPiece3, loggedLines);

    await expect(iosBuild).rejects.toMatchObject({
      _tag: 'ProviderNotRegistered',
      message: expect.stringMatching(/Unknown build engine.*missing-engine/),
    });
    expect(loggedLines.join('\n')).not.toContain('prebuild');
  }

  it(
    'rejects an unregistered build engine before any native work',
    rejectsAnUnregisteredBuildEngineBeforeAnyNativeWork,
  );
}

describe('runBuild --dry-run (the end-to-end spine)', describeRunBuildDryRunTheEndToEndSpine);

function describeSelectApp() {
  function app(name: string, bundleId?: string): AppDescriptor {
    const descriptor: AppDescriptor = { name, dir: '/repo', configPath: '/repo/app.json' };

    if (bundleId == null) return descriptor;

    return { ...descriptor, bundleId };
  }

  async function failsWhenNoAppsWereDiscovered() {
    function runBuildCoreTestPiece4() {
      return selectApp([], undefined);
    }

    const buildCoreTest = runBuildCoreTest(runBuildCoreTestPiece4);

    await expect(buildCoreTest).rejects.toMatchObject({
      message: expect.stringMatching(/No apps found/),
    });
  }

  it('fails when no apps were discovered', failsWhenNoAppsWereDiscovered);

  async function returnsTheSoleAppWithoutPrompting() {
    const only = app('solo', 'com.example.solo');

    function runBuildCoreTestPiece5() {
      return selectApp([only], undefined);
    }

    const buildCoreTest = await runBuildCoreTest(runBuildCoreTestPiece5);

    expect(buildCoreTest).toBe(only);
  }

  it('returns the sole app without prompting', returnsTheSoleAppWithoutPrompting);

  async function resolvesAnExplicitAppAndErrorsOnAMiss() {
    const alpha = app('alpha');
    const beta = app('beta');

    function runBuildCoreTestPiece6() {
      return selectApp([alpha, beta], 'beta');
    }

    const buildCoreTest = await runBuildCoreTest(runBuildCoreTestPiece6);

    expect(buildCoreTest).toBe(beta);

    function runBuildCoreTestPiece7() {
      return selectApp([alpha, beta], 'gamma');
    }

    await expect(runBuildCoreTest(runBuildCoreTestPiece7)).rejects.toMatchObject({
      message: expect.stringMatching(/App "gamma" not found/),
    });
  }

  it('resolves an explicit --app and errors on a miss', resolvesAnExplicitAppAndErrorsOnAMiss);

  async function refusesToGuessWithMultipleAppsAndNoTTYPointingAtApp() {
    function runBuildCoreTestPiece8() {
      return selectApp([app('alpha'), app('beta')], undefined);
    }

    // The vitest process has no TTY, so the picker must not hang - it throws an actionable error.
    const buildCoreTest = runBuildCoreTest(runBuildCoreTestPiece8);

    await expect(buildCoreTest).rejects.toMatchObject({ message: expect.stringMatching(/--app/) });
  }

  it(
    'refuses to guess with multiple apps and no TTY, pointing at --app',
    refusesToGuessWithMultipleAppsAndNoTTYPointingAtApp,
  );
}

describe('selectApp', describeSelectApp);

function describeSizeHelpersTheBothNumbersHeadlineF2() {
  const MB = 1024 * 1024;

  function report(entries: SizeReport['entries'], artifactBytes: number = 64 * MB): SizeReport {
    return {
      artifactBytes,
      entries,
    };
  }

  function worstDownloadBytesPicksTheLargestPerDeviceDownload() {
    const r = report([
      { device: 'a', downloadBytes: 40 * MB, installBytes: 0 },
      { device: 'b', downloadBytes: 47 * MB, installBytes: 0 },
    ]);

    expect(worstDownloadBytes(r)).toBe(47 * MB);
  }

  it(
    'worstDownloadBytes picks the largest per-device download',
    worstDownloadBytesPicksTheLargestPerDeviceDownload,
  );

  function worstDownloadBytesFallsBackToTheOnDiskSizeWithNoPerDeviceEntries() {
    expect(worstDownloadBytes(report([], 61 * MB))).toBe(61 * MB);
  }

  it(
    'worstDownloadBytes falls back to the on-disk size with no per-device entries',
    worstDownloadBytesFallsBackToTheOnDiskSizeWithNoPerDeviceEntries,
  );

  function sizeSummaryShowsBothNumbersWhenAPerDeviceEstimateExists() {
    const r = report([{ device: 'a', downloadBytes: 47.2 * MB, installBytes: 0 }], 61.3 * MB);
    expect(sizeSummary(r)).toBe('download 47.2 MB - on disk 61.3 MB');
  }

  it(
    'sizeSummary shows both numbers when a per-device estimate exists',
    sizeSummaryShowsBothNumbersWhenAPerDeviceEstimateExists,
  );

  function sizeSummaryFallsBackToOnDiskAloneWhenThereSNoPerDeviceEstimate() {
    expect(sizeSummary(report([], 61.3 * MB))).toBe('on disk 61.3 MB (no per-device estimate)');
  }

  it(
    "sizeSummary falls back to on-disk alone when there's no per-device estimate",
    sizeSummaryFallsBackToOnDiskAloneWhenThereSNoPerDeviceEstimate,
  );
}

describe(
  'size helpers - the both-numbers headline (F2)',
  describeSizeHelpersTheBothNumbersHeadlineF2,
);

function describeUploadSizeReadoutPreUploadSizeLinesGrowthWarning() {
  const MB = 1024 * 1024;

  function report(downloadMB: number, artifactMB: number = 64): SizeReport {
    return {
      artifactBytes: artifactMB * MB,
      entries: [{ device: 'iphone', downloadBytes: downloadMB * MB, installBytes: 0 }],
    };
  }

  function showsDownloadOnDiskAndNoDeltaOnTheFirstBuild() {
    const { lines, grew } = uploadSizeReadout(report(38, 61));
    expect(lines).toEqual(['download 38.0 MB', 'on disk 61.0 MB']);
    expect(grew).toBeNull();
  }

  it(
    'shows download + on-disk and no delta on the first build',
    showsDownloadOnDiskAndNoDeltaOnTheFirstBuild,
  );

  function appendsASignedDeltaAgainstThePreviousBuild() {
    const { lines } = uploadSizeReadout(report(38), { downloadBytes: 33.8 * MB, buildNumber: 41 });
    expect(lines[0]).toBe('download 38.0 MB (+4.2 MB since build 41)');
  }

  it(
    'appends a signed delta against the previous build',
    appendsASignedDeltaAgainstThePreviousBuild,
  );

  function warnsWhenTheDownloadGrowsMoreThan10OverThePreviousBuild() {
    const { grew } = uploadSizeReadout(report(38), { downloadBytes: 33.8 * MB, buildNumber: 41 });
    expect(grew).toEqual({ pct: 12, buildNumber: 41 });
  }

  it(
    'warns when the download grows more than 10% over the previous build',
    warnsWhenTheDownloadGrowsMoreThan10OverThePreviousBuild,
  );

  function doesNotWarnForGrowthAtOrUnder10() {
    const { grew } = uploadSizeReadout(report(36), { downloadBytes: 33.8 * MB, buildNumber: 41 });
    expect(grew).toBeNull();
  }

  it('does not warn for growth at or under 10%', doesNotWarnForGrowthAtOrUnder10);

  function showsANegativeDeltaAndNoWarningWhenTheBuildShrank() {
    const { lines, grew } = uploadSizeReadout(report(30), {
      downloadBytes: 33.8 * MB,
      buildNumber: 41,
    });

    expect(lines[0]).toBe('download 30.0 MB (-3.8 MB since build 41)');
    expect(grew).toBeNull();
  }

  it(
    'shows a negative delta and no warning when the build shrank',
    showsANegativeDeltaAndNoWarningWhenTheBuildShrank,
  );

  function fallsBackToOnDiskOnlyNoDeltaWhenThereSNoPerDeviceEstimate() {
    const readout = uploadSizeReadout(
      { artifactBytes: 61 * MB, entries: [] },
      { downloadBytes: 10 * MB, buildNumber: 1 },
    );

    expect(readout.lines).toEqual(['on disk 61.0 MB (no per-device estimate)']);
    expect(readout.grew).toBeNull();
  }

  it(
    "falls back to on-disk only (no delta) when there's no per-device estimate",
    fallsBackToOnDiskOnlyNoDeltaWhenThereSNoPerDeviceEstimate,
  );
}

describe(
  'uploadSizeReadout - pre-upload size lines + growth warning',
  describeUploadSizeReadoutPreUploadSizeLinesGrowthWarning,
);

function describeResolveBuildTransportWhichForkARunTakes() {
  function resolveTransport(
    platform: Parameters<typeof resolveBuildTransport>[0],
    buildEngine: string,
    remoteTarget: Parameters<typeof resolveBuildTransport>[2],
  ) {
    return resolveBuildTransport(platform, buildEngine, remoteTarget);
  }

  function alwaysBuildsAndroidLocallyNoOffMacForkAppliesEvenWithAStrayRemote() {
    const transport = resolveTransport('android', 'gradle', undefined);
    expect(transport).toEqual({ kind: 'local' });
    expect(resolveTransport('android', 'gradle', { kind: 'ssh', target: 'builder@mac' })).toEqual({
      kind: 'local',
    });
  }

  it(
    'always builds Android locally - no off-Mac fork applies, even with a stray --remote',
    alwaysBuildsAndroidLocallyNoOffMacForkAppliesEvenWithAStrayRemote,
  );

  function buildsIOSLocallyByDefault() {
    const transport = resolveTransport('ios', 'xcode', undefined);
    expect(transport).toEqual({ kind: 'local' });
  }

  it('builds iOS locally by default', buildsIOSLocallyByDefault);

  function routesIOSToTheRemotePipelineOnRemoteCarryingTheTarget() {
    expect(resolveTransport('ios', 'xcode', { kind: 'ssh', target: 'ec2-user@host' })).toEqual({
      kind: 'remote',
      remote: { kind: 'ssh', target: 'ec2-user@host' },
    });
  }

  it(
    'routes iOS to the remote pipeline on --remote, carrying the target',
    routesIOSToTheRemotePipelineOnRemoteCarryingTheTarget,
  );

  function refusesRemoteMacWithoutAnSshTarget() {
    expect(thrownTransportFailure('ios', 'remote-mac', undefined)).toMatchObject({
      message: 'A remote Mac build needs --remote user@host.',
    });
  }

  it(
    'refuses buildEngine remote-mac when --remote user@host is missing',
    refusesRemoteMacWithoutAnSshTarget,
  );

  function handsIOSOffToEASWhenBuildEngineIsEas() {
    const transport = resolveTransport('ios', 'eas', undefined);
    expect(transport).toEqual({ kind: 'eas' });
  }

  it("hands iOS off to EAS when buildEngine is 'eas'", handsIOSOffToEASWhenBuildEngineIsEas);

  function letsRemoteWinOverAnEasRemoteMacPieceTheFlagIsTheOverride() {
    expect(resolveTransport('ios', 'remote-mac', { kind: 'ssh', target: 'u@h' })).toEqual({
      kind: 'remote',
      remote: { kind: 'ssh', target: 'u@h' },
    });
  }

  it(
    'lets --remote win over an eas / remote-mac config (the flag is the override)',
    letsRemoteWinOverAnEasRemoteMacPieceTheFlagIsTheOverride,
  );

  function buildsTvOSMacOSVisionOSLocallyOffMacForksAreIOSOnlyInV1() {
    const transport = resolveTransport('tvos', 'xcode', undefined);
    expect(transport).toEqual({ kind: 'local' });
    expect(resolveTransport('macos', 'xcode', undefined)).toEqual({ kind: 'local' });
    expect(resolveTransport('visionos', 'xcode', undefined)).toEqual({ kind: 'local' });
  }

  it(
    'builds tvOS/macOS/visionOS locally (off-Mac forks are iOS-only in v1)',
    buildsTvOSMacOSVisionOSLocallyOffMacForksAreIOSOnlyInV1,
  );

  function thrownTransportFailure(
    platform: Parameters<typeof resolveBuildTransport>[0],
    buildEngine: string,
    remoteTarget: Parameters<typeof resolveBuildTransport>[2],
  ): unknown {
    try {
      resolveTransport(platform, buildEngine, remoteTarget);
    } catch (error) {
      return error;
    }

    throw new Error(`expected ${platform} ${buildEngine} transport to fail`);
  }

  function failsFastWhenAnOffMacForkIsExplicitlyRequestedForANonIOSApplePlatform() {
    expect(
      thrownTransportFailure('tvos', 'xcode', { kind: 'ssh', target: 'builder@mac' }),
    ).toMatchObject({
      message: expect.stringMatching(/Remote builds are iOS-only/),
    });
    expect(thrownTransportFailure('macos', 'remote-mac', undefined)).toMatchObject({
      message: expect.stringMatching(/Remote builds are iOS-only/),
    });
    expect(thrownTransportFailure('visionos', 'eas', undefined)).toMatchObject({
      message: expect.stringMatching(/EAS does not build visionOS/),
    });
  }

  it(
    'fails fast when an off-Mac fork is explicitly requested for a non-iOS Apple platform',
    failsFastWhenAnOffMacForkIsExplicitlyRequestedForANonIOSApplePlatform,
  );
}

describe(
  'resolveBuildTransport - which fork a run takes',
  describeResolveBuildTransportWhichForkARunTakes,
);

function describeResolveBumpKindFlagRememberedPromptPrecedence() {
  function appliesAnExplicitBumpKindEvenNonInteractivelyScriptableInCI() {
    const bumpKind = resolveBumpKind({ flag: 'minor', remembered: 'patch', canPrompt: true });

    expect(bumpKind).toEqual({
      mode: 'apply',
      kind: 'minor',
      source: 'flag',
    });
    expect(resolveBumpKind({ flag: 'major', remembered: undefined, canPrompt: false })).toEqual({
      mode: 'apply',
      kind: 'major',
      source: 'flag',
    });
  }

  it(
    'applies an explicit --bump kind, even non-interactively (scriptable in CI)',
    appliesAnExplicitBumpKindEvenNonInteractivelyScriptableInCI,
  );

  function forcesThePromptOnBumpAskIgnoringARememberedPick() {
    const bumpKind = resolveBumpKind({ flag: 'ask', remembered: 'patch', canPrompt: true });
    expect(bumpKind).toEqual({
      mode: 'prompt',
    });
  }

  it(
    'forces the prompt on --bump ask, ignoring a remembered pick',
    forcesThePromptOnBumpAskIgnoringARememberedPick,
  );

  function autoAppliesARememberedPickWhenNoFlagIsGivenAndWeCanPrompt() {
    const bumpKind = resolveBumpKind({ flag: undefined, remembered: 'patch', canPrompt: true });

    expect(bumpKind).toEqual({
      mode: 'apply',
      kind: 'patch',
      source: 'remembered',
    });
  }

  it(
    'auto-applies a remembered pick when no flag is given and we can prompt',
    autoAppliesARememberedPickWhenNoFlagIsGivenAndWeCanPrompt,
  );

  function promptsOnAFirstRunNoFlagNothingRemembered() {
    const bumpKind = resolveBumpKind({ flag: undefined, remembered: undefined, canPrompt: true });
    expect(bumpKind).toEqual({
      mode: 'prompt',
    });
  }

  it(
    'prompts on a first run (no flag, nothing remembered)',
    promptsOnAFirstRunNoFlagNothingRemembered,
  );

  function leavesThePieceVersionUntouchedUnderYesCIWithNoFlag() {
    const bumpKind = resolveBumpKind({ flag: undefined, remembered: 'patch', canPrompt: false });
    expect(bumpKind).toEqual({
      mode: 'leave',
    });
  }

  it(
    'leaves the config version untouched under --yes/CI with no flag',
    leavesThePieceVersionUntouchedUnderYesCIWithNoFlag,
  );
}

describe(
  'resolveBumpKind - flag > remembered > prompt precedence',
  describeResolveBumpKindFlagRememberedPromptPrecedence,
);

function describeResolveSizeBudgetMBPerRunOverrideProfileDefaultPrecedence() {
  function profile(sizeBudgetMB?: number): Pick<BuildProfile, 'sizeBudgetMB'> {
    if (sizeBudgetMB == null) return {};

    return { sizeBudgetMB };
  }

  function usesThePerRunOverrideOverBothTheProfileAndTheDefault() {
    const resolveSizeBudgetMb = resolveSizeBudgetMB({ sizeBudgetMB: 250 }, profile(150));
    expect(resolveSizeBudgetMb).toBe(250);
  }

  it(
    'uses the per-run override over both the profile and the default',
    usesThePerRunOverrideOverBothTheProfileAndTheDefault,
  );

  function fallsBackToTheProfileBudgetWhenNoPerRunOverrideIsGiven() {
    const sizeBudgetMB = resolveSizeBudgetMB({}, profile(150));
    expect(sizeBudgetMB).toBe(150);
  }

  it(
    'falls back to the profile budget when no per-run override is given',
    fallsBackToTheProfileBudgetWhenNoPerRunOverrideIsGiven,
  );

  function fallsBackToTheDefaultWhenNeitherTheRunNorTheProfileSetsOne() {
    const sizeBudgetMB = resolveSizeBudgetMB({}, profile());
    expect(sizeBudgetMB).toBe(DEFAULT_SIZE_BUDGET_MB);
  }

  it(
    'falls back to the default when neither the run nor the profile sets one',
    fallsBackToTheDefaultWhenNeitherTheRunNorTheProfileSetsOne,
  );
}

describe(
  'resolveSizeBudgetMB - per-run override > profile > default precedence',
  describeResolveSizeBudgetMBPerRunOverrideProfileDefaultPrecedence,
);

function describeResolveSubmittersThePlatformstoreSeam() {
  function launchConfig(submit: LaunchConfig['submit']): LaunchConfig {
    return {
      profiles: {},
      credentials: 'local',
      storage: 'local',
      buildEngine: 'xcode',
      submit,
    };
  }

  function stringFormYieldsOneStoreMappingTheIOSDefaultToPlayOnAndroid() {
    const launch = launchConfig('app-store-connect');
    const submitters = resolveSubmitters(launch, 'ios');

    expect(submitters).toEqual(['app-store-connect']);
    expect(resolveSubmitters(launchConfig('app-store-connect'), 'android')).toEqual([
      'google-play',
    ]);
  }

  it(
    'string form yields one store, mapping the iOS default to Play on Android',
    stringFormYieldsOneStoreMappingTheIOSDefaultToPlayOnAndroid,
  );

  function aNonDefaultStringEGEasIsUsedAsIsOnBothPlatforms() {
    const launch = launchConfig('eas');
    const submitters = resolveSubmitters(launch, 'ios');
    expect(submitters).toEqual(['eas']);
    expect(resolveSubmitters(launchConfig('eas'), 'android')).toEqual(['eas']);
  }

  it(
    'a non-default string (e.g. eas) is used as-is on both platforms',
    aNonDefaultStringEGEasIsUsedAsIsOnBothPlatforms,
  );

  function mapFormReturnsTheConfiguredStoreListPerPlatform() {
    const config = launchConfig({
      ios: ['app-store-connect'],
      android: ['google-play', 'amazon-appstore'],
    });
    const submitters = resolveSubmitters(config, 'android');

    expect(submitters).toEqual(['google-play', 'amazon-appstore']);
    expect(resolveSubmitters(config, 'ios')).toEqual(['app-store-connect']);
  }

  it(
    'map form returns the configured store list per platform',
    mapFormReturnsTheConfiguredStoreListPerPlatform,
  );

  function mapFormDefaultsToThePlatformSStandardStoreWhenItSOmittedOrEmpty() {
    const launch = launchConfig({ android: ['amazon-appstore'] });
    const submitters = resolveSubmitters(launch, 'ios');

    expect(submitters).toEqual(['app-store-connect']);
    expect(resolveSubmitters(launchConfig({ ios: [] }), 'ios')).toEqual(['app-store-connect']);
    expect(resolveSubmitters(launchConfig({ ios: ['app-store-connect'] }), 'android')).toEqual([
      'google-play',
    ]);
  }

  it(
    "map form defaults to the platform's standard store when it's omitted or empty",
    mapFormDefaultsToThePlatformSStandardStoreWhenItSOmittedOrEmpty,
  );

  function tvOSMacOSVisionOSDefaultToAppStoreConnectWithNoPieceChange() {
    for (const platform of ['tvos', 'macos', 'visionos'] as const) {
      const launch = launchConfig('app-store-connect');
      const submitters = resolveSubmitters(launch, platform);

      expect(submitters).toEqual(['app-store-connect']);
      expect(resolveSubmitters(launchConfig({ android: ['google-play'] }), platform)).toEqual([
        'app-store-connect',
      ]);
    }
  }

  it(
    'tvOS/macOS/visionOS default to App Store Connect with no config change',
    tvOSMacOSVisionOSDefaultToAppStoreConnectWithNoPieceChange,
  );

  function aPerPlatformMapCanTargetTheNewApplePlatformsExplicitly() {
    const config = launchConfig({
      tvos: ['app-store-connect'],
      macos: ['app-store-connect'],
    });
    const submitters = resolveSubmitters(config, 'tvos');

    expect(submitters).toEqual(['app-store-connect']);
    expect(resolveSubmitters(config, 'macos')).toEqual(['app-store-connect']);
  }

  it(
    'a per-platform map can target the new Apple platforms explicitly',
    aPerPlatformMapCanTargetTheNewApplePlatformsExplicitly,
  );
}

describe(
  'resolveSubmitters - the platformstore seam',
  describeResolveSubmittersThePlatformstoreSeam,
);

function describeSubmitToStoresFansOneBuildOutToEveryConfiguredStore() {
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

  async function submitsToEachStoreInOrderAndReturnsTheirNames() {
    const calls: string[] = [];

    function fakeStore(name: string): Submitter {
      return {
        name,
        async submit(artifact) {
          calls.push(`${name}:${artifact.path}`);
        },
      };
    }

    registerSubmitter(fakeStore('alt-store-a'));
    registerSubmitter(fakeStore('alt-store-b'));

    const config: LaunchConfig = {
      profiles: {},
      credentials: 'local',
      storage: 'local',
      buildEngine: 'gradle',
      submit: { android: ['alt-store-a', 'alt-store-b'] },
    };
    const stores = await submitToStores(
      config,
      'android',
      { path: '/tmp/app.aab', version: '1.0.0', buildNumber: 1 },
      buildCredentials,
      buildContext,
    );

    expect(stores).toEqual(['alt-store-a', 'alt-store-b']);
    expect(calls).toEqual(['alt-store-a:/tmp/app.aab', 'alt-store-b:/tmp/app.aab']);
  }

  it(
    'submits to each store in order and returns their names',
    submitsToEachStoreInOrderAndReturnsTheirNames,
  );
}

describe(
  'submitToStores - fans one build out to every configured store',
  describeSubmitToStoresFansOneBuildOutToEveryConfiguredStore,
);

function describeAndroidReleaseNotesForSubmitIssue309() {
  function mapsALocaleDocumentIntoPlayReleaseNoteRows() {
    expect(
      androidReleaseNotesFromLocaleMap({
        'en-US': 'Bug fixes',
        'iw-IL': 'תיקונים',
      }),
    ).toEqual([
      { language: 'en-US', text: 'Bug fixes' },
      { language: 'iw-IL', text: 'תיקונים' },
    ]);
  }

  it(
    'maps a locale document into Play release-note rows',
    mapsALocaleDocumentIntoPlayReleaseNoteRows,
  );

  async function readsNotesJSONWhenProvided() {
    const systemTemporaryDirectory = tmpdir();
    const launchNotesPath = join(systemTemporaryDirectory, 'launch-notes-');
    const notesDirectory = mkdtempSync(launchNotesPath);
    const notesPath = join(notesDirectory, 'notes.json');
    const serialized = JSON.stringify({ 'en-US': 'From CLI notes file' });

    writeFileSync(notesPath, serialized);

    try {
      const releaseNotes = await resolveAndroidSubmitReleaseNotes(
        {
          profiles: {},
          credentials: 'local',
          storage: 'local',
          buildEngine: 'gradle',
          submit: 'google-play',
        },
        { dir: notesDirectory },
        notesPath,
      );

      expect(releaseNotes).toEqual([{ language: 'en-US', text: 'From CLI notes file' }]);
    } finally {
      rmSync(notesDirectory, { recursive: true, force: true });
    }
  }

  it('reads --notes JSON when provided', readsNotesJSONWhenProvided);

  async function fallsBackToReleaseReleaseNotesFromLaunchStorePieceWhenNoNotesPath() {
    const systemTemporaryDirectory = tmpdir();
    const launchAppPath = join(systemTemporaryDirectory, 'launch-app-');
    const appDirectory = mkdtempSync(launchAppPath);

    try {
      const releaseNotes = await resolveAndroidSubmitReleaseNotes(
        {
          profiles: {},
          credentials: 'local',
          storage: 'local',
          buildEngine: 'gradle',
          submit: 'google-play',
          release: { releaseNotes: { 'en-US': 'From launch.config' }, primaryLocale: 'en-US' },
        },
        { dir: appDirectory },
        undefined,
      );

      expect(releaseNotes).toEqual([{ language: 'en-US', text: 'From launch.config' }]);
    } finally {
      rmSync(appDirectory, { recursive: true, force: true });
    }
  }

  it(
    'falls back to release.releaseNotes from launch-store config when no --notes path',
    fallsBackToReleaseReleaseNotesFromLaunchStorePieceWhenNoNotesPath,
  );
}

describe(
  'android release notes for submit (issue #309)',
  describeAndroidReleaseNotesForSubmitIssue309,
);
