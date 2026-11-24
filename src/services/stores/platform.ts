// Maps each app target to its store name, signing profile, and native project folder.

import type { Platform } from '../../types/app.ts';

function unsupportedPlatform(message: string): never {
  throw new Error(message);
}

/** The four Apple build platforms - all built with Xcode on macOS, signed with one team, submitted to App Store Connect. */
export const APPLE_PLATFORMS: ReadonlySet<Platform> = new Set<Platform>([
  'ios',
  'tvos',
  'macos',
  'visionos',
]);
/** Every build platform Launch accepts, in CLI-help order. The single source for the `<platform>` argument across commands. */
export const PLATFORMS: readonly Platform[] = ['ios', 'android', 'tvos', 'macos', 'visionos'];

/** Whether `platform` is one of the Apple build platforms (vs Android). */
export function isApplePlatform(platform: Platform): boolean {
  return APPLE_PLATFORMS.has(platform);
}

/** Human-facing label for a build platform, for CLI prose and headers (e.g. `iOS`, `Android`, `tvOS`, `macOS`, `visionOS`). */
export function platformLabel(platform: Platform): string {
  switch (platform) {
    case 'ios':
      return 'iOS';
    case 'android':
      return 'Android';
    case 'tvos':
      return 'tvOS';
    case 'macos':
      return 'macOS';
    case 'visionos':
      return 'visionOS';
  }
}

/** Parse a user-supplied `<platform>` argument into a {@link Platform} */
export function parsePlatform(platformText: string) {
  function isRequestedPlatform(platform: 'ios' | 'android' | 'tvos' | 'macos' | 'visionos') {
    return platform == platformText;
  }

  const match = PLATFORMS.find(isRequestedPlatform);

  if (!match)
    return unsupportedPlatform(
      `Unknown platform "${platformText}". Use one of: ${PLATFORMS.join(', ')}.`,
    );

  return match;
}

/** The App Store Connect platform attribute for a build platform */
export function readConnectPlatform(platform: Platform) {
  switch (platform) {
    case 'ios':
      return 'IOS';
    case 'tvos':
      return 'TV_OS';
    case 'macos':
      return 'MAC_OS';
    case 'visionos':
      return 'VISION_OS';
    case 'android':
      return unsupportedPlatform('Android has no App Store Connect platform.');
  }
}

/** The App Store Connect **bundle-id** platform for a build platform */
export function readBundleIdPlatform(platform: Platform) {
  switch (platform) {
    case 'ios':
    case 'tvos':
    case 'visionos':
      return 'IOS';
    case 'macos':
      return 'MAC_OS';
    case 'android':
      return unsupportedPlatform('Android has no App Store Connect bundle-id platform.');
  }
}

/** The App Store provisioning-profile type for an Apple platform. */
export function appStoreProfileType(platform: Platform) {
  switch (platform) {
    case 'ios':
    case 'visionos':
      return 'IOS_APP_STORE';
    case 'tvos':
      return 'TVOS_APP_STORE';
    case 'macos':
      return 'MAC_APP_STORE';
    case 'android':
      return unsupportedPlatform('Android has no App Store provisioning profile.');
  }
}

/** The ad-hoc (install-link) provisioning-profile type for an Apple platform */
export function adHocProfileType(platform: Platform) {
  switch (platform) {
    case 'ios':
    case 'visionos':
      return 'IOS_APP_ADHOC';
    case 'tvos':
      return 'TVOS_APP_ADHOC';
    case 'macos':
      return undefined;
    case 'android':
      return unsupportedPlatform('Android has no ad-hoc provisioning profile.');
  }
}

/** The `xcodebuild archive` destination for an Apple platform. */
export function archiveDestination(platform: Platform) {
  switch (platform) {
    case 'ios':
      return 'generic/platform=iOS';
    case 'tvos':
      return 'generic/platform=tvOS';
    case 'macos':
      return 'generic/platform=macOS';
    case 'visionos':
      return 'generic/platform=visionOS';
    case 'android':
      return unsupportedPlatform('Android does not build with Xcode.');
  }
}

/** The directory under the app root that holds an Apple platform's committed native Xcode */
export function nativeProjectDirName(platform: Platform) {
  switch (platform) {
    case 'ios':
    case 'tvos':
      return 'ios';
    case 'macos':
      return 'macos';
    case 'visionos':
      return 'visionos';
    case 'android':
      return unsupportedPlatform(
        'Android does not build with Xcode; its native project is android/.',
      );
  }
}

/** The React Native fork / template that supplies a non-iOS Apple platform's committed native */
export function nativeTargetHint(platform: Platform) {
  switch (platform) {
    case 'ios':
      return 'expo prebuild';
    case 'tvos':
      return 'react-native-tvos';
    case 'macos':
      return 'react-native-macos';
    case 'visionos':
      return '@callstack/react-native-visionos';
    case 'android':
      return unsupportedPlatform('Android does not use an Xcode native target.');
  }
}

/** The file extension (no dot) of the archive `xcodebuild -exportArchive` exports for an Apple */
export function appleArtifactExtension(platform: Platform) {
  switch (platform) {
    case 'ios':
    case 'tvos':
    case 'visionos':
      return 'ipa';
    case 'macos':
      return 'pkg';
    case 'android':
      return unsupportedPlatform('Android does not produce an Apple build artifact.');
  }
}
