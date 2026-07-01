/**
 * Core app-shape vocabulary: target platform, distribution/release targets, the user-authored
 * {@link AppDescriptor} and {@link BuildProfile}, and the TestFlight beta-feedback shapes. The base
 * vocabulary the rest of the types modules build on; depends only on zod (the config SSOT — see
 * [ADR 0008](../../../docs/adr/0008-adopt-zod-config-ssot.md)).
 */

import { z } from 'zod';

/**
 * Target build platform. The Apple family — `ios`, `tvos`, `macos`, `visionos` — can only be built
 * (signed) on macOS through Xcode and shares one App Store Connect account, certs, and submitter; they
 * differ only in the Xcode build destination, the App Store Connect platform attribute, and the signing
 * profile type (see `core/platform.ts`). `android` builds with gradle on any OS and submits to Google
 * Play. Use {@link import("../platform.js").isApplePlatform} rather than `=== "ios"` to branch the
 * Apple-vs-Android toolchain, so the three newer Apple platforms aren't silently routed to Android.
 *
 * The runtime array is the SSOT: {@link Platform} is inferred from it, and the config schema reuses it as
 * a zod enum (`SubmitByPlatform`'s keys) — the same array-first pattern `ascResources.ts` uses for
 * Apple's closed enums, so a new platform is one edit here.
 */
export const PLATFORMS = ['ios', 'android', 'tvos', 'macos', 'visionos'] as const;

/** Target build platform — one of {@link PLATFORMS}. */
export type Platform = (typeof PLATFORMS)[number];

/**
 * Where an iOS build runs, as picked in the `launch` wizard. `local` is the host Mac's own Xcode;
 * `aws` and `ssh` are remote Macs; `eas` hands the build off to Expo's cloud. Android always builds
 * locally (gradle on the host), so this only varies for iOS. Persisted in a remembered wizard flow
 * (see {@link import("../lastRun.js").LastFlow}) so the next run can replay it.
 */
export type BuildLocation = 'local' | 'aws' | 'ssh' | 'eas';

/**
 * How a build is distributed.
 * - `store`: the normal path — App Store/TestFlight (iOS) or a Play track (Android). The default.
 * - `internal`: an install link for registered testers — an ad-hoc-signed `.ipa` (iOS, valid only for
 *   the devices on the ad-hoc profile) or a directly-installable `.apk` (Android), hosted on the
 *   user's own bucket with an `itms-services` manifest + landing page. The EAS "internal distribution"
 *   equivalent, with no shared cloud queue.
 */
export type Distribution = 'store' | 'internal';

/**
 * Where a submission lands, neutrally named and mapped to each store by the platform's submitter.
 * - `testing`: a testing track (iOS → TestFlight; Android → the chosen {@link PlayTrack}, default
 *   `internal`). The default, safe path.
 * - `production`: the store's public release queue (iOS App Store review / Android production track).
 *   Reached only by the deliberate `launch release` command.
 */
export type SubmitTarget = 'testing' | 'production';

/**
 * A Google Play release track. `internal` is the safe default: a new personal Play account must run
 * ~20 testers for 14 days on a testing track before production is unlocked, so defaulting anywhere
 * else would fail for fresh accounts. Has no iOS equivalent. Array-first (SSOT) so the config schema
 * ({@link BuildProfile}'s `track`) reuses it as a zod enum.
 */
export const PLAY_TRACKS = ['internal', 'closed', 'open', 'production'] as const;

/** A Google Play release track — one of {@link PLAY_TRACKS}. */
export type PlayTrack = (typeof PLAY_TRACKS)[number];

/**
 * Which web console page `launch open` deep-links to. Each value maps to a per-platform URL in
 * `core/consoleLinks.ts` — the connective tissue between a read-only finding ("agreement unsigned")
 * and the irreducible UI step that fixes it. `asc` / `play` are the platform consoles' home for the
 * app; the rest target a specific section:
 * - `asc`: the app's App Store Connect overview (Apple) — the default target.
 * - `play`: the Google Play Console (Android's equivalent of `asc`).
 * - `testflight`: the app's TestFlight tab (iOS only — Android testing lives on Play tracks).
 * - `listing`: the App Store / Play store-listing page where copy and screenshots are edited.
 * - `reviews`: the app's ratings-and-reviews page.
 * - `agreements`: the account's agreements, tax, and banking page (no per-app id).
 * - `app-record`: the app's record page — the one step the API can't create (see the `app-record` glossary topic).
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
export interface AndroidReleaseOptions {
  /** The Play track this build is assigned to. */
  track: PlayTrack;
  /** Staged-rollout fraction for a production release, 0–1 (`1` = full rollout). Ignored off production. */
  rollout: number;
}

/**
 * Which kind of TestFlight beta feedback a {@link BetaFeedback} carries — Apple keeps the two on
 * separate resources (`betaFeedbackCrashSubmissions` / `betaFeedbackScreenshotSubmissions`), which is
 * also the discriminant `launch testflight feedback --type` filters on.
 */
export type BetaFeedbackKind = 'crash' | 'screenshot';

/**
 * One TestFlight screenshot attachment on a {@link BetaFeedback} — a presigned image URL plus its
 * pixel dimensions. The URL expires (Apple signs it for a short window), so it's for immediate viewing
 * or download, not long-term storage; `launch testflight feedback --out` fetches it before it lapses.
 */
export interface BetaFeedbackScreenshot {
  /** Presigned image URL (short-lived). Absent rows are dropped, so this is always present here. */
  url: string;
  /** Image width in pixels, when Apple reports it. */
  width?: number;
  /** Image height in pixels, when Apple reports it. */
  height?: number;
}

/**
 * One piece of TestFlight beta feedback, normalized across Apple's two submission resources into the
 * single shape `launch testflight feedback` renders. `kind` discriminates the two: a `crash` carries no
 * `screenshots`; a `screenshot` carries one or more. The `*Resource`/wire types stay in `ascClient.ts`;
 * this is the product-facing read model the CLI and `--json` output share, so it omits Apple ids beyond
 * the feedback's own and keeps only the fields a developer triages from.
 */
export interface BetaFeedback {
  /** Apple's resource id for this submission — stable, used as the `--json` key and in the rendered header. */
  id: string;
  /** Whether this is a crash report or a screenshot submission. */
  kind: BetaFeedbackKind;
  /** ISO-8601 instant the tester submitted the feedback, when Apple reports it. */
  createdDate?: string;
  /** The tester's free-text comment, when they left one (crashes often have none). */
  comment?: string;
  /** The tester's email, when Apple includes it on the submission. */
  email?: string;
  /** Device marketing model, e.g. `iPhone 15 Pro`, when reported. */
  deviceModel?: string;
  /** OS version the feedback came from, e.g. `17.5.1`, when reported. */
  osVersion?: string;
  /** The `CFBundleVersion` of the build the feedback is against, resolved from the included build, when known. */
  buildVersion?: string;
  /** Attached screenshots — present (and non-empty) only on the `screenshot` kind. */
  screenshots?: BetaFeedbackScreenshot[];
}

/**
 * One app discovered in the surrounding monorepo.
 *
 * Launch auto-discovers these by scanning for `app.json`/`app.config` files, so the
 * facts here (bundle id, version) come straight from Expo's config and are never
 * duplicated in Launch's own config — `app.json` stays the single source of truth.
 */
export interface AppDescriptor {
  /** Short, unique handle used on the CLI (`launch build ios --app <name>`). Derived from the app slug. */
  name: string;
  /** Absolute path to the app's project directory (the folder containing its `app.json`). */
  dir: string;
  /** Absolute path to the discovered `app.json` / `app.config.*`. */
  configPath: string;
  /** iOS bundle identifier (`ios.bundleIdentifier`), e.g. `com.loopi.pomedero`. Undefined for Android-only apps. */
  bundleId?: string;
  /** Android application id (`android.package`), e.g. `com.loopi.pomedero`. Undefined for iOS-only apps. */
  packageName?: string;
  /** Human version string (`expo.version`), e.g. `1.0.0`. */
  version?: string;
  /**
   * The app's iOS entitlements (`ios.entitlements` from `app.json`/`app.config`), verbatim. This is the
   * single source of truth for which capabilities `launch sync` enables on the bundle id — read from
   * the app's own Expo config (exactly where EAS reads them), never redeclared in `launch.config.ts`.
   * Absent when the app declares no entitlements.
   */
  iosEntitlements?: Record<string, unknown>;
  /**
   * Bundle identifiers of the app's embedded iOS app-extension targets (WidgetKit widgets, share /
   * notification extensions, …), e.g. `["com.loopi.pomedero.widget"]`. Each is provisioned exactly like
   * the main bundle (App ID → capabilities → App Store profile, reusing the team's one distribution
   * certificate) and added to the export-options `provisioningProfiles` map so `xcodebuild` can sign the
   * whole `.ipa`. Declared under the app's own Expo config (`ios.extensions`).
   *
   * This is a *supplement* to, not a replacement for, automatic discovery: when the generated
   * `*.xcodeproj/project.pbxproj` exists at build time the pipeline reads each target's authoritative
   * `PRODUCT_BUNDLE_IDENTIFIER` (`core/appleTargets.ts`) and unions it with this list, so an app
   * generated by `@bacons/apple-targets` needs no manual entry here at all. The config field remains for
   * apps whose project isn't generated yet, or to provision an extension ahead of prebuild. Absent when
   * the app declares no extensions in config (discovery may still find some). The union always excludes
   * the main bundle id, so a single-target app provisions exactly the main bundle as before.
   */
  iosExtensions?: string[];
  /**
   * Android `versionCode` floor from `app.json` (`android.versionCode`). The store's latest + 1 wins
   * when higher, so an intentional local bump is never clobbered but the store stays the source of truth.
   */
  androidVersionCode?: number;
  /**
   * Export-compliance answer from `app.json` (`ios.config.usesNonExemptEncryption`) — the standard Expo
   * field that becomes `ITSAppUsesNonExemptEncryption` in the built `Info.plist`. Read from the app's own
   * Expo config (exactly where EAS reads it), never redeclared in `launch.config.ts`. `false` means the
   * app uses no encryption, or only exempt encryption, so the binary self-answers the export-compliance
   * question and no per-upload prompt appears; `true` means it uses non-exempt encryption and needs a
   * formal {@link https://developer.apple.com/documentation/appstoreconnectapi/appencryptiondeclaration App Encryption Declaration}.
   * Absent when the app leaves the field unset — then App Store Connect re-asks the question on every
   * upload (see `core/exportCompliance.ts`). iOS only.
   */
  usesNonExemptEncryption?: boolean;
}

/**
 * A named build profile from `launch.config.ts` (e.g. `production`, `preview`) — see
 * {@link BuildProfileSchema}. Holds only Launch-specific settings; app facts stay in `app.json`.
 */
export const BuildProfileSchema = z
  .strictObject({
    name: z.string().describe('Profile name as referenced by `--profile`.'),
    envFile: z
      .string()
      .describe(
        'Dotenv file to load for this profile, relative to the app dir. Defaults to `.env`.',
      )
      .optional(),
    env: z
      .record(z.string(), z.string())
      .describe(
        'Inline env vars for this profile, merged into the build/update/release environment. They sit above the dotenv files (`.env.local`, `.env.<profile>`, `.env`) but below keychain secrets and `--env` flags in the precedence ladder — see `core/env.ts` `resolveEnv`. Use for non-secret, committed config that should travel with the profile; keep real secrets in `launch secret`.',
      )
      .optional(),
    ssl: z
      .boolean()
      .describe(
        'Enable SSL pinning for this profile (mirrors the existing build.ts toggle). Defaults to false.',
      )
      .optional(),
    sizeBudgetMB: z
      .number()
      .describe(
        "Per-device download-size budget in megabytes. When the size report exceeds it, the build soft-gates (asks for confirmation) rather than failing. Defaults to 200 (Apple's cellular line).",
      )
      .optional(),
    track: z
      .enum(PLAY_TRACKS)
      .describe(
        'Android-only: default Play track for `launch build android` when `--track` is omitted. Defaults to `internal` (the only safe target for a fresh account). Ignored on iOS.',
      )
      .optional(),
    rollout: z
      .number()
      .describe(
        'Android-only: default staged-rollout fraction (0–1) for production releases when `--rollout` is omitted. Defaults to `1.0` (full rollout). Ignored on iOS.',
      )
      .optional(),
  })
  .meta({
    id: 'BuildProfile',
    description:
      'A named build profile from `launch.config.ts` (e.g. `production`, `preview`). Holds only Launch-specific settings; app facts stay in `app.json`. A profile maps to a `.env` file whose values are injected into the build and gates the artifact on size.',
  });

/** A named build profile from `launch.config.ts` — the inferred shape of {@link BuildProfileSchema}. */
export type BuildProfile = z.infer<typeof BuildProfileSchema>;
