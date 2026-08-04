import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import {
  assembleGymArguments,
  buildExtraXcargs,
  buildSigningXcargs,
  computeParallelJobLimit,
  resolveCcacheEnvironment,
} from './buildFlags.js';
import type { GymArgsInput } from './buildFlags.js';
import { LaunchEnvironmentTest, makeLaunchEnvironmentTest } from '../services/environment.js';
const GB = 1024 ** 3;
/** A fixed gym input so a test can assert the exact argv. The signing/jobs feed `buildSigningXcargs`. */
const BASE_GYM: Omit<GymArgsInput, 'buildDestination'> = {
  workspace: '/app/ios/MyApp.xcworkspace',
  scheme: 'MyApp',
  outputDir: '/tmp/out',
  outputName: 'MyApp.ipa',
  exportOptionsPath: '/tmp/out/ExportOptions.plist',
  signing: { teamId: 'ABCDE12345', certName: 'Apple Distribution' },
  parallelJobLimit: 6,
  shouldCleanBuild: false,
};
describe('computeParallelJobLimit - RAM-aware parallelism cap', () => {
  it('returns undefined (no cap) when floor(GB/2) meets or exceeds the core count', () => {
    expect(Effect.runSync(computeParallelJobLimit(8, 16 * GB))).toBeUndefined(); // floor(8) === 8 cores
    expect(Effect.runSync(computeParallelJobLimit(10, 32 * GB))).toBeUndefined(); // floor(16) clamps to 10
    expect(Effect.runSync(computeParallelJobLimit(2, 64 * GB))).toBeUndefined();
  });
  it('caps below the core count on RAM-constrained machines', () => {
    expect(Effect.runSync(computeParallelJobLimit(8, 8 * GB))).toBe(4); // floor(4) < 8
    expect(Effect.runSync(computeParallelJobLimit(8, 4 * GB))).toBe(2); // floor(2) < 8
  });
  it('never drops below 2 even on tiny RAM', () => {
    expect(Effect.runSync(computeParallelJobLimit(4, 3 * GB))).toBe(2); // floor(1.5)=1 -> floored to 2
  });
});
describe('resolveCcacheEnvironment - wires the compiler cache on', () => {
  it('sets only USE_CCACHE (ccache uses its own default cache dir)', () => {
    expect(
      Effect.runSync(resolveCcacheEnvironment().pipe(Effect.provide(LaunchEnvironmentTest))),
    ).toEqual({ USE_CCACHE: '1' });
  });
  it('returns empty when explicitly disabled via parameter', () => {
    expect(
      Effect.runSync(resolveCcacheEnvironment(true).pipe(Effect.provide(LaunchEnvironmentTest))),
    ).toEqual({});
  });
  it('returns empty when USE_CCACHE=0 is set in the environment', () => {
    const disabledCcacheEnvironment = makeLaunchEnvironmentTest({ USE_CCACHE: '0' });
    expect(
      Effect.runSync(resolveCcacheEnvironment().pipe(Effect.provide(disabledCcacheEnvironment))),
    ).toEqual({});
  });
});
describe('buildExtraXcargs - always-on headless tuning', () => {
  it("disables the index store and omits -jobs when there's no cap", () => {
    expect(Effect.runSync(buildExtraXcargs(undefined))).toBe('COMPILER_INDEX_STORE_ENABLE=NO');
  });
  it('appends -jobs when a cap is set', () => {
    expect(Effect.runSync(buildExtraXcargs(6))).toBe('COMPILER_INDEX_STORE_ENABLE=NO -jobs 6');
  });
});
describe('buildSigningXcargs - workspace-safe signing + the shared extras', () => {
  it('carries the team and manual style plus the headless tuning', () => {
    const xcargs = Effect.runSync(buildSigningXcargs({ teamId: 'ABCDE12345' }, 6));
    expect(xcargs).toContain('DEVELOPMENT_TEAM=ABCDE12345');
    expect(xcargs).toContain('CODE_SIGN_STYLE=Manual');
    expect(xcargs).toContain('COMPILER_INDEX_STORE_ENABLE=NO');
    expect(xcargs).toContain('-jobs 6');
  });
  it('never emits a global PROVISIONING_PROFILE_SPECIFIER - it leaks onto Pods and fails Xcode 26 (#301)', () => {
    // A command-line specifier applies to EVERY workspace target, including the CocoaPods library targets
    // that can't carry a profile - on Xcode 26 that's a hard "does not support provisioning profiles"
    // archive failure (exit 65), and it would also clobber an extension's own bundle. The app's profile is
    // stamped into the app target's pbxproj instead (see appleTargets.writeManualSigningToProject), so the
    // specifier must never appear in the shared xcargs, single-target or not.
    const xcargs = Effect.runSync(buildSigningXcargs({ teamId: 'ABCDE12345' }, 6));
    expect(xcargs).not.toContain('PROVISIONING_PROFILE_SPECIFIER');
  });
});
describe('assembleGymArguments - one source for the gym argv; the cross-platform path never touches iOS', () => {
  it('emits the canonical iOS vector when destination is undefined (no --destination)', () => {
    // The pinned iOS command. It no longer carries a global PROVISIONING_PROFILE_SPECIFIER: that moved
    // into the app target's pbxproj (issue #301) so it can't leak onto the Pods targets. If this array
    // changes for any OTHER reason, an iOS build changed - the regression the cross-platform work must
    // NOT introduce.
    expect(
      Effect.runSync(assembleGymArguments({ ...BASE_GYM, buildDestination: undefined })),
    ).toEqual([
      'gym',
      '--workspace',
      '/app/ios/MyApp.xcworkspace',
      '--scheme',
      'MyApp',
      '--output_directory',
      '/tmp/out',
      '--output_name',
      'MyApp.ipa',
      '--export_options',
      '/tmp/out/ExportOptions.plist',
      '--codesigning_identity',
      'Apple Distribution',
      '--xcargs',
      'DEVELOPMENT_TEAM=ABCDE12345 CODE_SIGN_STYLE=Manual COMPILER_INDEX_STORE_ENABLE=NO -jobs 6',
    ]);
  });
  it('never inserts a --destination flag for iOS, with or without --clean', () => {
    expect(
      Effect.runSync(assembleGymArguments({ ...BASE_GYM, buildDestination: undefined })),
    ).not.toContain('--destination');
    expect(
      Effect.runSync(
        assembleGymArguments({
          ...BASE_GYM,
          shouldCleanBuild: true,
          buildDestination: undefined,
        }),
      ),
    ).not.toContain('--destination');
  });
  it('injects --destination right after --xcargs for the other Apple platforms', () => {
    const args = Effect.runSync(
      assembleGymArguments({ ...BASE_GYM, buildDestination: 'generic/platform=tvOS' }),
    );
    const i = args.indexOf('--destination');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('generic/platform=tvOS');
    expect(args[i - 2]).toBe('--xcargs'); // sits immediately after the xcargs pair
  });
  it('keeps --clean last so the iOS prefix is identical whether or not a destination is present', () => {
    const args = Effect.runSync(
      assembleGymArguments({
        ...BASE_GYM,
        shouldCleanBuild: true,
        buildDestination: 'generic/platform=macOS',
      }),
    );
    expect(args[args.length - 1]).toBe('--clean');
    expect(args).toContain('--destination');
  });
  it('never carries a global provisioning-profile specifier in the gym argv (any platform)', () => {
    // The profile lives in the app target's pbxproj, not the gym argv, so no build variant may pin it on
    // the command line where it would reach the Pods targets (issue #301).
    for (const buildDestination of [undefined, 'generic/platform=tvOS', 'generic/platform=macOS']) {
      const args = Effect.runSync(assembleGymArguments({ ...BASE_GYM, buildDestination }));
      const xcargs = args[args.indexOf('--xcargs') + 1];
      expect(xcargs).not.toContain('PROVISIONING_PROFILE_SPECIFIER');
    }
  });
});
