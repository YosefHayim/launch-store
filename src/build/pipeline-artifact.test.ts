import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger, resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { runWithProgress } from '../services/platform/progress.ts';
import { nativeProjectDirName } from '../services/stores/platform.ts';
import type { Platform } from '../types/app.ts';
import type { SizeReport } from '../types/artifacts.ts';
import type { PrebuildMode, BuildContext } from '../types/config.ts';
import type { BuildRunOptions } from '../types/build-run.ts';
import {
  ensureAndroidProject,
  ensureNativeProject,
  makeNativeProjectFailure,
  receiptDestination,
  sizeSummary,
  uploadSizeReadout,
  worstDownloadBytes,
} from './pipeline-artifact.ts';

// A non-dry-run prebuild records its command here instead of spawning npx.
vi.mock(
  '../services/platform/progress.ts',
  async function mockProgress(importOriginal: <T = unknown>() => Promise<T>) {
    const actual = await importOriginal<typeof import('../services/platform/progress.ts')>();
    return { ...actual, runWithProgress: vi.fn(async () => ({ elapsedMs: 0, steps: 0 })) };
  },
);

const MB = 1024 * 1024;

function sizeReport(entries: SizeReport['entries'], artifactBytes: number = 64 * MB): SizeReport {
  return {
    artifactBytes,
    entries,
  };
}

function buildRunOptions(overrides: Partial<BuildRunOptions> = {}): BuildRunOptions {
  return {
    platform: 'ios',
    profileName: 'production',
    explain: false,
    submit: true,
    dryRun: false,
    ...overrides,
  };
}

function describeWorstDownloadBytes() {
  function picksTheLargestPerDeviceDownload() {
    expect(
      worstDownloadBytes(
        sizeReport([
          { device: 'a', downloadBytes: 40 * MB, installBytes: 0 },
          { device: 'b', downloadBytes: 47 * MB, installBytes: 0 },
        ]),
      ),
    ).toBe(47 * MB);
  }

  it('picks the largest per-device download', picksTheLargestPerDeviceDownload);

  function fallsBackToOnDiskSizeWhenThereAreNoPerDeviceEntries() {
    expect(worstDownloadBytes(sizeReport([], 61 * MB))).toBe(61 * MB);
  }

  it(
    'falls back to on-disk size when there are no per-device entries',
    fallsBackToOnDiskSizeWhenThereAreNoPerDeviceEntries,
  );
}

describe('worstDownloadBytes', describeWorstDownloadBytes);

function describeSizeSummary() {
  function showsBothNumbersWhenAPerDeviceEstimateExists() {
    expect(
      sizeSummary(
        sizeReport([{ device: 'a', downloadBytes: 47.2 * MB, installBytes: 0 }], 61.3 * MB),
      ),
    ).toBe('download 47.2 MB - on disk 61.3 MB');
  }

  it(
    'shows both numbers when a per-device estimate exists',
    showsBothNumbersWhenAPerDeviceEstimateExists,
  );

  function fallsBackToOnDiskAloneWhenThereIsNoPerDeviceEstimate() {
    expect(sizeSummary(sizeReport([], 61.3 * MB))).toBe('on disk 61.3 MB (no per-device estimate)');
  }

  it(
    'falls back to on-disk alone when there is no per-device estimate',
    fallsBackToOnDiskAloneWhenThereIsNoPerDeviceEstimate,
  );

  function appliesWrapSizeToEachSizeToken() {
    function sizeSummarySize(size: string) {
      return `[${size}]`;
    }

    expect(
      sizeSummary(
        sizeReport([{ device: 'a', downloadBytes: 10 * MB, installBytes: 0 }], 20 * MB),
        sizeSummarySize,
      ),
    ).toBe('download [10.0 MB] - on disk [20.0 MB]');
  }

  it('applies wrapSize to each size token', appliesWrapSizeToEachSizeToken);
}

describe('sizeSummary', describeSizeSummary);

function describeUploadSizeReadout() {
  function reportWithDownload(downloadMB: number, artifactMB: number = 64): SizeReport {
    return sizeReport(
      [{ device: 'iphone', downloadBytes: downloadMB * MB, installBytes: 0 }],
      artifactMB * MB,
    );
  }

  function showsDownloadOnDiskWithNoGrowthOnTheFirstBuild() {
    const readout = uploadSizeReadout(reportWithDownload(38, 61));
    expect(readout.lines).toEqual(['download 38.0 MB', 'on disk 61.0 MB']);
    expect(readout.grew).toBeNull();
  }

  it(
    'shows download + on-disk with no growth on the first build',
    showsDownloadOnDiskWithNoGrowthOnTheFirstBuild,
  );

  function appendsASignedDeltaAgainstThePreviousBuild() {
    const readout = uploadSizeReadout(reportWithDownload(38), {
      downloadBytes: 33.8 * MB,
      buildNumber: 41,
    });

    expect(readout.lines[0]).toBe('download 38.0 MB (+4.2 MB since build 41)');
  }

  it(
    'appends a signed delta against the previous build',
    appendsASignedDeltaAgainstThePreviousBuild,
  );

  function warnsWhenDownloadGrowsMoreThan10OverThePreviousBuild() {
    const readout = uploadSizeReadout(reportWithDownload(38), {
      downloadBytes: 33.8 * MB,
      buildNumber: 41,
    });

    expect(readout.grew).toEqual({ pct: 12, buildNumber: 41 });
  }

  it(
    'warns when download grows more than 10% over the previous build',
    warnsWhenDownloadGrowsMoreThan10OverThePreviousBuild,
  );

  function doesNotWarnForGrowthAtOrUnder10() {
    const readout = uploadSizeReadout(reportWithDownload(36), {
      downloadBytes: 33.8 * MB,
      buildNumber: 41,
    });

    expect(readout.grew).toBeNull();
  }

  it('does not warn for growth at or under 10%', doesNotWarnForGrowthAtOrUnder10);

  function showsANegativeDeltaWithoutAGrowthWarningWhenTheBuildShrank() {
    const readout = uploadSizeReadout(reportWithDownload(30), {
      downloadBytes: 33.8 * MB,
      buildNumber: 41,
    });

    expect(readout.lines[0]).toBe('download 30.0 MB (-3.8 MB since build 41)');
    expect(readout.grew).toBeNull();
  }

  it(
    'shows a negative delta without a growth warning when the build shrank',
    showsANegativeDeltaWithoutAGrowthWarningWhenTheBuildShrank,
  );

  function fallsBackToOnDiskOnlyWhenThereIsNoPerDeviceEstimate() {
    const readout = uploadSizeReadout(sizeReport([], 61 * MB), {
      downloadBytes: 10 * MB,
      buildNumber: 1,
    });

    expect(readout.lines).toEqual(['on disk 61.0 MB (no per-device estimate)']);
    expect(readout.grew).toBeNull();
  }

  it(
    'falls back to on-disk only when there is no per-device estimate',
    fallsBackToOnDiskOnlyWhenThereIsNoPerDeviceEstimate,
  );
}

describe('uploadSizeReadout', describeUploadSizeReadout);

function describeReceiptDestination() {
  function reportsNotUploadedWhenSubmitIsOff() {
    const buildRun = buildRunOptions({ submit: false });
    expect(receiptDestination('ios', buildRun)).toBe('built - not uploaded');
  }

  it('reports not uploaded when submit is off', reportsNotUploadedWhenSubmitIsOff);

  function namesTestFlightForUploadedAppleBuilds() {
    const buildRun = buildRunOptions();
    expect(receiptDestination('ios', buildRun)).toBe('TestFlight');
  }

  it('names TestFlight for uploaded Apple builds', namesTestFlightForUploadedAppleBuilds);

  function defaultsAndroidTrackToInternal() {
    const buildRun = buildRunOptions({ platform: 'android' });
    expect(receiptDestination('android', buildRun)).toBe('Play - internal track');
  }

  it('defaults Android track to internal', defaultsAndroidTrackToInternal);

  function usesTheNamedAndroidTrackWhenProvided() {
    const buildRun = buildRunOptions({ platform: 'android' });
    expect(receiptDestination('android', buildRun, 'production')).toBe('Play - production track');
  }

  it('uses the named Android track when provided', usesTheNamedAndroidTrackWhenProvided);
}

describe('receiptDestination', describeReceiptDestination);

function describeMakeNativeProjectFailure() {
  function tagsAMissingNativeProjectWithPlatformAndMessage() {
    const failure = makeNativeProjectFailure({
      platform: 'macos',
      message: 'commit a native project',
    });

    expect(failure).toEqual({
      _tag: 'NativeProjectFailure',
      platform: 'macos',
      message: 'commit a native project',
    });
  }

  it(
    'tags a missing native project with platform and message',
    tagsAMissingNativeProjectWithPlatformAndMessage,
  );
}

describe('makeNativeProjectFailure', describeMakeNativeProjectFailure);

type NativeProjectCase = Readonly<{
  platform: Platform;
  nativeDirExists: boolean;
  prebuild?: PrebuildMode;
  dryRun?: boolean;
}>;

let nativeAppDirectory = '';

function nativeProjectContext(platform: Platform, dryRun: boolean): BuildContext {
  return {
    platform,
    app: {
      name: 'Demo',
      dir: nativeAppDirectory,
      configPath: join(nativeAppDirectory, 'app.json'),
    },
    profile: { name: 'production' },
    env: {},
    explain: false,
    dryRun,
    forceClean: false,
  };
}

function committedNativeDirectory(platform: Platform): string {
  const isAndroid = platform == 'android';

  if (isAndroid) {
    return 'android';
  }

  return nativeProjectDirName(platform);
}

/** Run the matching ensure step against a real native directory; return the logged text. */
async function nativeProjectLog(nativeCase: NativeProjectCase): Promise<string> {
  const lines: string[] = [];

  useLoggerSink(function keepLine(text: string): void {
    lines.push(text);
  });

  const systemTemporaryDirectory = tmpdir();
  const launchNativePath = join(systemTemporaryDirectory, 'launch-native-');

  nativeAppDirectory = mkdtempSync(launchNativePath);

  try {
    const dryRun = nativeCase.dryRun != false;
    const buildContext = nativeProjectContext(nativeCase.platform, dryRun);
    const log = createLogger(false);

    if (nativeCase.nativeDirExists) {
      const joinedPath = join(nativeAppDirectory, committedNativeDirectory(nativeCase.platform));
      mkdirSync(joinedPath, {
        recursive: true,
      });
    }

    const isAndroid = nativeCase.platform == 'android';

    if (isAndroid) {
      await ensureAndroidProject(buildContext, log, nativeCase.prebuild);
      return lines.join('');
    }

    await ensureNativeProject(buildContext, log, nativeCase.prebuild);

    return lines.join('');
  } finally {
    resetLogger();
    rmSync(nativeAppDirectory, { recursive: true, force: true });
  }
}

function describeNativeProjectPrebuildMode() {
  function prepareNativeProjectPrebuildMode() {
    vi.mocked(runWithProgress).mockClear();
  }

  beforeEach(prepareNativeProjectPrebuildMode);

  async function reusesAnExistingIosByDefault() {
    const logged = await nativeProjectLog({ platform: 'ios', nativeDirExists: true });
    expect(logged).toContain('using existing ios/ (no prebuild needed)');
    expect(logged).not.toContain('expo prebuild');
  }

  it('reuses an existing ios/ by default', reusesAnExistingIosByDefault);

  async function prebuildsAMissingIosByDefault() {
    const logged = await nativeProjectLog({ platform: 'ios', nativeDirExists: false });
    expect(logged).toContain('would run `expo prebuild --platform ios --clean` (no ios/ found)');
  }

  it('prebuilds a missing ios/ by default', prebuildsAMissingIosByDefault);

  async function regeneratesAnExistingIosWithPrebuildAlways() {
    const logged = await nativeProjectLog({
      platform: 'ios',
      nativeDirExists: true,
      prebuild: 'always',
    });

    expect(logged).toContain(
      "would run `expo prebuild --platform ios --clean` (prebuild: 'always')",
    );
    expect(logged).not.toContain('using existing');
  }

  it(
    "regenerates an existing ios/ with prebuild: 'always'",
    regeneratesAnExistingIosWithPrebuildAlways,
  );

  async function keepsACommittedTvOSProjectWithPrebuildAlways() {
    const logged = await nativeProjectLog({
      platform: 'tvos',
      nativeDirExists: true,
      prebuild: 'always',
    });

    expect(logged).toContain('using existing ios/ (no prebuild needed)');
    expect(logged).not.toContain('expo prebuild');
  }

  it(
    "keeps a committed tvOS project with prebuild: 'always'",
    keepsACommittedTvOSProjectWithPrebuildAlways,
  );

  async function reusesAnExistingAndroidByDefault() {
    const logged = await nativeProjectLog({ platform: 'android', nativeDirExists: true });
    expect(logged).toContain('using existing android/ (no prebuild needed)');
    expect(logged).not.toContain('expo prebuild');
  }

  it('reuses an existing android/ by default', reusesAnExistingAndroidByDefault);

  async function regeneratesAnExistingAndroidWithPrebuildAlways() {
    const logged = await nativeProjectLog({
      platform: 'android',
      nativeDirExists: true,
      prebuild: 'always',
    });

    expect(logged).toContain(
      "would run `expo prebuild --platform android --clean` (prebuild: 'always')",
    );
    expect(logged).not.toContain('using existing');
  }

  it(
    "regenerates an existing android/ with prebuild: 'always'",
    regeneratesAnExistingAndroidWithPrebuildAlways,
  );

  async function runsACleanIOSPrebuildInTheAppDirOnARealBuildWithPrebuildAlways() {
    await nativeProjectLog({
      platform: 'ios',
      nativeDirExists: true,
      prebuild: 'always',
      dryRun: false,
    });
    expect(runWithProgress).toHaveBeenCalledWith(
      'npx',
      ['expo', 'prebuild', '--platform', 'ios', '--clean'],
      expect.objectContaining({ cwd: nativeAppDirectory }),
    );
  }

  it(
    "runs a clean iOS prebuild in the app dir on a real build with prebuild: 'always'",
    runsACleanIOSPrebuildInTheAppDirOnARealBuildWithPrebuildAlways,
  );

  async function runsACleanAndroidPrebuildInTheAppDirOnARealBuildWithPrebuildAlways() {
    await nativeProjectLog({
      platform: 'android',
      nativeDirExists: true,
      prebuild: 'always',
      dryRun: false,
    });
    expect(runWithProgress).toHaveBeenCalledWith(
      'npx',
      ['expo', 'prebuild', '--platform', 'android', '--clean'],
      expect.objectContaining({ cwd: nativeAppDirectory }),
    );
  }

  it(
    "runs a clean Android prebuild in the app dir on a real build with prebuild: 'always'",
    runsACleanAndroidPrebuildInTheAppDirOnARealBuildWithPrebuildAlways,
  );

  async function runsNoPrebuildOnARealBuildThatReusesTheNativeDir() {
    await nativeProjectLog({ platform: 'ios', nativeDirExists: true, dryRun: false });
    await nativeProjectLog({ platform: 'android', nativeDirExists: true, dryRun: false });
    expect(runWithProgress).not.toHaveBeenCalled();
  }

  it(
    'runs no prebuild on a real build that reuses the native dir',
    runsNoPrebuildOnARealBuildThatReusesTheNativeDir,
  );
}

describe('native project prebuild mode', describeNativeProjectPrebuildMode);
