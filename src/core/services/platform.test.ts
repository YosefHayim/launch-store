import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  adHocProfileType,
  appleArtifactExtension,
  appStoreProfileType,
  APPLE_PLATFORMS,
  gymDestination,
  isApplePlatform,
  nativeProjectDirName,
  nativeTargetHint,
  parsePlatform,
  PLATFORMS,
  platformLabel,
  toAscPlatform,
  toBundleIdPlatform,
} from './platform.js';
import type { Platform } from '../types/app.js';
const APPLE: Platform[] = ['ios', 'tvos', 'macos', 'visionos'];
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
      expect(Effect.runSync(parsePlatform(platform))).toBe(platform);
    }
  });
  it('rejects junk with a message that lists the valid values', () => {
    const platformFailure = Effect.runSync(Effect.flip(parsePlatform('web')));
    expect(platformFailure.message).toMatch(/Unknown platform "web"/);
    expect(platformFailure.message).toMatch(/ios, android, tvos, macos, visionos/);
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
    expect(Effect.runSync(toAscPlatform('ios'))).toBe('IOS');
    expect(Effect.runSync(toAscPlatform('tvos'))).toBe('TV_OS');
    expect(Effect.runSync(toAscPlatform('macos'))).toBe('MAC_OS');
    expect(Effect.runSync(toAscPlatform('visionos'))).toBe('VISION_OS');
  });
  it('collapses the bundle-id platform - tvOS/visionOS register as iOS-family, only macOS is MAC_OS', () => {
    expect(Effect.runSync(toBundleIdPlatform('ios'))).toBe('IOS');
    expect(Effect.runSync(toBundleIdPlatform('tvos'))).toBe('IOS');
    expect(Effect.runSync(toBundleIdPlatform('visionos'))).toBe('IOS');
    expect(Effect.runSync(toBundleIdPlatform('macos'))).toBe('MAC_OS');
  });
  it('proves the split: visionOS is VISION_OS for a version filter but IOS for a bundle id', () => {
    expect(Effect.runSync(toAscPlatform('visionos'))).toBe('VISION_OS');
    expect(Effect.runSync(toBundleIdPlatform('visionos'))).toBe('IOS');
  });
  it('both throw for Android (no App Store Connect presence)', () => {
    const ascPlatformFailure = Effect.runSync(Effect.flip(toAscPlatform('android')));
    const bundleIdPlatformFailure = Effect.runSync(Effect.flip(toBundleIdPlatform('android')));
    expect(ascPlatformFailure.message).toMatch(/Android/);
    expect(bundleIdPlatformFailure.message).toMatch(/Android/);
  });
});
describe('provisioning profile types - visionOS reuses iOS, macOS has no ad-hoc', () => {
  it('appStoreProfileType maps each Apple platform (visionOS -> IOS_APP_STORE)', () => {
    expect(Effect.runSync(appStoreProfileType('ios'))).toBe('IOS_APP_STORE');
    expect(Effect.runSync(appStoreProfileType('visionos'))).toBe('IOS_APP_STORE');
    expect(Effect.runSync(appStoreProfileType('tvos'))).toBe('TVOS_APP_STORE');
    expect(Effect.runSync(appStoreProfileType('macos'))).toBe('MAC_APP_STORE');
  });
  it('adHocProfileType is defined for the device-installable platforms, undefined for macOS', () => {
    expect(Effect.runSync(adHocProfileType('ios'))).toBe('IOS_APP_ADHOC');
    expect(Effect.runSync(adHocProfileType('visionos'))).toBe('IOS_APP_ADHOC');
    expect(Effect.runSync(adHocProfileType('tvos'))).toBe('TVOS_APP_ADHOC');
    expect(Effect.runSync(adHocProfileType('macos'))).toBeUndefined();
  });
  it('both throw for Android', () => {
    const appStoreProfileFailure = Effect.runSync(Effect.flip(appStoreProfileType('android')));
    const adHocProfileFailure = Effect.runSync(Effect.flip(adHocProfileType('android')));
    expect(appStoreProfileFailure.message).toMatch(/Android/);
    expect(adHocProfileFailure.message).toMatch(/Android/);
  });
});
describe('gymDestination - iOS omits the flag (byte-identical), others pass generic/platform', () => {
  it('returns undefined for iOS so the build command is unchanged', () => {
    expect(Effect.runSync(gymDestination('ios'))).toBeUndefined();
  });
  it('returns the xcodebuild generic destination for each other Apple platform', () => {
    expect(Effect.runSync(gymDestination('tvos'))).toBe('generic/platform=tvOS');
    expect(Effect.runSync(gymDestination('macos'))).toBe('generic/platform=macOS');
    expect(Effect.runSync(gymDestination('visionos'))).toBe('generic/platform=visionOS');
  });
  it('throws for Android (not an Xcode build)', () => {
    const destinationFailure = Effect.runSync(Effect.flip(gymDestination('android')));
    expect(destinationFailure.message).toMatch(/Xcode/);
  });
});
describe('nativeProjectDirName / nativeTargetHint / appleArtifactExtension', () => {
  it('maps each Apple platform to its committed native directory (tvOS shares ios/)', () => {
    expect(Effect.runSync(nativeProjectDirName('ios'))).toBe('ios');
    expect(Effect.runSync(nativeProjectDirName('tvos'))).toBe('ios');
    expect(Effect.runSync(nativeProjectDirName('macos'))).toBe('macos');
    expect(Effect.runSync(nativeProjectDirName('visionos'))).toBe('visionos');
  });
  it('hints the right RN fork for the non-iOS platforms', () => {
    expect(Effect.runSync(nativeTargetHint('tvos'))).toMatch(/tvos/i);
    expect(Effect.runSync(nativeTargetHint('macos'))).toMatch(/macos/i);
    expect(Effect.runSync(nativeTargetHint('visionos'))).toMatch(/visionos/i);
  });
  it('exports .ipa for the iOS-family platforms and .pkg for macOS', () => {
    expect(Effect.runSync(appleArtifactExtension('ios'))).toBe('ipa');
    expect(Effect.runSync(appleArtifactExtension('tvos'))).toBe('ipa');
    expect(Effect.runSync(appleArtifactExtension('visionos'))).toBe('ipa');
    expect(Effect.runSync(appleArtifactExtension('macos'))).toBe('pkg');
  });
  it('all three throw for Android', () => {
    const directoryFailure = Effect.runSync(Effect.flip(nativeProjectDirName('android')));
    const targetFailure = Effect.runSync(Effect.flip(nativeTargetHint('android')));
    const artifactFailure = Effect.runSync(Effect.flip(appleArtifactExtension('android')));
    expect(directoryFailure.message).toMatch(/Android/);
    expect(targetFailure.message).toMatch(/Android/);
    expect(artifactFailure.message).toMatch(/Android/);
  });
});
