export const PLATFORMS = ['ios', 'android', 'tvos', 'macos', 'visionos'] as const;
/** Target build platform - one of {@link PLATFORMS}. */
export type Platform = (typeof PLATFORMS)[number];
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
 * A Google Play release track. `internal` is the safe default: a new personal Play account must run
 * ~20 testers for 14 days on a testing track before production is unlocked, so defaulting anywhere
 * else would fail for fresh accounts. Has no iOS equivalent. Array-first (SSOT) so config schemas reuse
 * it for {@link BuildProfile}'s `track`.
 */
export const playTracks = ['internal', 'closed', 'open', 'production'] as const;
/** A Google Play release track - one of {@link playTracks}. */
export type PlayTrack = (typeof playTracks)[number];
/**
 * Which web console page `launch-store open` deep-links to. Each value maps to a per-platform URL in
 * `core/console-links.ts` - the connective tissue between a read-only finding ("agreement unsigned")
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
 * One localized Play "What's new" line carried on {@link AndroidReleaseOptions} so the Google Play
 * submitter can attach changelogs during AAB upload without re-reading config.
 */
export type AndroidReleaseNote = {
  language: string;
  text: string;
};
/**
 * Resolved Android release settings for one invocation, carried on {@link ResolvedBuildContext} so the
 * Google Play submitter reads a single source of truth. Resolved from `--track`/`--rollout`, then the
 * profile's defaults, then the safe fallback. Present only for Android builds; absent on iOS.
 * `releaseNotes` is optional: when set, `google-play` sends them as the release notes of the uploaded AAB.
 */
export type AndroidReleaseOptions = {
  track: PlayTrack;
  rollout: number;
  releaseNotes?: readonly AndroidReleaseNote[];
};
/**
 * Which kind of TestFlight beta feedback a {@link BetaFeedback} carries - Apple keeps the two on
 * separate resources (`betaFeedbackCrashSubmissions` / `betaFeedbackScreenshotSubmissions`), which is
 * also the discriminant `launch-store testflight feedback --type` filters on.
 */
export type BetaFeedbackKind = 'crash' | 'screenshot';
/**
 * One TestFlight screenshot attachment on a {@link BetaFeedback} - a presigned image URL plus its
 * pixel dimensions. The URL expires (Apple signs it for a short window), so it's for immediate viewing
 * or download, not long-term storage; `launch-store testflight feedback --out` fetches it before it lapses.
 */
type BetaFeedbackScreenshot = {
  url: string;
  width?: number;
  height?: number;
};
/**
 * One piece of TestFlight beta feedback, normalized across Apple's two submission resources into the
 * single shape `launch-store testflight feedback` renders. `kind` discriminates the two: a `crash` carries no
 * `screenshots`; a `screenshot` carries one or more. The `*Resource`/wire types stay in `asc-client.ts`;
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
 * One named set of build settings in `profiles`, such as `production` or `preview`.
 * The bundle id, version, and entitlements stay in the app's app.json.
 */
export type BuildProfile = {
  /**
   * The name you pass to `--profile`. It must match the key under `profiles`.
   */
  name: string;
  /**
   * Dotenv file loaded for this profile, relative to the app folder.
   * Leave it out to load `.env`. Launch checks the names in that file against `.env.example`.
   */
  envFile?: string;
  /**
   * Extra environment variables for this profile.
   * They override the dotenv file and are overridden by keychain secrets and by `--env`.
   * Put committed, non-secret settings here. Put real secrets in `launch-store secret set`.
   */
  env?: Record<string, string>;
  /**
   * Accepted on the profile. No build step reads it, so it does not change signing or the network.
   */
  ssl?: boolean;
  /**
   * Largest download size, in megabytes, you want to ship without being asked.
   * When the size report is over this, the build stops and asks you to confirm. It does not fail by itself.
   * The default is 200, which is Apple's cellular download line. `--size-budget` overrides this for one run.
   */
  sizeBudgetMB?: number;
  /**
   * Google Play track used by `launch-store build android` when you do not pass `--track`.
   * `internal` is the default, and it is the only safe track for a new Play account.
   * `closed` and `open` are wider tests. `production` is the public track.
   * iOS ignores this.
   */
  track?: PlayTrack;
  /**
   * Share of users on the Play track who receive this release, from just above 0 up to 1.
   * `1` means everyone, and that is the default. `0.1` means about 10 percent.
   * Anything under 1 is a staged rollout. `--rollout` overrides this for one run. iOS ignores this.
   */
  rollout?: number;
};
