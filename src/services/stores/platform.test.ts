import { describe, expect, it } from 'vitest';
import type { Platform } from '../../types/app.ts';
import {
  adHocProfileType,
  appleArtifactExtension,
  appStoreProfileType,
  APPLE_PLATFORMS,
  archiveDestination,
  isApplePlatform,
  nativeProjectDirName,
  nativeTargetHint,
  parsePlatform,
  PLATFORMS,
  platformLabel,
  readConnectPlatform,
  readBundleIdPlatform,
} from './platform.ts';

const APPLE: Platform[] = ['ios', 'tvos', 'macos', 'visionos'];

function thrownMessage(read: () => unknown): string {
  try {
    read();
  } catch (failure) {
    if (typeof failure != 'object') {
      throw new Error('expected a tagged failure');
    }

    if (failure == null) {
      throw new Error('expected a tagged failure');
    }

    if ('message' in failure == false) {
      throw new Error('expected a tagged failure');
    }

    if (typeof failure.message != 'string') {
      throw new Error('expected a tagged failure');
    }

    return failure.message;
  }

  throw new Error('expected a throw');
}
function describeIsApplePlatformAppleVsAndroidToolchainSplit() {
  function isTrueForEveryApplePlatformAndFalseForAndroid() {
    for (const platform of APPLE) expect(isApplePlatform(platform)).toBe(true);
    expect(isApplePlatform('android')).toBe(false);
  }

  it(
    'is true for every Apple platform and false for Android',
    isTrueForEveryApplePlatformAndFalseForAndroid,
  );

  function aPPLEPLATFORMSAndPLATFORMSAgreeOnMembership() {
    expect([...APPLE_PLATFORMS].sort()).toEqual([...APPLE].sort());
    expect(PLATFORMS.filter(isApplePlatform).sort()).toEqual([...APPLE].sort());
    expect(PLATFORMS).toContain('android');
  }

  it(
    'APPLE_PLATFORMS and PLATFORMS agree on membership',
    aPPLEPLATFORMSAndPLATFORMSAgreeOnMembership,
  );
}

describe(
  'isApplePlatform - Apple vs Android toolchain split',
  describeIsApplePlatformAppleVsAndroidToolchainSplit,
);
function describeParsePlatformTheSingleCLIPlatformGuard() {
  function acceptsAllFivePlatformsVerbatim() {
    for (const platform of PLATFORMS) {
      expect(parsePlatform(platform)).toBe(platform);
    }
  }

  it('accepts all five platforms verbatim', acceptsAllFivePlatformsVerbatim);

  function rejectsJunkWithAMessageThatListsTheValidValues() {
    const platformFailure = thrownMessage(function readPlatform() {
      parsePlatform('web');
    });

    expect(platformFailure).toMatch(/Unknown platform "web"/);
    expect(platformFailure).toMatch(/ios, android, tvos, macos, visionos/);
  }

  it(
    'rejects junk with a message that lists the valid values',
    rejectsJunkWithAMessageThatListsTheValidValues,
  );
}

describe(
  'parsePlatform - the single CLI `<platform>` guard',
  describeParsePlatformTheSingleCLIPlatformGuard,
);
function describePlatformLabelHumanFacingNames() {
  function mapsEachPlatformToItsCanonicalCasing() {
    expect(platformLabel('ios')).toBe('iOS');
    expect(platformLabel('android')).toBe('Android');
    expect(platformLabel('tvos')).toBe('tvOS');
    expect(platformLabel('macos')).toBe('macOS');
    expect(platformLabel('visionos')).toBe('visionOS');
  }

  it('maps each platform to its canonical casing', mapsEachPlatformToItsCanonicalCasing);
}

describe('platformLabel - human-facing names', describePlatformLabelHumanFacingNames);
function describeToAscPlatformVsToBundleIdPlatformTheTwoASCEnumsAreNOTTheSameMapping() {
  function mapsTheVersionFilterPlatformToTheFourDistinctASCValues() {
    expect(readConnectPlatform('ios')).toBe('IOS');
    expect(readConnectPlatform('tvos')).toBe('TV_OS');
    expect(readConnectPlatform('macos')).toBe('MAC_OS');
    expect(readConnectPlatform('visionos')).toBe('VISION_OS');
  }

  it(
    'maps the version/filter platform to the four distinct ASC values',
    mapsTheVersionFilterPlatformToTheFourDistinctASCValues,
  );

  function collapsesTheBundleIdPlatformTvOSVisionOSRegisterAsIOSFamilyOnlyMacOSIsMACOS() {
    expect(readBundleIdPlatform('ios')).toBe('IOS');
    expect(readBundleIdPlatform('tvos')).toBe('IOS');
    expect(readBundleIdPlatform('visionos')).toBe('IOS');
    expect(readBundleIdPlatform('macos')).toBe('MAC_OS');
  }

  it(
    'collapses the bundle-id platform - tvOS/visionOS register as iOS-family, only macOS is MAC_OS',
    collapsesTheBundleIdPlatformTvOSVisionOSRegisterAsIOSFamilyOnlyMacOSIsMACOS,
  );

  function provesTheSplitVisionOSIsVISIONOSForAVersionFilterButIOSForABundleId() {
    expect(readConnectPlatform('visionos')).toBe('VISION_OS');
    expect(readBundleIdPlatform('visionos')).toBe('IOS');
  }

  it(
    'proves the split: visionOS is VISION_OS for a version filter but IOS for a bundle id',
    provesTheSplitVisionOSIsVISIONOSForAVersionFilterButIOSForABundleId,
  );

  function bothThrowForAndroidNoAppStoreConnectPresence() {
    const ascPlatformFailure = thrownMessage(function readAscPlatform() {
      readConnectPlatform('android');
    });
    const bundleIdPlatformFailure = thrownMessage(function readBundlePlatform() {
      readBundleIdPlatform('android');
    });

    expect(ascPlatformFailure).toMatch(/Android/);
    expect(bundleIdPlatformFailure).toMatch(/Android/);
  }

  it(
    'both throw for Android (no App Store Connect presence)',
    bothThrowForAndroidNoAppStoreConnectPresence,
  );
}

describe(
  'readConnectPlatform vs readBundleIdPlatform - the two ASC enums are NOT the same mapping',
  describeToAscPlatformVsToBundleIdPlatformTheTwoASCEnumsAreNOTTheSameMapping,
);
function describeProvisioningProfileTypesVisionOSReusesIOSMacOSHasNoAdHoc() {
  function appStoreProfileTypeMapsEachApplePlatformVisionOSIOSAPPSTORE() {
    expect(appStoreProfileType('ios')).toBe('IOS_APP_STORE');
    expect(appStoreProfileType('visionos')).toBe('IOS_APP_STORE');
    expect(appStoreProfileType('tvos')).toBe('TVOS_APP_STORE');
    expect(appStoreProfileType('macos')).toBe('MAC_APP_STORE');
  }

  it(
    'appStoreProfileType maps each Apple platform (visionOS -> IOS_APP_STORE)',
    appStoreProfileTypeMapsEachApplePlatformVisionOSIOSAPPSTORE,
  );

  function adHocProfileTypeIsDefinedForTheDeviceInstallablePlatformsUndefinedForMacOS() {
    expect(adHocProfileType('ios')).toBe('IOS_APP_ADHOC');
    expect(adHocProfileType('visionos')).toBe('IOS_APP_ADHOC');
    expect(adHocProfileType('tvos')).toBe('TVOS_APP_ADHOC');
    expect(adHocProfileType('macos')).toBeUndefined();
  }

  it(
    'adHocProfileType is defined for the device-installable platforms, undefined for macOS',
    adHocProfileTypeIsDefinedForTheDeviceInstallablePlatformsUndefinedForMacOS,
  );

  function bothThrowForAndroid() {
    const appStoreProfileFailure = thrownMessage(function readAppStoreProfile() {
      appStoreProfileType('android');
    });
    const adHocProfileFailure = thrownMessage(function readAdHocProfile() {
      adHocProfileType('android');
    });

    expect(appStoreProfileFailure).toMatch(/Android/);
    expect(adHocProfileFailure).toMatch(/Android/);
  }

  it('both throw for Android', bothThrowForAndroid);
}

describe(
  'provisioning profile types - visionOS reuses iOS, macOS has no ad-hoc',
  describeProvisioningProfileTypesVisionOSReusesIOSMacOSHasNoAdHoc,
);
function describeArchiveDestinationEveryApplePlatformTargetsGenericPlatform() {
  function targetsAGenericDeviceForIOSSoAnArchiveNeverBuildsForASimulator() {
    expect(archiveDestination('ios')).toBe('generic/platform=iOS');
  }

  it(
    'targets a generic device for iOS so an archive never builds for a simulator',
    targetsAGenericDeviceForIOSSoAnArchiveNeverBuildsForASimulator,
  );

  function returnsTheXcodebuildGenericDestinationForEachOtherApplePlatform() {
    expect(archiveDestination('tvos')).toBe('generic/platform=tvOS');
    expect(archiveDestination('macos')).toBe('generic/platform=macOS');
    expect(archiveDestination('visionos')).toBe('generic/platform=visionOS');
  }

  it(
    'returns the xcodebuild generic destination for each other Apple platform',
    returnsTheXcodebuildGenericDestinationForEachOtherApplePlatform,
  );

  function throwsForAndroidNotAnXcodeBuild() {
    const destinationFailure = thrownMessage(function readDestination() {
      archiveDestination('android');
    });
    expect(destinationFailure).toMatch(/Xcode/);
  }

  it('throws for Android (not an Xcode build)', throwsForAndroidNotAnXcodeBuild);
}

describe(
  'archiveDestination - every Apple platform targets generic/platform',
  describeArchiveDestinationEveryApplePlatformTargetsGenericPlatform,
);
function describeNativeProjectDirNameNativeTargetHintAppleArtifactExtension() {
  function mapsEachApplePlatformToItsCommittedNativeDirectoryTvOSSharesIos() {
    expect(nativeProjectDirName('ios')).toBe('ios');
    expect(nativeProjectDirName('tvos')).toBe('ios');
    expect(nativeProjectDirName('macos')).toBe('macos');
    expect(nativeProjectDirName('visionos')).toBe('visionos');
  }

  it(
    'maps each Apple platform to its committed native directory (tvOS shares ios/)',
    mapsEachApplePlatformToItsCommittedNativeDirectoryTvOSSharesIos,
  );

  function hintsTheRightRNForkForTheNonIOSPlatforms() {
    expect(nativeTargetHint('tvos')).toMatch(/tvos/i);
    expect(nativeTargetHint('macos')).toMatch(/macos/i);
    expect(nativeTargetHint('visionos')).toMatch(/visionos/i);
  }

  it('hints the right RN fork for the non-iOS platforms', hintsTheRightRNForkForTheNonIOSPlatforms);

  function exportsIpaForTheIOSFamilyPlatformsAndPkgForMacOS() {
    expect(appleArtifactExtension('ios')).toBe('ipa');
    expect(appleArtifactExtension('tvos')).toBe('ipa');
    expect(appleArtifactExtension('visionos')).toBe('ipa');
    expect(appleArtifactExtension('macos')).toBe('pkg');
  }

  it(
    'exports .ipa for the iOS-family platforms and .pkg for macOS',
    exportsIpaForTheIOSFamilyPlatformsAndPkgForMacOS,
  );

  function allThreeThrowForAndroid() {
    const directoryFailure = thrownMessage(function readDirectory() {
      nativeProjectDirName('android');
    });
    const targetFailure = thrownMessage(function readTarget() {
      nativeTargetHint('android');
    });
    const artifactFailure = thrownMessage(function readArtifact() {
      appleArtifactExtension('android');
    });

    expect(directoryFailure).toMatch(/Android/);
    expect(targetFailure).toMatch(/Android/);
    expect(artifactFailure).toMatch(/Android/);
  }

  it('all three throw for Android', allThreeThrowForAndroid);
}

describe(
  'nativeProjectDirName / nativeTargetHint / appleArtifactExtension',
  describeNativeProjectDirNameNativeTargetHintAppleArtifactExtension,
);
