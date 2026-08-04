import { Data, Effect } from 'effect';
import type { Platform } from '../types/app.js';
/** App Store Connect platform attribute on app-store versions, builds, and review submissions. */
type AscPlatform = 'IOS' | 'TV_OS' | 'MAC_OS' | 'VISION_OS';
/** App Store Connect bundle-id platform - narrower than {@link AscPlatform}: tvOS/visionOS register as iOS-family, so there is no `TV_OS`/`VISION_OS` here. */
type AscBundleIdPlatform = 'IOS' | 'MAC_OS';
/** App Store Connect signing-profile type (e.g. `IOS_APP_STORE`, `TVOS_APP_STORE`, `MAC_APP_STORE`). */
type AscAppStoreProfileType = 'IOS_APP_STORE' | 'TVOS_APP_STORE' | 'MAC_APP_STORE';
type AscAdHocProfileType = 'IOS_APP_ADHOC' | 'TVOS_APP_ADHOC';
export type PlatformMappingFailure = Readonly<{
  readonly _tag: 'PlatformMappingFailure';
  readonly operation: string;
  readonly platform: string;
  readonly message: string;
}>;
export const makePlatformMappingFailure =
  Data.tagged<PlatformMappingFailure>('PlatformMappingFailure');
const unsupportedPlatform = (
  operation: string,
  platform: string,
  message: string,
): Effect.Effect<never, PlatformMappingFailure> =>
  Effect.fail(makePlatformMappingFailure({ operation, platform, message }));
/** The four Apple build platforms - all built with Xcode on macOS, signed with one team, submitted to App Store Connect. */
export const APPLE_PLATFORMS: ReadonlySet<Platform> = new Set<Platform>([
  'ios',
  'tvos',
  'macos',
  'visionos',
]);
/** Every build platform Launch accepts, in CLI-help order. The single source for the `<platform>` argument across commands. */
export const PLATFORMS: readonly Platform[] = ['ios', 'android', 'tvos', 'macos', 'visionos'];
/**
 * Whether `platform` is one of the Apple build platforms (vs Android). Use this - not `platform === "ios"`
 * - wherever a branch means "the Apple / Xcode / App Store Connect toolchain", so tvOS, macOS, and
 * visionOS take the Apple path instead of silently falling into an Android `else`.
 */
export const isApplePlatform = (platform: Platform): boolean => {
  return APPLE_PLATFORMS.has(platform);
};
/** Human-facing label for a build platform, for CLI prose and headers (e.g. `iOS`, `Android`, `tvOS`, `macOS`, `visionOS`). */
export const platformLabel = (platform: Platform): string => {
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
};
/**
 * Parse a user-supplied `<platform>` argument into a {@link Platform}, throwing an actionable error on an
 * unknown value. Centralizes the validation every platform-taking command shares.
 */
export const parsePlatform = (
  platformText: string,
): Effect.Effect<Platform, PlatformMappingFailure> => {
  const match = PLATFORMS.find((platform) => platform === platformText);
  if (!match)
    return unsupportedPlatform(
      'parse platform',
      platformText,
      `Unknown platform "${platformText}". Use one of: ${PLATFORMS.join(', ')}.`,
    );
  return Effect.succeed(match);
};
/**
 * The App Store Connect platform attribute for a build platform - the value Apple expects in
 * `filter[platform]` and on `appStoreVersions` / `reviewSubmissions`. Throws for Android, which has no
 * App Store Connect platform, so callers must only reach this on the Apple path.
 */
export const toAscPlatform = (
  platform: Platform,
): Effect.Effect<AscPlatform, PlatformMappingFailure> => {
  switch (platform) {
    case 'ios':
      return Effect.succeed('IOS');
    case 'tvos':
      return Effect.succeed('TV_OS');
    case 'macos':
      return Effect.succeed('MAC_OS');
    case 'visionos':
      return Effect.succeed('VISION_OS');
    case 'android':
      return unsupportedPlatform(
        'map App Store Connect platform',
        platform,
        'Android has no App Store Connect platform.',
      );
  }
};
/**
 * The App Store Connect **bundle-id** platform for a build platform - a narrower mapping than
 * {@link toAscPlatform}: tvOS and visionOS bundle ids register as iOS-family (`IOS`); only macOS is
 * `MAC_OS`. Throws for Android.
 */
export const toBundleIdPlatform = (
  platform: Platform,
): Effect.Effect<AscBundleIdPlatform, PlatformMappingFailure> => {
  switch (platform) {
    case 'ios':
    case 'tvos':
    case 'visionos':
      return Effect.succeed('IOS');
    case 'macos':
      return Effect.succeed('MAC_OS');
    case 'android':
      return unsupportedPlatform(
        'map bundle identifier platform',
        platform,
        'Android has no App Store Connect bundle-id platform.',
      );
  }
};
/**
 * The App Store provisioning-profile type for an Apple platform. visionOS has no profile type of its own -
 * its bundle ids are iOS-family - so it signs with the iOS App Store profile. Throws for Android, which has
 * no Apple signing profile.
 */
export const appStoreProfileType = (
  platform: Platform,
): Effect.Effect<AscAppStoreProfileType, PlatformMappingFailure> => {
  switch (platform) {
    case 'ios':
    case 'visionos':
      return Effect.succeed('IOS_APP_STORE');
    case 'tvos':
      return Effect.succeed('TVOS_APP_STORE');
    case 'macos':
      return Effect.succeed('MAC_APP_STORE');
    case 'android':
      return unsupportedPlatform(
        'map App Store profile type',
        platform,
        'Android has no App Store provisioning profile.',
      );
  }
};
/**
 * The ad-hoc (install-link) provisioning-profile type for an Apple platform, or `undefined` for macOS,
 * which has no ad-hoc distribution (non-store macOS uses Developer ID - a different model). visionOS reuses
 * the iOS ad-hoc type. Throws for Android.
 */
export const adHocProfileType = (
  platform: Platform,
): Effect.Effect<AscAdHocProfileType | undefined, PlatformMappingFailure> => {
  switch (platform) {
    case 'ios':
    case 'visionos':
      return Effect.succeed('IOS_APP_ADHOC');
    case 'tvos':
      return Effect.succeed('TVOS_APP_ADHOC');
    case 'macos':
      return Effect.succeed(undefined);
    case 'android':
      return unsupportedPlatform(
        'map ad hoc profile type',
        platform,
        'Android has no ad-hoc provisioning profile.',
      );
  }
};
/**
 * The Xcode build destination for `gym` / `xcodebuild` for an Apple platform, or `undefined` for iOS -
 * whose destination is xcodebuild's default, so omitting the flag keeps the iOS build command
 * byte-identical to before this platform was generalized. Throws for Android, which does not use Xcode.
 */
export const gymDestination = (
  platform: Platform,
): Effect.Effect<string | undefined, PlatformMappingFailure> => {
  switch (platform) {
    case 'ios':
      return Effect.succeed(undefined);
    case 'tvos':
      return Effect.succeed('generic/platform=tvOS');
    case 'macos':
      return Effect.succeed('generic/platform=macOS');
    case 'visionos':
      return Effect.succeed('generic/platform=visionOS');
    case 'android':
      return unsupportedPlatform(
        'map Xcode destination',
        platform,
        'Android does not build with Xcode.',
      );
  }
};
/**
 * The directory under the app root that holds an Apple platform's committed native Xcode project, by
 * React Native fork convention: `ios` for iOS and tvOS (react-native-tvos extends the iOS project, built
 * for tvOS via the destination), `macos` for react-native-macos, `visionos` for react-native-visionos.
 * Expo prebuild only generates `ios` - the other directories must be committed by the app, which the
 * `ensureNativeProject` gate enforces. Throws for Android (its native project is `android/`, built by Gradle).
 */
export const nativeProjectDirName = (
  platform: Platform,
): Effect.Effect<string, PlatformMappingFailure> => {
  switch (platform) {
    case 'ios':
    case 'tvos':
      return Effect.succeed('ios');
    case 'macos':
      return Effect.succeed('macos');
    case 'visionos':
      return Effect.succeed('visionos');
    case 'android':
      return unsupportedPlatform(
        'map native project directory',
        platform,
        'Android does not build with Xcode; its native project is android/.',
      );
  }
};
/**
 * The React Native fork / template that supplies a non-iOS Apple platform's committed native project - the
 * actionable hint in the `ensureNativeProject` gate when that project is missing. iOS needs none (Expo
 * prebuild generates it). Throws for Android (built by Gradle, not this path).
 */
export const nativeTargetHint = (
  platform: Platform,
): Effect.Effect<string, PlatformMappingFailure> => {
  switch (platform) {
    case 'ios':
      return Effect.succeed('expo prebuild');
    case 'tvos':
      return Effect.succeed('react-native-tvos');
    case 'macos':
      return Effect.succeed('react-native-macos');
    case 'visionos':
      return Effect.succeed('@callstack/react-native-visionos');
    case 'android':
      return unsupportedPlatform(
        'map native target hint',
        platform,
        'Android does not use an Xcode native target.',
      );
  }
};
/**
 * The file extension (no dot) of the archive `gym` exports for an Apple platform: `ipa` for the iOS-family
 * platforms (iOS, tvOS, visionOS), `pkg` for a macOS App Store build (Apple wraps a Mac app in an installer
 * package). Drives both gym's `--output_name` and the post-build artifact discovery. Throws for Android.
 */
export const appleArtifactExtension = (
  platform: Platform,
): Effect.Effect<'ipa' | 'pkg', PlatformMappingFailure> => {
  switch (platform) {
    case 'ios':
    case 'tvos':
    case 'visionos':
      return Effect.succeed('ipa');
    case 'macos':
      return Effect.succeed('pkg');
    case 'android':
      return unsupportedPlatform(
        'map Apple artifact extension',
        platform,
        'Android does not produce an Apple build artifact.',
      );
  }
};
