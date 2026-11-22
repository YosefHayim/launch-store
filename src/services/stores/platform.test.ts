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
  toAscPlatform,
  toBundleIdPlatform,
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

describe('isApplePlatform - Apple vs Android toolchain split', () => {
  it('is true for every Apple platform and false for Android', () => {
    for (const platform of APPLE) expect(isApplePlatform(platform)).toBe(true);
    expect(isApplePlatform('android')).toBe(false);
  });
  it('APPLE_PLATFORMS and PLATFORMS agree on membership', () => {
    expect([...APPLE_PLATFORMS].sort()).toEqual([...APPLE].sort());
    expect(PLATFORMS.filter(isApplePlatform).sort()).toEqual([...APPLE].sort());
    expect(PLATFORMS).toContain('android');
  });
});
describe('parsePlatform - the single CLI `<platform>` guard', () => {
  it('accepts all five platforms verbatim', () => {
    for (const platform of PLATFORMS) {
      expect(parsePlatform(platform)).toBe(platform);
    }
  });
  it('rejects junk with a message that lists the valid values', () => {
    const platformFailure = thrownMessage(function readPlatform() {
      parsePlatform('web');
    });
    expect(platformFailure).toMatch(/Unknown platform "web"/);
    expect(platformFailure).toMatch(/ios, android, tvos, macos, visionos/);
  });
});
describe('platformLabel - human-facing names', () => {
  it('maps each platform to its canonical casing', () => {
    expect(platformLabel('ios')).toBe('iOS');
    expect(platformLabel('android')).toBe('Android');
    expect(platformLabel('tvos')).toBe('tvOS');
    expect(platformLabel('macos')).toBe('macOS');
    expect(platformLabel('visionos')).toBe('visionOS');
  });
});
describe('toAscPlatform vs toBundleIdPlatform - the two ASC enums are NOT the same mapping', () => {
  it('maps the version/filter platform to the four distinct ASC values', () => {
    expect(toAscPlatform('ios')).toBe('IOS');
    expect(toAscPlatform('tvos')).toBe('TV_OS');
    expect(toAscPlatform('macos')).toBe('MAC_OS');
    expect(toAscPlatform('visionos')).toBe('VISION_OS');
  });
  it('collapses the bundle-id platform - tvOS/visionOS register as iOS-family, only macOS is MAC_OS', () => {
    expect(toBundleIdPlatform('ios')).toBe('IOS');
    expect(toBundleIdPlatform('tvos')).toBe('IOS');
    expect(toBundleIdPlatform('visionos')).toBe('IOS');
    expect(toBundleIdPlatform('macos')).toBe('MAC_OS');
  });
  it('proves the split: visionOS is VISION_OS for a version filter but IOS for a bundle id', () => {
    expect(toAscPlatform('visionos')).toBe('VISION_OS');
    expect(toBundleIdPlatform('visionos')).toBe('IOS');
  });
  it('both throw for Android (no App Store Connect presence)', () => {
    const ascPlatformFailure = thrownMessage(function readAscPlatform() {
      toAscPlatform('android');
    });
    const bundleIdPlatformFailure = thrownMessage(function readBundlePlatform() {
      toBundleIdPlatform('android');
    });
    expect(ascPlatformFailure).toMatch(/Android/);
    expect(bundleIdPlatformFailure).toMatch(/Android/);
  });
});
describe('provisioning profile types - visionOS reuses iOS, macOS has no ad-hoc', () => {
  it('appStoreProfileType maps each Apple platform (visionOS -> IOS_APP_STORE)', () => {
    expect(appStoreProfileType('ios')).toBe('IOS_APP_STORE');
    expect(appStoreProfileType('visionos')).toBe('IOS_APP_STORE');
    expect(appStoreProfileType('tvos')).toBe('TVOS_APP_STORE');
    expect(appStoreProfileType('macos')).toBe('MAC_APP_STORE');
  });
  it('adHocProfileType is defined for the device-installable platforms, undefined for macOS', () => {
    expect(adHocProfileType('ios')).toBe('IOS_APP_ADHOC');
    expect(adHocProfileType('visionos')).toBe('IOS_APP_ADHOC');
    expect(adHocProfileType('tvos')).toBe('TVOS_APP_ADHOC');
    expect(adHocProfileType('macos')).toBeUndefined();
  });
  it('both throw for Android', () => {
    const appStoreProfileFailure = thrownMessage(function readAppStoreProfile() {
      appStoreProfileType('android');
    });
    const adHocProfileFailure = thrownMessage(function readAdHocProfile() {
      adHocProfileType('android');
    });
    expect(appStoreProfileFailure).toMatch(/Android/);
    expect(adHocProfileFailure).toMatch(/Android/);
  });
});
describe('archiveDestination - every Apple platform targets generic/platform', () => {
  it('targets a generic device for iOS so an archive never builds for a simulator', () => {
    expect(archiveDestination('ios')).toBe('generic/platform=iOS');
  });
  it('returns the xcodebuild generic destination for each other Apple platform', () => {
    expect(archiveDestination('tvos')).toBe('generic/platform=tvOS');
    expect(archiveDestination('macos')).toBe('generic/platform=macOS');
    expect(archiveDestination('visionos')).toBe('generic/platform=visionOS');
  });
  it('throws for Android (not an Xcode build)', () => {
    const destinationFailure = thrownMessage(function readDestination() {
      archiveDestination('android');
    });
    expect(destinationFailure).toMatch(/Xcode/);
  });
});
describe('nativeProjectDirName / nativeTargetHint / appleArtifactExtension', () => {
  it('maps each Apple platform to its committed native directory (tvOS shares ios/)', () => {
    expect(nativeProjectDirName('ios')).toBe('ios');
    expect(nativeProjectDirName('tvos')).toBe('ios');
    expect(nativeProjectDirName('macos')).toBe('macos');
    expect(nativeProjectDirName('visionos')).toBe('visionos');
  });
  it('hints the right RN fork for the non-iOS platforms', () => {
    expect(nativeTargetHint('tvos')).toMatch(/tvos/i);
    expect(nativeTargetHint('macos')).toMatch(/macos/i);
    expect(nativeTargetHint('visionos')).toMatch(/visionos/i);
  });
  it('exports .ipa for the iOS-family platforms and .pkg for macOS', () => {
    expect(appleArtifactExtension('ios')).toBe('ipa');
    expect(appleArtifactExtension('tvos')).toBe('ipa');
    expect(appleArtifactExtension('visionos')).toBe('ipa');
    expect(appleArtifactExtension('macos')).toBe('pkg');
  });
  it('all three throw for Android', () => {
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
  });
});
