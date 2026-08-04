import type { FileSystem, Path } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LaunchPathsService, makeLaunchPathsTest } from '../services/paths.js';
import {
  type BuildState,
  type FingerprintParts,
  computeBuildFingerprint,
  estimateFor,
  extractNativeConfigSlice,
  readBuildState,
  resolveClean,
  updateEstimate,
  writeBuildState,
} from './buildFingerprint.js';

const FINGERPRINT_PARTS: FingerprintParts = {
  podfileLock: 'PODS:\n  - Reanimated (4.1.6)\n',
  podfileProperties: '{"newArchEnabled":"true"}',
  appConfigSlice: '{"plugins":["expo-router"],"newArchEnabled":true,"iosDeploymentTarget":"15.1"}',
  toolchainVersion: 'Xcode 16.0\nBuild version 16A242d',
};

const runFingerprintEffect = <Success>(fingerprintEffect: Effect.Effect<Success, unknown, never>) =>
  Effect.runPromise(fingerprintEffect);

describe('computeBuildFingerprint', () => {
  it('is deterministic for identical inputs', () => {
    expect(computeBuildFingerprint(FINGERPRINT_PARTS)).toBe(
      computeBuildFingerprint({ ...FINGERPRINT_PARTS }),
    );
  });

  it('changes when any native input changes', () => {
    const baseFingerprint = computeBuildFingerprint(FINGERPRINT_PARTS);
    expect(
      computeBuildFingerprint({
        ...FINGERPRINT_PARTS,
        podfileLock: `${FINGERPRINT_PARTS.podfileLock} `,
      }),
    ).not.toBe(baseFingerprint);
    expect(computeBuildFingerprint({ ...FINGERPRINT_PARTS, podfileProperties: '{}' })).not.toBe(
      baseFingerprint,
    );
    expect(computeBuildFingerprint({ ...FINGERPRINT_PARTS, appConfigSlice: '{}' })).not.toBe(
      baseFingerprint,
    );
    expect(
      computeBuildFingerprint({ ...FINGERPRINT_PARTS, toolchainVersion: 'Xcode 16.1' }),
    ).not.toBe(baseFingerprint);
  });

  it('separates adjacent fields', () => {
    const firstFingerprint = computeBuildFingerprint({
      ...FINGERPRINT_PARTS,
      podfileLock: 'ab',
      podfileProperties: 'c',
    });
    const secondFingerprint = computeBuildFingerprint({
      ...FINGERPRINT_PARTS,
      podfileLock: 'a',
      podfileProperties: 'bc',
    });
    expect(firstFingerprint).not.toBe(secondFingerprint);
  });
});

describe('extractNativeConfigSlice', () => {
  it('reads native fields through the Expo wrapper', () => {
    const nativeSlice = extractNativeConfigSlice(
      JSON.stringify({
        expo: {
          name: 'Demo',
          plugins: ['expo-router'],
          newArchEnabled: true,
          ios: { deploymentTarget: '15.1' },
        },
      }),
    );
    expect(JSON.parse(nativeSlice)).toEqual({
      plugins: ['expo-router'],
      newArchEnabled: true,
      iosDeploymentTarget: '15.1',
    });
  });

  it('ignores fields that do not affect the native graph', () => {
    const beforeSlice = extractNativeConfigSlice(
      JSON.stringify({ expo: { name: 'Before', plugins: ['x'] } }),
    );
    const afterSlice = extractNativeConfigSlice(
      JSON.stringify({ expo: { name: 'After', plugins: ['x'] } }),
    );
    expect(beforeSlice).toBe(afterSlice);
  });

  it('supports a flat config shape', () => {
    const nativeSlice = extractNativeConfigSlice(
      JSON.stringify({ plugins: ['a'], newArchEnabled: false }),
    );
    expect(JSON.parse(nativeSlice)).toEqual({
      plugins: ['a'],
      newArchEnabled: false,
      iosDeploymentTarget: null,
    });
  });

  it('keeps dynamic config text so edits invalidate the fingerprint', () => {
    const dynamicConfig = "export default ({ config }) => ({ ...config, plugins: ['x'] });";
    expect(extractNativeConfigSlice(dynamicConfig)).toBe(dynamicConfig);
  });
});

describe('resolveClean', () => {
  const storedBuild: BuildState = {
    fingerprint: 'abc',
    builtAt: '2026-06-14T00:00:00Z',
    cleanBuilt: true,
  };

  it('forces a clean when requested', () => {
    expect(resolveClean(true, storedBuild, 'abc')).toMatchObject({
      clean: true,
      nativeChanged: false,
    });
    expect(resolveClean(true, storedBuild, 'xyz')).toMatchObject({
      clean: true,
      nativeChanged: true,
    });
  });

  it('cleans on the first build or a changed fingerprint', () => {
    expect(resolveClean(false, null, 'abc')).toMatchObject({ clean: true, nativeChanged: true });
    expect(resolveClean(false, storedBuild, 'xyz')).toMatchObject({
      clean: true,
      nativeChanged: true,
    });
  });

  it('reuses caches when the fingerprint matches', () => {
    expect(resolveClean(false, storedBuild, 'abc')).toMatchObject({
      clean: false,
      nativeChanged: false,
    });
  });
});

describe('build state storage', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'launch-fp-'));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const provideTestServices = <Success>(
    buildStateEffect: Effect.Effect<
      Success,
      unknown,
      FileSystem.FileSystem | LaunchPathsService | Path.Path
    >,
  ) =>
    buildStateEffect.pipe(
      Effect.provide(makeLaunchPathsTest(temporaryDirectory, temporaryDirectory)),
      Effect.provide(NodeContext.layer),
    );

  it('returns null before a state is written', async () => {
    const storedBuild = await runFingerprintEffect(
      provideTestServices(readBuildState('demo', 'ios', temporaryDirectory)),
    );
    expect(storedBuild).toBeNull();
  });

  it('round-trips state by app and platform', async () => {
    const buildState: BuildState = {
      fingerprint: 'abc',
      builtAt: '2026-06-14T00:00:00Z',
      cleanBuilt: false,
      estimates: {
        clean: { ms: 214000, steps: 660 },
        incremental: { ms: 41000, steps: 28 },
      },
    };
    await runFingerprintEffect(
      provideTestServices(writeBuildState('demo', 'ios', buildState, temporaryDirectory)),
    );
    expect(
      await runFingerprintEffect(
        provideTestServices(readBuildState('demo', 'ios', temporaryDirectory)),
      ),
    ).toEqual(buildState);
    expect(
      await runFingerprintEffect(
        provideTestServices(readBuildState('demo', 'android', temporaryDirectory)),
      ),
    ).toBeNull();
  });
});

describe('build estimates', () => {
  it('adopts the first sample and smooths later samples', () => {
    expect(updateEstimate(undefined, { ms: 41000, steps: 28 })).toEqual({
      ms: 41000,
      steps: 28,
    });
    expect(updateEstimate({ ms: 41000, steps: 28 }, { ms: 80000, steps: 40 })).toEqual({
      ms: 60500,
      steps: 34,
    });
  });

  it('uses a custom smoothing weight', () => {
    expect(updateEstimate({ ms: 100, steps: 10 }, { ms: 200, steps: 20 }, 0.25)).toEqual({
      ms: 125,
      steps: 13,
    });
  });

  it('selects the estimate for the requested build kind', () => {
    const buildState: BuildState = {
      fingerprint: 'abc',
      builtAt: '2026-06-14T00:00:00Z',
      cleanBuilt: false,
      estimates: { incremental: { ms: 41000, steps: 28 } },
    };
    expect(estimateFor(buildState, 'incremental')).toEqual({ ms: 41000, steps: 28 });
    expect(estimateFor(buildState, 'clean')).toBeUndefined();
    expect(estimateFor(null, 'clean')).toBeUndefined();
  });
});
