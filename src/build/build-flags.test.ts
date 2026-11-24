import { afterEach, describe, expect, it } from 'vitest';
import { resetLaunchEnvironment, useLaunchEnvironment } from '../services/platform/environment.ts';
import {
  assembleArchiveArguments,
  assembleExportArguments,
  computeParallelJobLimit,
  readCcacheEnvironment,
} from './build-flags.ts';
import type { ArchiveArgsInput } from './build-flags.ts';

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

function cleanup() {
  resetLaunchEnvironment();
}

afterEach(cleanup);

function describeComputeParallelJobLimitRAMAwareParallelismCap() {
  function returnsUndefinedNoCapWhenFloorGB2MeetsOrExceedsTheCoreCount() {
    const parallelJobLimit = computeParallelJobLimit(8, 16 * GB);
    expect(parallelJobLimit).toBeUndefined(); // floor(8) == 8 cores
    expect(computeParallelJobLimit(10, 32 * GB)).toBeUndefined(); // floor(16) clamps to 10
    expect(computeParallelJobLimit(2, 64 * GB)).toBeUndefined();
  }

  it(
    'returns undefined (no cap) when floor(GB/2) meets or exceeds the core count',
    returnsUndefinedNoCapWhenFloorGB2MeetsOrExceedsTheCoreCount,
  );

  function capsBelowTheCoreCountOnRAMConstrainedMachines() {
    const parallelJobLimit = computeParallelJobLimit(8, 8 * GB);
    expect(parallelJobLimit).toBe(4); // floor(4) < 8
    expect(computeParallelJobLimit(8, 4 * GB)).toBe(2); // floor(2) < 8
  }

  it(
    'caps below the core count on RAM-constrained machines',
    capsBelowTheCoreCountOnRAMConstrainedMachines,
  );

  function neverDropsBelow2EvenOnTinyRAM() {
    const parallelJobLimit = computeParallelJobLimit(4, 3 * GB);
    expect(parallelJobLimit).toBe(2); // floor(1.5)=1 -> floored to 2
  }

  it('never drops below 2 even on tiny RAM', neverDropsBelow2EvenOnTinyRAM);
}

describe(
  'computeParallelJobLimit - RAM-aware parallelism cap',
  describeComputeParallelJobLimitRAMAwareParallelismCap,
);

function describeResolveCcacheEnvironmentWiresTheCompilerCacheOn() {
  function setsOnlyUSECCACHECcacheUsesItsOwnDefaultCacheDir() {
    useLaunchEnvironment({});
    const ccacheEnvironment = readCcacheEnvironment();
    expect(ccacheEnvironment).toEqual({ USE_CCACHE: '1' });
  }

  it(
    'sets only USE_CCACHE (ccache uses its own default cache dir)',
    setsOnlyUSECCACHECcacheUsesItsOwnDefaultCacheDir,
  );

  function returnsEmptyWhenExplicitlyDisabledViaParameter() {
    useLaunchEnvironment({ USE_CCACHE: '0' });
    const ccacheEnvironment = readCcacheEnvironment(true);
    expect(ccacheEnvironment).toEqual({});
  }

  it(
    'returns empty when explicitly disabled via parameter',
    returnsEmptyWhenExplicitlyDisabledViaParameter,
  );

  function returnsEmptyWhenUSECCACHE0IsSetInTheEnvironment() {
    useLaunchEnvironment({ USE_CCACHE: '0' });
    const ccacheEnvironment = readCcacheEnvironment();
    expect(ccacheEnvironment).toEqual({});
  }

  it(
    'returns empty when USE_CCACHE=0 is set in the environment',
    returnsEmptyWhenUSECCACHE0IsSetInTheEnvironment,
  );
}

describe(
  'readCcacheEnvironment - wires the compiler cache on',
  describeResolveCcacheEnvironmentWiresTheCompilerCacheOn,
);

function describeAssembleArchiveArgumentsTheXcodebuildArchiveArgv() {
  function emitsTheCanonicalIOSVectorWithTheGenericDeviceDestination() {
    expect(assembleArchiveArguments(BASE_ARCHIVE)).toEqual([
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
  }

  it(
    'emits the canonical iOS vector with the generic device destination',
    emitsTheCanonicalIOSVectorWithTheGenericDeviceDestination,
  );

  function omitsJobsWhenThereIsNoParallelCap() {
    const archiveArguments = assembleArchiveArguments({
      ...BASE_ARCHIVE,
      parallelJobLimit: undefined,
    });

    expect(archiveArguments).not.toContain('-jobs');
  }

  it('omits -jobs when there is no parallel cap', omitsJobsWhenThereIsNoParallelCap);

  function putsCleanRightBeforeArchiveForACleanBuild() {
    const archiveArguments = assembleArchiveArguments({ ...BASE_ARCHIVE, shouldCleanBuild: true });
    expect(archiveArguments.slice(-2)).toEqual(['clean', 'archive']);
  }

  it(
    'puts clean right before archive for a clean build',
    putsCleanRightBeforeArchiveForACleanBuild,
  );

  function targetsTheGivenDestinationForTheOtherApplePlatforms() {
    const archiveArguments = assembleArchiveArguments({
      ...BASE_ARCHIVE,
      buildDestination: 'generic/platform=tvOS',
    });
    const destinationIndex = archiveArguments.indexOf('-destination');

    expect(archiveArguments[destinationIndex + 1]).toBe('generic/platform=tvOS');
  }

  it(
    'targets the given destination for the other Apple platforms',
    targetsTheGivenDestinationForTheOtherApplePlatforms,
  );

  function neverCarriesAGlobalProvisioningProfileSpecifierOrAnAutomaticProvisioningFlag() {
    const archiveArguments = assembleArchiveArguments({ ...BASE_ARCHIVE, shouldCleanBuild: true });

    function mentionsProfileSpecifier(argument: string) {
      return argument.includes('PROVISIONING_PROFILE_SPECIFIER');
    }

    const specifiers = archiveArguments.filter(mentionsProfileSpecifier);

    expect(specifiers).toEqual([]);
    expect(archiveArguments).not.toContain('-allowProvisioningUpdates');
  }

  it(
    'never carries a global provisioning-profile specifier or an automatic-provisioning flag',
    neverCarriesAGlobalProvisioningProfileSpecifierOrAnAutomaticProvisioningFlag,
  );
}

describe(
  'assembleArchiveArguments - the xcodebuild archive argv',
  describeAssembleArchiveArgumentsTheXcodebuildArchiveArgv,
);

function describeAssembleExportArgumentsTheXcodebuildExportArchiveArgv() {
  function exportsTheArchiveWithThePiecePlistIntoTheExportPath() {
    expect(
      assembleExportArguments({
        archivePath: '/out/MyApp.xcarchive',
        exportOptionsPath: '/out/ExportOptions.plist',
        exportPath: '/out',
      }),
    ).toEqual([
      '-exportArchive',
      '-archivePath',
      '/out/MyApp.xcarchive',
      '-exportOptionsPlist',
      '/out/ExportOptions.plist',
      '-exportPath',
      '/out',
    ]);
  }

  it(
    'exports the archive with the options plist into the export path',
    exportsTheArchiveWithThePiecePlistIntoTheExportPath,
  );
}

describe(
  'assembleExportArguments - the xcodebuild -exportArchive argv',
  describeAssembleExportArgumentsTheXcodebuildExportArchiveArgv,
);
