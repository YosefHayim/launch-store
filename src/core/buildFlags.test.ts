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
import process from 'node:process';

const GB = 1024 ** 3;

/** A fixed gym input so a test can assert the exact argv. The signing/jobs feed `buildSigningXcargs`. */
const BASE_GYM: Omit<GymArgsInput, 'buildDestination'> = {
  workspace: '/app/ios/MyApp.xcworkspace',
  scheme: 'MyApp',
  outputDir: '/tmp/out',
  outputName: 'MyApp.ipa',
  exportOptionsPath: '/tmp/out/ExportOptions.plist',
  signing: { teamId: 'ABCDE12345', profileName: 'Launch_AppStore', certName: 'Apple Distribution' },
  parallelJobLimit: 6,
  shouldCleanBuild: false,
};

describe('computeParallelJobLimit — RAM-aware parallelism cap', () => {
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
    expect(Effect.runSync(computeParallelJobLimit(4, 3 * GB))).toBe(2); // floor(1.5)=1 → floored to 2
  });
});

describe('resolveCcacheEnvironment — wires the compiler cache on', () => {
  it('sets only USE_CCACHE (ccache uses its own default cache dir)', () => {
    expect(Effect.runSync(resolveCcacheEnvironment())).toEqual({ USE_CCACHE: '1' });
  });

  it('returns empty when explicitly disabled via parameter', () => {
    expect(Effect.runSync(resolveCcacheEnvironment(true))).toEqual({});
  });

  it('returns empty when USE_CCACHE=0 is set in the environment', () => {
    const orig = process.env['USE_CCACHE'];
    try {
      process.env['USE_CCACHE'] = '0';
      expect(Effect.runSync(resolveCcacheEnvironment())).toEqual({});
    } finally {
      if (orig === undefined) delete process.env['USE_CCACHE'];
      else process.env['USE_CCACHE'] = orig;
    }
  });
});

describe('buildExtraXcargs — always-on headless tuning', () => {
  it("disables the index store and omits -jobs when there's no cap", () => {
    expect(Effect.runSync(buildExtraXcargs(undefined))).toBe('COMPILER_INDEX_STORE_ENABLE=NO');
  });

  it('appends -jobs when a cap is set', () => {
    expect(Effect.runSync(buildExtraXcargs(6))).toBe('COMPILER_INDEX_STORE_ENABLE=NO -jobs 6');
  });
});

describe('buildSigningXcargs — manual signing + the shared extras', () => {
  it('carries the resolved team/profile and the headless tuning', () => {
    const xcargs = Effect.runSync(
      buildSigningXcargs({ teamId: 'ABCDE12345', profileName: 'Launch_AppStore' }, 6),
    );
    expect(xcargs).toContain('DEVELOPMENT_TEAM=ABCDE12345');
    expect(xcargs).toContain('CODE_SIGN_STYLE=Manual');
    expect(xcargs).toContain('PROVISIONING_PROFILE_SPECIFIER=Launch_AppStore');
    expect(xcargs).toContain('COMPILER_INDEX_STORE_ENABLE=NO');
    expect(xcargs).toContain('-jobs 6');
  });

  it('drops the global provisioning-profile specifier when the app has extension targets', () => {
    // A command-line PROVISIONING_PROFILE_SPECIFIER applies to EVERY target, so pinning the main app's
    // profile would clobber the widget/extension bundle and fail the archive (exit 65). With extensions
    // present it's dropped — per-target profiles come from the project + the export plist (issue #262) —
    // while the team + manual style stay global.
    const xcargs = Effect.runSync(
      buildSigningXcargs(
        {
          teamId: 'ABCDE12345',
          profileName: 'Launch_AppStore',
          extensionProfiles: { 'com.acme.app.widget': 'Launch_Widget_AppStore' },
        },
        6,
      ),
    );
    expect(xcargs).not.toContain('PROVISIONING_PROFILE_SPECIFIER');
    expect(xcargs).toContain('DEVELOPMENT_TEAM=ABCDE12345');
    expect(xcargs).toContain('CODE_SIGN_STYLE=Manual');
    expect(xcargs).toContain('COMPILER_INDEX_STORE_ENABLE=NO');
    expect(xcargs).toContain('-jobs 6');
  });

  it('still pins the profile when extensionProfiles is present but empty (no real extensions)', () => {
    const xcargs = Effect.runSync(
      buildSigningXcargs(
        { teamId: 'ABCDE12345', profileName: 'Launch_AppStore', extensionProfiles: {} },
        6,
      ),
    );
    expect(xcargs).toContain('PROVISIONING_PROFILE_SPECIFIER=Launch_AppStore');
  });
});

describe('assembleGymArguments — one source for the gym argv; iOS stays byte-identical', () => {
  it('emits the EXACT historical iOS vector when destination is undefined (no --destination)', () => {
    // This is the pinned iOS command from before cross-platform builds existed. If this array changes,
    // an iOS build changed — the regression this whole feature must NOT introduce.
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
      'DEVELOPMENT_TEAM=ABCDE12345 CODE_SIGN_STYLE=Manual PROVISIONING_PROFILE_SPECIFIER=Launch_AppStore COMPILER_INDEX_STORE_ENABLE=NO -jobs 6',
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

  it('threads extension profiles so the multi-target argv omits the global specifier', () => {
    // The only difference from the single-target vector: the --xcargs value loses PROVISIONING_PROFILE_
    // SPECIFIER (the byte-identical test above proves single-target is untouched). Everything else stays.
    const args = Effect.runSync(
      assembleGymArguments({
        ...BASE_GYM,
        buildDestination: undefined,
        signing: {
          ...BASE_GYM.signing,
          extensionProfiles: { 'com.acme.app.widget': 'Launch_Widget_AppStore' },
        },
      }),
    );
    const xcargs = args[args.indexOf('--xcargs') + 1];
    expect(xcargs).not.toContain('PROVISIONING_PROFILE_SPECIFIER');
    expect(xcargs).toContain('DEVELOPMENT_TEAM=ABCDE12345');
    expect(xcargs).toContain('CODE_SIGN_STYLE=Manual');
  });
});
