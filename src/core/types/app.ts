export const PLATFORMS = ['ios', 'android', 'tvos', 'macos', 'visionos'] as const;
/** Target build platform - one of {@link PLATFORMS}. */
export type Platform = (typeof PLATFORMS)[number];
/**
 * Where an iOS build runs, as picked in the `launch` wizard. `local` is the host Mac's own Xcode;
 * `aws` and `ssh` are remote Macs; `eas` hands the build off to Expo's cloud. Android always builds
 * locally (gradle on the host), so this only varies for iOS. Persisted in a remembered wizard flow
 * (see {@link import("../distribution/lastRun.js").LastFlow}) so the next run can replay it.
 */
export type BuildLocation = 'local' | 'aws' | 'ssh' | 'eas';
/**
 * How a build is distributed.
 * - `store`: the normal path - App Store/TestFlight (iOS) or a Play track (Android). The default.
 * - `internal`: an install link for registered testers - an ad-hoc-signed `.ipa` (iOS, valid only for
 *   the devices on the ad-hoc profile) or a directly-installable `.apk` (Android), hosted on the
 *   user's own bucket with an `itms-services` manifest + landing page. The EAS "internal distribution"
 *   equivalent, with no shared cloud queue.
 */
export type Distribution = 'store' | 'internal';
/**
 * Where a submission lands, neutrally named and mapped to each store by the platform's submitter.
 * - `testing`: a testing track (iOS -> TestFlight; Android -> the chosen {@link PlayTrack}, default
 *   `internal`). The default, safe path.
 * - `production`: the store's public release queue (iOS App Store review / Android production track).
 *   Reached only by the deliberate `launch release` command.
 */
export type SubmitTarget = 'testing' | 'production';
/**
 * A Google Play release track. `internal` is the safe default: a new personal Play account must run
 * ~20 testers for 14 days on a testing track before production is unlocked, so defaulting anywhere
 * else would fail for fresh accounts. Has no iOS equivalent. Array-first (SSOT) so config schemas reuse
 * it for {@link BuildProfile}'s `track`.
 */
export const PLAY_TRACKS = ['internal', 'closed', 'open', 'production'] as const;
/** A Google Play release track - one of {@link PLAY_TRACKS}. */
export type PlayTrack = (typeof PLAY_TRACKS)[number];
/**
 * Which web console page `launch open` deep-links to. Each value maps to a per-platform URL in
 * `core/consoleLinks.ts` - the connective tissue between a read-only finding ("agreement unsigned")
 * and the irreducible UI step that fixes it. `asc` / `play` are the platform consoles' home for the
 * app; the rest target a specific section:
 * - `asc`: the app's App Store Connect overview (Apple) - the default target.
 * - `play`: the Google Play Console (Android's equivalent of `asc`).
 * - `testflight`: the app's TestFlight tab (iOS only - Android testing lives on Play tracks).
 * - `listing`: the App Store / Play store-listing page where copy and screenshots are edited.
 * - `reviews`: the app's ratings-and-reviews page.
 * - `agreements`: the account's agreements, tax, and banking page (no per-app id).
 * - `app-record`: the app's record page - the one step the API can't create (see the `app-record` glossary topic).
 */
export type OpenTarget =
  | 'asc'
  | 'play'
  | 'testflight'
  | 'listing'
  | 'reviews'
  | 'agreements'
  | 'app-record';
/**
 * Resolved Android release settings for one invocation, carried on {@link ResolvedBuildContext} so the
 * Google Play submitter reads a single source of truth. Resolved from `--track`/`--rollout`, then the
 * profile's defaults, then the safe fallback. Present only for Android builds; absent on iOS.
 */
export type AndroidReleaseOptions = {
  track: PlayTrack;
  rollout: number;
};
/**
 * Which kind of TestFlight beta feedback a {@link BetaFeedback} carries - Apple keeps the two on
 * separate resources (`betaFeedbackCrashSubmissions` / `betaFeedbackScreenshotSubmissions`), which is
 * also the discriminant `launch testflight feedback --type` filters on.
 */
export type BetaFeedbackKind = 'crash' | 'screenshot';
/**
 * One TestFlight screenshot attachment on a {@link BetaFeedback} - a presigned image URL plus its
 * pixel dimensions. The URL expires (Apple signs it for a short window), so it's for immediate viewing
 * or download, not long-term storage; `launch testflight feedback --out` fetches it before it lapses.
 */
export type BetaFeedbackScreenshot = {
  url: string;
  width?: number;
  height?: number;
};
/**
 * One piece of TestFlight beta feedback, normalized across Apple's two submission resources into the
 * single shape `launch testflight feedback` renders. `kind` discriminates the two: a `crash` carries no
 * `screenshots`; a `screenshot` carries one or more. The `*Resource`/wire types stay in `ascClient.ts`;
 * this is the product-facing read model the CLI and `--json` output share, so it omits Apple ids beyond
 * the feedback's own and keeps only the fields a developer triages from.
 */
export type BetaFeedback = {
  id: string;
  kind: BetaFeedbackKind;
  createdDate?: string;
  comment?: string;
  email?: string;
  deviceModel?: string;
  osVersion?: string;
  buildVersion?: string;
  screenshots?: BetaFeedbackScreenshot[];
};
/**
 * One app discovered in the surrounding monorepo.
 *
 * Launch auto-discovers these by scanning for `app.json`/`app.config` files, so the
 * facts here (bundle id, version) come straight from Expo's config and are never
 * duplicated in Launch's own config - `app.json` stays the single source of truth.
 */
export type AppDescriptor = {
  name: string;
  dir: string;
  configPath: string;
  bundleId?: string;
  packageName?: string;
  version?: string;
  iosEntitlements?: Record<string, unknown>;
  iosExtensions?: string[];
  androidVersionCode?: number;
  usesNonExemptEncryption?: boolean;
};
/**
 * A named build profile from `launch.config.ts` (e.g. `production`, `preview`).
 * Holds only Launch-specific settings; app facts stay in `app.json`.
 */
export type BuildProfile = {
  name: string;
  envFile?: string;
  env?: Record<string, string>;
  ssl?: boolean;
  sizeBudgetMB?: number;
  track?: PlayTrack;
  rollout?: number;
};
