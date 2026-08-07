import { describe, expect, it } from 'vitest';
import type { SizeReport } from '../types/artifacts.js';
import type { BuildRunOptions } from './pipelineTypes.js';
import {
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
