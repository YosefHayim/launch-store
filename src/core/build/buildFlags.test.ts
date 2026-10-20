import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import {
  assembleArchiveArguments,
  assembleExportArguments,
  computeParallelJobLimit,
  resolveCcacheEnvironment,
} from './buildFlags.js';
import type { ArchiveArgsInput } from './buildFlags.js';
import { LaunchEnvironmentTest, makeLaunchEnvironmentTest } from '../services/environment.js';
const GB = 1024 ** 3;
const BASE_ARCHIVE: ArchiveArgsInput = {
  workspace: '/app/ios/MyApp.xcworkspace',
  scheme: 'MyApp',
  archivePath: '/out/MyApp.xcarchive',
  signing: { teamId: 'ABCDE12345', certName: 'Apple Distribution' },
  parallelJobLimit: 6,
  shouldCleanBuild: false,
  buildDestination: 'generic/platform=iOS',
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
describe('assembleArchiveArguments - the xcodebuild archive argv', () => {
  it('emits the canonical iOS vector with the generic device destination', () => {
    expect(Effect.runSync(assembleArchiveArguments(BASE_ARCHIVE))).toEqual([
      '-workspace',
      '/app/ios/MyApp.xcworkspace',
      '-scheme',
      'MyApp',
      '-configuration',
      'Release',
      '-archivePath',
      '/out/MyApp.xcarchive',
      '-destination',
      'generic/platform=iOS',
      'DEVELOPMENT_TEAM=ABCDE12345',
      'CODE_SIGN_STYLE=Manual',
      'CODE_SIGN_IDENTITY=Apple Distribution',
      'COMPILER_INDEX_STORE_ENABLE=NO',
      '-jobs',
      '6',
      'archive',
    ]);
  });
  it('omits -jobs when there is no parallel cap', () => {
    const archiveArguments = Effect.runSync(
      assembleArchiveArguments({ ...BASE_ARCHIVE, parallelJobLimit: undefined }),
    );
    expect(archiveArguments).not.toContain('-jobs');
  });
  it('puts clean right before archive for a clean build', () => {
    const archiveArguments = Effect.runSync(
      assembleArchiveArguments({ ...BASE_ARCHIVE, shouldCleanBuild: true }),
    );
    expect(archiveArguments.slice(-2)).toEqual(['clean', 'archive']);
  });
  it('targets the given destination for the other Apple platforms', () => {
    const archiveArguments = Effect.runSync(
      assembleArchiveArguments({ ...BASE_ARCHIVE, buildDestination: 'generic/platform=tvOS' }),
    );
    const destinationIndex = archiveArguments.indexOf('-destination');
    expect(archiveArguments[destinationIndex + 1]).toBe('generic/platform=tvOS');
  });
  it('never carries a global provisioning-profile specifier or an automatic-provisioning flag', () => {
    const archiveArguments = Effect.runSync(
      assembleArchiveArguments({ ...BASE_ARCHIVE, shouldCleanBuild: true }),
    );
    const specifiers = archiveArguments.filter((argument) =>
      argument.includes('PROVISIONING_PROFILE_SPECIFIER'),
    );
    expect(specifiers).toEqual([]);
    expect(archiveArguments).not.toContain('-allowProvisioningUpdates');
  });
});
describe('assembleExportArguments - the xcodebuild -exportArchive argv', () => {
  it('exports the archive with the options plist into the export path', () => {
    expect(
      Effect.runSync(
        assembleExportArguments({
          archivePath: '/out/MyApp.xcarchive',
          exportOptionsPath: '/out/ExportOptions.plist',
          exportPath: '/out',
        }),
      ),
    ).toEqual([
      '-exportArchive',
      '-archivePath',
      '/out/MyApp.xcarchive',
      '-exportOptionsPlist',
      '/out/ExportOptions.plist',
      '-exportPath',
      '/out',
    ]);
  });
});
