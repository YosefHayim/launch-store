import { FileSystem } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { LaunchEnvironmentTest } from '../services/environment.js';
import { LaunchLogger, makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import type { Platform } from '../types/app.js';
import type { SizeReport } from '../types/artifacts.js';
import type { PrebuildMode, ResolvedBuildContext } from '../types/config.js';
import type { BuildRunOptions } from './pipelineTypes.js';
import {
  ensureAndroidProject,
  ensureNativeProject,
  makeNativeProjectFailure,
  receiptDestination,
  sizeSummary,
  uploadSizeReadout,
  worstDownloadBytes,
} from './pipelineArtifact.js';

const MB = 1024 * 1024;

const sizeReport = (entries: SizeReport['entries'], artifactBytes = 64 * MB): SizeReport => ({
  artifactBytes,
  entries,
});

const buildRunOptions = (overrides: Partial<BuildRunOptions> = {}): BuildRunOptions => ({
  platform: 'ios',
  profileName: 'production',
  explain: false,
  submit: true,
  target: 'testing',
  dryRun: false,
  ...overrides,
});

describe('worstDownloadBytes', () => {
  it('picks the largest per-device download', () => {
    expect(
      worstDownloadBytes(
        sizeReport([
          { device: 'a', downloadBytes: 40 * MB, installBytes: 0 },
          { device: 'b', downloadBytes: 47 * MB, installBytes: 0 },
        ]),
      ),
    ).toBe(47 * MB);
  });

  it('falls back to on-disk size when there are no per-device entries', () => {
    expect(worstDownloadBytes(sizeReport([], 61 * MB))).toBe(61 * MB);
  });
});

describe('sizeSummary', () => {
  it('shows both numbers when a per-device estimate exists', () => {
    expect(
      sizeSummary(
        sizeReport([{ device: 'a', downloadBytes: 47.2 * MB, installBytes: 0 }], 61.3 * MB),
      ),
    ).toBe('download 47.2 MB - on disk 61.3 MB');
  });

  it('falls back to on-disk alone when there is no per-device estimate', () => {
    expect(sizeSummary(sizeReport([], 61.3 * MB))).toBe('on disk 61.3 MB (no per-device estimate)');
  });

  it('applies wrapSize to each size token', () => {
    expect(
      sizeSummary(
        sizeReport([{ device: 'a', downloadBytes: 10 * MB, installBytes: 0 }], 20 * MB),
        (size) => `[${size}]`,
      ),
    ).toBe('download [10.0 MB] - on disk [20.0 MB]');
  });
});

describe('uploadSizeReadout', () => {
  const reportWithDownload = (downloadMB: number, artifactMB = 64): SizeReport =>
    sizeReport(
      [{ device: 'iphone', downloadBytes: downloadMB * MB, installBytes: 0 }],
      artifactMB * MB,
    );

  it('shows download + on-disk with no growth on the first build', () => {
    const readout = uploadSizeReadout(reportWithDownload(38, 61));
    expect(readout.lines).toEqual(['download 38.0 MB', 'on disk 61.0 MB']);
    expect(readout.grew).toBeNull();
  });

  it('appends a signed delta against the previous build', () => {
    const readout = uploadSizeReadout(reportWithDownload(38), {
      downloadBytes: 33.8 * MB,
      buildNumber: 41,
    });
    expect(readout.lines[0]).toBe('download 38.0 MB (+4.2 MB since build 41)');
  });

  it('warns when download grows more than 10% over the previous build', () => {
    const readout = uploadSizeReadout(reportWithDownload(38), {
      downloadBytes: 33.8 * MB,
      buildNumber: 41,
    });
    expect(readout.grew).toEqual({ pct: 12, buildNumber: 41 });
  });

  it('does not warn for growth at or under 10%', () => {
    const readout = uploadSizeReadout(reportWithDownload(36), {
      downloadBytes: 33.8 * MB,
      buildNumber: 41,
    });
    expect(readout.grew).toBeNull();
  });

  it('shows a negative delta without a growth warning when the build shrank', () => {
    const readout = uploadSizeReadout(reportWithDownload(30), {
      downloadBytes: 33.8 * MB,
      buildNumber: 41,
    });
    expect(readout.lines[0]).toBe('download 30.0 MB (-3.8 MB since build 41)');
    expect(readout.grew).toBeNull();
  });

  it('falls back to on-disk only when there is no per-device estimate', () => {
    const readout = uploadSizeReadout(sizeReport([], 61 * MB), {
      downloadBytes: 10 * MB,
      buildNumber: 1,
    });
    expect(readout.lines).toEqual(['on disk 61.0 MB (no per-device estimate)']);
    expect(readout.grew).toBeNull();
  });
});

describe('receiptDestination', () => {
  it('reports not uploaded when submit is off', () => {
    expect(receiptDestination('ios', buildRunOptions({ submit: false }))).toBe(
      'built - not uploaded',
    );
  });

  it('names TestFlight for Apple testing targets', () => {
    expect(receiptDestination('ios', buildRunOptions({ target: 'testing' }))).toBe('TestFlight');
  });

  it('names App Store review for Apple production targets', () => {
    expect(receiptDestination('ios', buildRunOptions({ target: 'production' }))).toBe(
      'App Store - in review',
    );
  });

  it('defaults Android track to internal', () => {
    expect(receiptDestination('android', buildRunOptions({ platform: 'android' }))).toBe(
      'Play - internal track',
    );
  });

  it('uses the named Android track when provided', () => {
    expect(
      receiptDestination('android', buildRunOptions({ platform: 'android' }), 'production'),
    ).toBe('Play - production track');
  });
});

describe('makeNativeProjectFailure', () => {
  it('tags a missing native project with platform and message', () => {
    const failure = makeNativeProjectFailure({
      platform: 'macos',
      message: 'commit a native project',
    });
    expect(failure).toEqual({
      _tag: 'NativeProjectFailure',
      platform: 'macos',
      message: 'commit a native project',
    });
  });
});

type NativeProjectCase = Readonly<{
  platform: Platform;
  nativeDirExists: boolean;
  prebuild?: PrebuildMode;
}>;

const dryRunContext = (platform: Platform): ResolvedBuildContext => ({
  platform,
  app: { name: 'Demo', dir: '/repo/apps/demo', configPath: '/repo/apps/demo/app.json' },
  profile: { name: 'production' },
  env: {},
  explain: false,
  dryRun: true,
  forceClean: false,
});

/** Run the matching ensure step in dry-run against a stubbed `exists`; return the logged text. */
const nativeProjectLog = async (nativeCase: NativeProjectCase): Promise<string> => {
  const lines: string[] = [];
  const fileSystem = FileSystem.layerNoop({
    exists: () => Effect.succeed(nativeCase.nativeDirExists),
  });
  const program = Effect.gen(function* () {
    const log = yield* LaunchLogger;
    const buildContext = dryRunContext(nativeCase.platform);
    if (nativeCase.platform === 'android') {
      yield* ensureAndroidProject(buildContext, log, nativeCase.prebuild);
      return;
    }
    yield* ensureNativeProject(buildContext, log, nativeCase.prebuild);
  });
  await Effect.runPromise(
    program.pipe(
      Effect.provide(makeLaunchLoggerTest(lines)),
      Effect.provide(fileSystem),
      Effect.provide(makeLaunchPathsTest('/home/demo', '/repo')),
      Effect.provide(LaunchEnvironmentTest),
      Effect.provide(NodeContext.layer),
    ),
  );
  return lines.join('');
};

describe('native project prebuild mode', () => {
  it('reuses an existing ios/ by default', async () => {
    const logged = await nativeProjectLog({ platform: 'ios', nativeDirExists: true });
    expect(logged).toContain('using existing ios/ (no prebuild needed)');
    expect(logged).not.toContain('expo prebuild');
  });

  it('prebuilds a missing ios/ by default', async () => {
    const logged = await nativeProjectLog({ platform: 'ios', nativeDirExists: false });
    expect(logged).toContain('would run `expo prebuild --platform ios --clean` (no ios/ found)');
  });

  it("regenerates an existing ios/ with prebuild: 'always'", async () => {
    const logged = await nativeProjectLog({
      platform: 'ios',
      nativeDirExists: true,
      prebuild: 'always',
    });
    expect(logged).toContain(
      "would run `expo prebuild --platform ios --clean` (prebuild: 'always')",
    );
    expect(logged).not.toContain('using existing');
  });

  it("keeps a committed tvOS project with prebuild: 'always'", async () => {
    const logged = await nativeProjectLog({
      platform: 'tvos',
      nativeDirExists: true,
      prebuild: 'always',
    });
    expect(logged).toContain('using existing ios/ (no prebuild needed)');
    expect(logged).not.toContain('expo prebuild');
  });

  it('reuses an existing android/ by default', async () => {
    const logged = await nativeProjectLog({ platform: 'android', nativeDirExists: true });
    expect(logged).toContain('using existing android/ (no prebuild needed)');
    expect(logged).not.toContain('expo prebuild');
  });

  it("regenerates an existing android/ with prebuild: 'always'", async () => {
    const logged = await nativeProjectLog({
      platform: 'android',
      nativeDirExists: true,
      prebuild: 'always',
    });
    expect(logged).toContain(
      "would run `expo prebuild --platform android --clean` (prebuild: 'always')",
    );
    expect(logged).not.toContain('using existing');
  });
});
