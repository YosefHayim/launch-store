/**
 * Platform vocabulary: the {@link Platform} family predicate and the mappings from a build platform to its
 * App Store Connect wire values and Xcode build destination. This is the single source of truth for
 * "given a build target, which toolchain (Apple vs Android), which ASC platform string, which signing
 * profile type, which gym destination" — so adding an Apple platform is a change here plus its build
 * plumbing, never a scatter of `=== "ios"` checks (which would silently route the newer Apple platforms
 * into an Android `else`). Pure and dependency-free — the imports are type-only, so leaf modules
 * (`screenshotSpecs`, CLI commands) can import it without pulling in the heavy ASC client.
 */
import type { components } from "./asc/schema.js";
import type { Platform } from "./types.js";

/** App Store Connect platform attribute on app-store versions, builds, and review submissions. */
type AscPlatform = components["schemas"]["Platform"];
/** App Store Connect bundle-id platform — narrower than {@link AscPlatform}: tvOS/visionOS register as iOS-family, so there is no `TV_OS`/`VISION_OS` here. */
type AscBundleIdPlatform = components["schemas"]["BundleIdPlatform"];
/** App Store Connect signing-profile type (e.g. `IOS_APP_STORE`, `TVOS_APP_STORE`, `MAC_APP_STORE`). */
type AscProfileType = NonNullable<NonNullable<components["schemas"]["Profile"]["attributes"]>["profileType"]>;

/** The four Apple build platforms — all built with Xcode on macOS, signed with one team, submitted to App Store Connect. */
export const APPLE_PLATFORMS: ReadonlySet<Platform> = new Set<Platform>(["ios", "tvos", "macos", "visionos"]);

/** Every build platform Launch accepts, in CLI-help order. The single source for the `<platform>` argument across commands. */
export const PLATFORMS: readonly Platform[] = ["ios", "android", "tvos", "macos", "visionos"];

/**
 * Whether `platform` is one of the Apple build platforms (vs Android). Use this — not `platform === "ios"`
 * — wherever a branch means "the Apple / Xcode / App Store Connect toolchain", so tvOS, macOS, and
 * visionOS take the Apple path instead of silently falling into an Android `else`.
 */
export function isApplePlatform(platform: Platform): boolean {
  return APPLE_PLATFORMS.has(platform);
}

/** Human-facing label for a build platform, for CLI prose and headers (e.g. `iOS`, `Android`, `tvOS`, `macOS`, `visionOS`). */
export function platformLabel(platform: Platform): string {
  switch (platform) {
    case "ios":
      return "iOS";
    case "android":
      return "Android";
    case "tvos":
      return "tvOS";
    case "macos":
      return "macOS";
    case "visionos":
      return "visionOS";
  }
}

/**
 * Parse a user-supplied `<platform>` argument into a {@link Platform}, throwing an actionable error on an
 * unknown value. Centralizes the validation every platform-taking command shares.
 */
export function parsePlatform(value: string): Platform {
  const match = PLATFORMS.find((platform) => platform === value);
  if (!match) throw new Error(`Unknown platform "${value}". Use one of: ${PLATFORMS.join(", ")}.`);
  return match;
}

/**
 * The App Store Connect platform attribute for a build platform — the value Apple expects in
 * `filter[platform]` and on `appStoreVersions` / `reviewSubmissions`. Throws for Android, which has no
 * App Store Connect platform, so callers must only reach this on the Apple path.
 */
export function toAscPlatform(platform: Platform): AscPlatform {
  switch (platform) {
    case "ios":
      return "IOS";
    case "tvos":
      return "TV_OS";
    case "macos":
      return "MAC_OS";
    case "visionos":
      return "VISION_OS";
    case "android":
      throw new Error("Android has no App Store Connect platform.");
  }
}

/**
 * The App Store Connect **bundle-id** platform for a build platform — a narrower mapping than
 * {@link toAscPlatform}: tvOS and visionOS bundle ids register as iOS-family (`IOS`); only macOS is
 * `MAC_OS`. Throws for Android.
 */
export function toBundleIdPlatform(platform: Platform): AscBundleIdPlatform {
  switch (platform) {
    case "ios":
    case "tvos":
    case "visionos":
      return "IOS";
    case "macos":
      return "MAC_OS";
    case "android":
      throw new Error("Android has no App Store Connect bundle-id platform.");
  }
}

/**
 * The App Store provisioning-profile type for an Apple platform. visionOS has no profile type of its own —
 * its bundle ids are iOS-family — so it signs with the iOS App Store profile. Throws for Android, which has
 * no Apple signing profile.
 */
export function appStoreProfileType(platform: Platform): AscProfileType {
  switch (platform) {
    case "ios":
    case "visionos":
      return "IOS_APP_STORE";
    case "tvos":
      return "TVOS_APP_STORE";
    case "macos":
      return "MAC_APP_STORE";
    case "android":
      throw new Error("Android has no App Store provisioning profile.");
  }
}

/**
 * The ad-hoc (install-link) provisioning-profile type for an Apple platform, or `undefined` for macOS,
 * which has no ad-hoc distribution (non-store macOS uses Developer ID — a different model). visionOS reuses
 * the iOS ad-hoc type. Throws for Android.
 */
export function adHocProfileType(platform: Platform): AscProfileType | undefined {
  switch (platform) {
    case "ios":
    case "visionos":
      return "IOS_APP_ADHOC";
    case "tvos":
      return "TVOS_APP_ADHOC";
    case "macos":
      return undefined;
    case "android":
      throw new Error("Android has no ad-hoc provisioning profile.");
  }
}

/**
 * The Xcode build destination for `gym` / `xcodebuild` for an Apple platform, or `undefined` for iOS —
 * whose destination is xcodebuild's default, so omitting the flag keeps the iOS build command
 * byte-identical to before this platform was generalized. Throws for Android, which does not use Xcode.
 */
export function gymDestination(platform: Platform): string | undefined {
  switch (platform) {
    case "ios":
      return undefined;
    case "tvos":
      return "generic/platform=tvOS";
    case "macos":
      return "generic/platform=macOS";
    case "visionos":
      return "generic/platform=visionOS";
    case "android":
      throw new Error("Android does not build with Xcode.");
  }
}

/**
 * The directory under the app root that holds an Apple platform's committed native Xcode project, by
 * React Native fork convention: `ios` for iOS and tvOS (react-native-tvos extends the iOS project, built
 * for tvOS via the destination), `macos` for react-native-macos, `visionos` for react-native-visionos.
 * Expo prebuild only generates `ios` — the other directories must be committed by the app, which the
 * `ensureNativeProject` gate enforces. Throws for Android (its native project is `android/`, built by Gradle).
 */
export function nativeProjectDirName(platform: Platform): string {
  switch (platform) {
    case "ios":
    case "tvos":
      return "ios";
    case "macos":
      return "macos";
    case "visionos":
      return "visionos";
    case "android":
      throw new Error("Android does not build with Xcode; its native project is android/.");
  }
}

/**
 * The React Native fork / template that supplies a non-iOS Apple platform's committed native project — the
 * actionable hint in the `ensureNativeProject` gate when that project is missing. iOS needs none (Expo
 * prebuild generates it). Throws for Android (built by Gradle, not this path).
 */
export function nativeTargetHint(platform: Platform): string {
  switch (platform) {
    case "ios":
      return "expo prebuild";
    case "tvos":
      return "react-native-tvos";
    case "macos":
      return "react-native-macos";
    case "visionos":
      return "@callstack/react-native-visionos";
    case "android":
      throw new Error("Android does not use an Xcode native target.");
  }
}

/**
 * The file extension (no dot) of the archive `gym` exports for an Apple platform: `ipa` for the iOS-family
 * platforms (iOS, tvOS, visionOS), `pkg` for a macOS App Store build (Apple wraps a Mac app in an installer
 * package). Drives both gym's `--output_name` and the post-build artifact discovery. Throws for Android.
 */
export function appleArtifactExtension(platform: Platform): "ipa" | "pkg" {
  switch (platform) {
    case "ios":
    case "tvos":
    case "visionos":
      return "ipa";
    case "macos":
      return "pkg";
    case "android":
      throw new Error("Android does not produce an Apple build artifact.");
  }
}
