import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SigningAssets } from '@/types/credentials.js';
import {
  assertDeviceArtifact,
  exportOptionsPlist,
  parseThinningReport,
} from '@/services/provider-support/apple-artifact.js';
import { xcodebuildEnv, resolveNativeDir } from './xcode.ts';

const MB = 1024 ** 2;

function describeResolveNativeDirAbsoluteNativeProjectPathSoGymCanTDoubleTheSubpathInAMonorepo() {
  function returnsAnAbsolutePathForARelativeAppDirTheMonorepoAppRootsCase() {
    const iosDirectory = resolveNativeDir('apps/sampleapp', 'ios');
    expect(isAbsolute(iosDirectory)).toBe(true);
    expect(iosDirectory.endsWith('/apps/sampleapp/ios')).toBe(true);
    expect(iosDirectory).not.toContain('apps/sampleapp/apps/sampleapp');
  }

  it(
    'returns an absolute path for a relative app dir (the monorepo `appRoots` case)',
    returnsAnAbsolutePathForARelativeAppDirTheMonorepoAppRootsCase,
  );

  function leavesAnAlreadyAbsoluteAppDirUntouched() {
    const nativeDir = resolveNativeDir('/Users/x/acme/apps/sampleapp', 'ios');
    expect(nativeDir).toBe('/Users/x/acme/apps/sampleapp/ios');
  }

  it('leaves an already-absolute app dir untouched', leavesAnAlreadyAbsoluteAppDirUntouched);

  function mapsEachApplePlatformToItsNativeProjectDirectoryTvOSSharesIos() {
    expect(resolveNativeDir('/a', 'tvos').endsWith('/a/ios')).toBe(true);
    expect(resolveNativeDir('/a', 'macos').endsWith('/a/macos')).toBe(true);
    expect(resolveNativeDir('/a', 'visionos').endsWith('/a/visionos')).toBe(true);
  }

  it(
    'maps each Apple platform to its native-project directory (tvOS shares ios/)',
    mapsEachApplePlatformToItsNativeProjectDirectoryTvOSSharesIos,
  );
}

describe(
  "resolveNativeDir - absolute native-project path so gym can't double the subpath in a monorepo",
  describeResolveNativeDirAbsoluteNativeProjectPathSoGymCanTDoubleTheSubpathInAMonorepo,
);

function describeParseThinningReportPerDeviceDownloadInstallBeforeAnyUpload() {
  function extractsOnePiecePerVariantWithCompressedUncompressedSizesInBytes() {
    const sizeEntries = parseThinningReport(`App Thinning Size Report for All Variants of MyApp.ipa

  Variant: MyApp-iPhone15,2.ipa
  Supported variant descriptors: iPhone15,2
  App + On Demand Resources size: 45.2 MB compressed, 90.5 MB uncompressed
  App size: 45.2 MB compressed, 90.5 MB uncompressed
  On Demand Resources size: Zero KB

  Variant: MyApp-Universal.ipa
  Supported variant descriptors: Universal
  App size: 50.0 MB compressed, 100.0 MB uncompressed
  `);

    expect(sizeEntries).toEqual([
      {
        device: 'iPhone15,2',
        downloadBytes: Math.round(45.2 * MB),
        installBytes: Math.round(90.5 * MB),
      },
      {
        device: 'Universal',
        downloadBytes: Math.round(50 * MB),
        installBytes: Math.round(100 * MB),
      },
    ]);
  }

  it(
    'extracts one entry per variant with compressed/uncompressed sizes in bytes',
    extractsOnePiecePerVariantWithCompressedUncompressedSizesInBytes,
  );

  function handlesKBUnitsAndIgnoresVariantsWithNoParseableSizeLine() {
    const reportText = `Variant: a.ipa
  iPhone14,5
  App size: 512 KB compressed, 1024 KB uncompressed

  Variant: b.ipa
  iPhone14,6
  (no size here)
  `;
    const sizeEntries = parseThinningReport(reportText);

    expect(sizeEntries).toEqual([
      { device: 'iPhone14,5', downloadBytes: 512 * 1024, installBytes: 1024 * 1024 },
    ]);
  }

  it(
    'handles KB units and ignores variants with no parseable size line',
    handlesKBUnitsAndIgnoresVariantsWithNoParseableSizeLine,
  );

  function degradesToAnEmptyArrayRatherThanThrowingOnUnrecognizedPiece() {
    const thinningReport = parseThinningReport('totally unrelated output');
    expect(thinningReport).toEqual([]);
  }

  it(
    'degrades to an empty array rather than throwing on unrecognized text',
    degradesToAnEmptyArrayRatherThanThrowingOnUnrecognizedPiece,
  );
}

describe(
  'parseThinningReport - per-device download/install before any upload',
  describeParseThinningReportPerDeviceDownloadInstallBeforeAnyUpload,
);

function describeExportPiecePlistManualAppStoreSigningInputs() {
  const signing: SigningAssets = {
    bundleId: 'com.example.hello',
    teamId: 'ABCDE12345',
    certName: 'Apple Distribution',
    certSerial: 'SERIAL123',
    profileName: 'Launch_com.example.hello_AppStore',
    profileUuid: 'uuid-1',
    profilePath: '/tmp/uuid-1.mobileprovision',
  };

  function emitsManualAppStoreSigningKeyedByTheBundleId() {
    const plist = exportOptionsPlist(signing);

    expect(plist).toContain('<key>method</key><string>app-store</string>');
    expect(plist).toContain('<key>signingStyle</key><string>manual</string>');
    expect(plist).toContain('<key>teamID</key><string>ABCDE12345</string>');
    expect(plist).toContain('<key>signingCertificate</key><string>Apple Distribution</string>');
    expect(plist).toContain(
      '<key>com.example.hello</key><string>Launch_com.example.hello_AppStore</string>',
    );
    expect(plist).toContain('thin-for-all-variants');
  }

  it(
    'emits manual app-store signing keyed by the bundle id',
    emitsManualAppStoreSigningKeyedByTheBundleId,
  );

  function addsOneProvisioningProfilesPiecePerEmbeddedExtensionSoEveryBundleInTheIpaSigns() {
    const plist = exportOptionsPlist({
      ...signing,
      extensionProfiles: {
        'com.example.hello.widget': 'Launch_com.example.hello.widget_AppStore',
        'com.example.hello.share': 'Launch_com.example.hello.share_AppStore',
      },
    });

    expect(plist).toContain(
      '<key>com.example.hello</key><string>Launch_com.example.hello_AppStore</string>',
    );
    expect(plist).toContain(
      '<key>com.example.hello.widget</key><string>Launch_com.example.hello.widget_AppStore</string>',
    );
    expect(plist).toContain(
      '<key>com.example.hello.share</key><string>Launch_com.example.hello.share_AppStore</string>',
    );
  }

  it(
    'adds one provisioningProfiles entry per embedded extension so every bundle in the .ipa signs',
    addsOneProvisioningProfilesPiecePerEmbeddedExtensionSoEveryBundleInTheIpaSigns,
  );
}

describe(
  'exportOptionsPlist - manual App Store signing inputs',
  describeExportPiecePlistManualAppStoreSigningInputs,
);

function describeAssertDeviceArtifactRejectANonSubmittableBuildBeforeUpload() {
  function acceptsARealDeviceIpaWithAPositiveSize() {
    function callAssertDeviceArtifact() {
      assertDeviceArtifact('/tmp/launch-build-x/SampleApp.ipa', 12 * MB, 'ios');
    }

    expect(callAssertDeviceArtifact).not.toThrow();
  }

  it('accepts a real device .ipa with a positive size', acceptsARealDeviceIpaWithAPositiveSize);

  function rejectsASimulatorArtifactTheReportedXcrunSimctlFailureMode() {
    const simulatorPath = '/path/ios/build/Build/Products/Release-iphonesimulator/SampleApp.app';

    function callAssertDeviceArtifact2() {
      assertDeviceArtifact(simulatorPath, 8 * MB, 'ios');
    }

    expect(callAssertDeviceArtifact2).toThrow(/simulator/i);
  }

  it(
    'rejects a simulator artifact (the reported xcrun simctl failure mode)',
    rejectsASimulatorArtifactTheReportedXcrunSimctlFailureMode,
  );

  function rejectsAAppBundleThatIsnTAPackagedIpa() {
    function callAssertDeviceArtifact3() {
      assertDeviceArtifact('/tmp/SampleApp.app', 8 * MB, 'ios');
    }

    expect(callAssertDeviceArtifact3).toThrow(/\.ipa/);
  }

  it("rejects a .app bundle that isn't a packaged .ipa", rejectsAAppBundleThatIsnTAPackagedIpa);

  function rejectsA0ByteArtifactFromASilentlyFailedExport() {
    function callAssertDeviceArtifact4() {
      assertDeviceArtifact('/tmp/SampleApp.ipa', 0, 'ios');
    }

    expect(callAssertDeviceArtifact4).toThrow(/empty/i);
  }

  it(
    'rejects a 0-byte artifact from a silently-failed export',
    rejectsA0ByteArtifactFromASilentlyFailedExport,
  );

  function catchesATvOSSimulatorArtifactBuiltForAppletvsimulator() {
    const simulatorPath = '/path/ios/build/Build/Products/Release-appletvsimulator/SampleApp.app';

    function callAssertDeviceArtifact5() {
      assertDeviceArtifact(simulatorPath, 8 * MB, 'tvos');
    }

    expect(callAssertDeviceArtifact5).toThrow(/simulator/i);
  }

  it(
    'catches a tvOS simulator artifact built for -appletvsimulator',
    catchesATvOSSimulatorArtifactBuiltForAppletvsimulator,
  );

  function acceptsAMacOSPkgNoSimulatorRuleButRejectsAMacOSIpa() {
    function callAssertDeviceArtifact6() {
      assertDeviceArtifact('/tmp/SampleApp.pkg', 20 * MB, 'macos');
    }

    expect(callAssertDeviceArtifact6).not.toThrow();

    function callAssertDeviceArtifact7() {
      assertDeviceArtifact('/tmp/SampleApp.ipa', 20 * MB, 'macos');
    }

    expect(callAssertDeviceArtifact7).toThrow(/\.pkg/);
  }

  it(
    'accepts a macOS .pkg (no simulator rule) but rejects a macOS .ipa',
    acceptsAMacOSPkgNoSimulatorRuleButRejectsAMacOSIpa,
  );
}

describe(
  'assertDeviceArtifact - reject a non-submittable build before upload',
  describeAssertDeviceArtifactRejectANonSubmittableBuildBeforeUpload,
);

function describeXcodebuildPieceForwardsLaunchSResolvedPieceToTheBundleStepCcacheVarsStillWin109() {
  function forwardsTheResolvedBuildPiece() {
    const buildEnvironment = xcodebuildEnv(
      { EXPO_PUBLIC_CDN_URL: 'https://real.cdn', EXPO_PUBLIC_FLAG: 'on' },
      {},
    );

    expect(buildEnvironment['EXPO_PUBLIC_CDN_URL']).toBe('https://real.cdn');
    expect(buildEnvironment['EXPO_PUBLIC_FLAG']).toBe('on');
  }

  it('forwards the resolved build env', forwardsTheResolvedBuildPiece);

  function letsCcacheOverrideACollidingUserVar() {
    const buildEnvironment = xcodebuildEnv({ CC: 'user-cc' }, { CC: 'ccache-cc' });
    expect(buildEnvironment['CC']).toBe('ccache-cc');
  }

  it('lets ccache override a colliding user var', letsCcacheOverrideACollidingUserVar);

  function addsNoAppStoreConnectKeyVariablesWhichOnlyFastlaneRead() {
    const buildEnvironment = xcodebuildEnv({ EXPO_PUBLIC_FLAG: 'on' }, {});
    const ownKeys = Object.keys(buildEnvironment);
    expect(ownKeys).toEqual(['EXPO_PUBLIC_FLAG']);
  }

  it(
    'adds no App Store Connect key variables, which only fastlane read',
    addsNoAppStoreConnectKeyVariablesWhichOnlyFastlaneRead,
  );
}

describe(
  "xcodebuildEnv - forwards Launch's resolved env to the bundle step; ccache vars still win (#109)",
  describeXcodebuildPieceForwardsLaunchSResolvedPieceToTheBundleStepCcacheVarsStillWin109,
);
