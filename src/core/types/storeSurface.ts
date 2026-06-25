/**
 * Store-surface config sections folded in from their JSON sidecars (issue #101): release attributes,
 * Game Center, App Clips, EU distribution, Wallet, and the MCP capability set. Reuses the App Store
 * Connect schema enums that `apple/ascClient.ts` owns rather than duplicating Apple's lists.
 */

// These sections reuse the App Store Connect schema enums that `apple/ascClient.ts` owns and guards
// against the generated OpenAPI types. This is a type-only import (erased at build, no runtime
// dependency or cycle), and it keeps the enums single-sourced where they're validated rather than
// duplicating Apple's lists here.
import type {
  AgeRatingValue,
  AppClipActionValue,
  LeaderboardFormatter,
  LeaderboardSortType,
  LeaderboardSubmissionType,
} from "../../apple/ascClient.js";

/**
 * How an approved iOS build reaches the public App Store — the App Store version's `releaseType`,
 * mirroring Apple's enum on the `appStoreVersions` resource. Read by `launch release`, overridable
 * per-run with `--manual` / `--scheduled <iso>`.
 * - `AFTER_APPROVAL`: go live automatically the moment Apple approves. Launch's default — the
 *   hands-off path most solo developers want.
 * - `MANUAL`: hold after approval until you press release (`launch status` shows it's pending). Use
 *   to line the go-live up with a marketing moment.
 * - `SCHEDULED`: go live at a fixed future instant, set via {@link ReleaseConfig.earliestReleaseDate}.
 */
export type ReleaseType = "AFTER_APPROVAL" | "MANUAL" | "SCHEDULED";

/**
 * iOS public-release policy, declared under {@link LaunchConfig.release}. These are the defaults
 * `launch release` applies to the App Store version it submits; every field is optional, so an absent
 * `release` block means "go live after approval, all at once" — the safe, common case. Android release
 * policy is unaffected (it rides on the Play track + `--rollout`, see {@link AndroidReleaseOptions}).
 *
 * Scope: this drives an UPDATE to an already-configured app. A brand-new app's first submission still
 * needs portal-only steps (screenshots, age rating, signed agreements) and the app record itself —
 * which Apple has no API to create — so `launch release` detects that and prints a one-time checklist.
 */
export interface ReleaseConfig {
  /** How an approved build reaches the store. Defaults to `AFTER_APPROVAL`. Overridable with `--manual`/`--scheduled`. */
  releaseType?: ReleaseType;
  /**
   * ISO-8601 instant to go live at — only meaningful with `releaseType: "SCHEDULED"` (ignored otherwise).
   * A `--scheduled <iso>` flag sets both this and the release type for one run.
   */
  earliestReleaseDate?: string;
  /**
   * Opt into Apple's 7-day phased release (a gradual percentage rollout) for an approved update.
   * Defaults to `false` — an immediate 100% release. Overridable per-run with `--phased`, and steerable
   * afterward with `launch rollout <pause|resume|complete>`. Ignored for a first version (Apple only
   * phases updates).
   */
  phasedRelease?: boolean;
  /**
   * Whether the binary contains non-exempt encryption (Apple's export-compliance question). `false` —
   * the common case for apps using only standard HTTPS/system crypto — lets Launch declare compliance
   * over the API so the build clears `WAITING_FOR_EXPORT_COMPLIANCE` without a portal trip. Set `true`
   * only if you ship proprietary/non-exempt encryption; Launch then stops and points you to the portal,
   * since genuine non-exempt encryption requires documentation Apple's API can't accept. Defaults to `false`.
   */
  usesNonExemptEncryption?: boolean;
  /**
   * Release notes ("What's New in This Version"), per App Store locale (e.g. `{ "en-US": "Bug fixes." }`)
   * or a single string applied to {@link ReleaseConfig.primaryLocale}. When absent, Launch reuses the
   * previous version's notes so a release never ships an empty "What's New". Apple stores these on the
   * version's localization, not the version itself.
   */
  releaseNotes?: string | Record<string, string>;
  /** Primary App Store locale for a bare-string {@link ReleaseConfig.releaseNotes}. Defaults to `en-US`. */
  primaryLocale?: string;
}

/**
 * Transition notifications — the EAS-`webhook` parity hook, declared under {@link LaunchConfig.notify}.
 * Fires on the milestones a dev waits on: a build/submit finishing, an App Store review reaching a
 * verdict, and a phased rollout changing state. A local Mac build can run many minutes and Apple's
 * verdict lands hours later; this pings on each transition. All fields are optional and independent:
 * set a `webhookUrl`, a `command`, both, or (absent) get the silent default; restrict which transitions
 * fire with `events`. Fired on success AND failure; never blocks or fails the run (best-effort).
 */
export interface NotifyConfig {
  /**
   * Incoming-webhook URL posted a JSON body on each transition. The payload carries both `text` (Slack)
   * and `content` (Discord) set to a human summary, plus the structured event fields, so a Slack or
   * Discord webhook renders it directly and a custom endpoint can read the typed data.
   */
  webhookUrl?: string;
  /**
   * Shell command run on each transition with the event in its environment as `LAUNCH_*` vars
   * (`LAUNCH_EVENT`, `LAUNCH_STATUS`, `LAUNCH_APP`, `LAUNCH_VERSION`; plus `LAUNCH_BUILD_NUMBER`,
   * `LAUNCH_DESTINATION`, `LAUNCH_ERROR` on build/submit, or `LAUNCH_DETAIL` on review/rollout). Runs
   * under `/bin/sh -c`, like a git hook.
   */
  command?: string;
  /** Which transitions fire a notification. Absent = all. */
  events?: ("build" | "submit" | "review" | "rollout")[];
}

/** One declared Game Center achievement: Apple's create attributes plus its default-locale localization. */
export interface AchievementConfig {
  /** Developer-chosen stable id used to match config to Apple's record (never shown to players). */
  vendorIdentifier: string;
  /** Internal name shown in App Store Connect. */
  referenceName: string;
  /** Points awarded (Apple caps the total across achievements at 1000). */
  points: number;
  /** Whether the achievement is visible to players before it's earned (default false). */
  showBeforeEarned?: boolean;
  /** Whether it can be earned more than once (default false). */
  repeatable?: boolean;
  /** Player-facing title in the localization. */
  name: string;
  /** Player-facing description shown before the achievement is earned. */
  beforeEarnedDescription: string;
  /** Player-facing description shown after it's earned. */
  afterEarnedDescription: string;
  /** Locale for the localization above (default `en-US`). */
  locale?: string;
}

/** One declared Game Center leaderboard: Apple's create attributes plus its default-locale localization name. */
export interface LeaderboardConfig {
  vendorIdentifier: string;
  referenceName: string;
  /** How scores are formatted (e.g. `INTEGER`, `ELAPSED_TIME_SECOND`). */
  defaultFormatter: LeaderboardFormatter;
  /** Whether the board keeps each player's best or most recent score. */
  submissionType: LeaderboardSubmissionType;
  /** Whether higher (`DESC`) or lower (`ASC`) scores rank first. */
  scoreSortType: LeaderboardSortType;
  /** Player-facing title in the localization. */
  name: string;
  /** Locale for the localization above (default `en-US`). */
  locale?: string;
}

/**
 * An app's declared Game Center achievements and leaderboards — the `gamecenter.config.json` document,
 * or one entry of {@link LaunchConfig.gameCenter} (keyed by iOS bundle id). Either list may be omitted.
 * Reconciled additively by `launch game-center`.
 */
export interface GameCenterConfig {
  achievements?: AchievementConfig[];
  leaderboards?: LeaderboardConfig[];
}

/** One locale of an App Clip card: the subtitle shown under the app name in that locale. */
export interface AppClipLocalizationConfig {
  subtitle: string;
}

/**
 * One App Clip's declared card metadata. Both fields are optional and reconciled independently, so a clip
 * may declare just an `action`, just `localizations`, or both.
 */
export interface AppClipConfig {
  /** The card's call-to-action button (`OPEN` / `VIEW` / `PLAY`). */
  action?: AppClipActionValue;
  /** Per-locale card subtitles, keyed by Apple locale (e.g. `en-US`). */
  localizations?: Record<string, AppClipLocalizationConfig>;
}

/**
 * An app's declared App Clips — the `appclips.config.json` document, or one entry of
 * {@link LaunchConfig.appClips} (keyed by the parent app's iOS bundle id). Each App Clip is keyed by
 * its **own** bundle id (e.g. `com.acme.app.Clip`), which is how a config entry is matched to the clip
 * the build produced. Reconciled by `launch app-clips`.
 */
export interface AppClipsConfig {
  clips: Record<string, AppClipConfig>;
}

/** One authorized EU distribution domain: the host plus a human-readable reference name. */
export interface EuDistributionDomainConfig {
  /** The domain authorized to host distribution packages (e.g. `downloads.acme.com`). */
  domain: string;
  /** A label shown in App Store Connect to identify the domain. */
  referenceName: string;
}

/**
 * The team's EU alternative-distribution domains — the `eu-distribution.config.json` document, or
 * {@link LaunchConfig.euDistribution}. Team-level (not per-app); reconciled by `launch eu-distribution`.
 */
export interface EuDistributionConfig {
  /** Domains to authorize for EU alternative distribution. */
  domains: EuDistributionDomainConfig[];
}

/** One declared Apple identifier: the reverse-DNS id plus a human-readable name shown in the portal. */
export interface WalletIdConfig {
  /** The identifier to register (e.g. `merchant.com.acme.app` or `pass.com.acme.coupon`). */
  identifier: string;
  /** A label shown in App Store Connect / the developer portal. */
  name: string;
}

/**
 * The team's Apple Pay merchant ids and Wallet pass type ids — the `wallet.config.json` document, or
 * {@link LaunchConfig.wallet}. Team-level; either family may be omitted. Registered by `launch wallet`.
 */
export interface WalletConfig {
  /** Apple Pay merchant ids to register. */
  merchantIds?: WalletIdConfig[];
  /** Wallet pass type ids to register. */
  passTypeIds?: WalletIdConfig[];
}

/** Declared primary/secondary App Store categories (`appCategories` ids such as `PRODUCTIVITY`). */
export interface ReleaseCategories {
  primary?: string;
  secondary?: string;
}

/** Declared base price: a customer price (e.g. `9.99`) in a base territory Apple equalizes from. */
export interface ReleasePricing {
  /** Base territory to anchor the price on (default `USA`). */
  baseTerritory?: string;
  /** The customer-facing price in the base territory; must match one of Apple's price-ladder rungs. */
  customerPrice: number;
}

/**
 * Declared App Review details: the contact Apple reaches and the demo account its reviewer signs in
 * with. Field names match Apple's `appStoreReviewDetails` attributes verbatim. `demoAccountPassword` is
 * never read back from Apple or logged.
 */
export interface ReviewDetailsConfig {
  contactFirstName?: string;
  contactLastName?: string;
  contactPhone?: string;
  contactEmail?: string;
  demoAccountRequired?: boolean;
  demoAccountName?: string;
  demoAccountPassword?: string;
  notes?: string;
}

/**
 * An app's declared App Store *release attributes* — age rating, App Store categories, base price, and
 * App Review details — the `release.config.json` document, or one entry of
 * {@link LaunchConfig.releaseAttributes} (keyed by iOS bundle id). Every section is optional and
 * reconciled independently by `launch release-config`, so a file may declare only the attribute(s) you
 * manage as code (e.g. just `pricing`). Named to avoid colliding with {@link ReleaseConfig}, which is
 * the distinct iOS *release policy* (when/how a version goes live).
 */
export interface ReleaseAttributesConfig {
  /** Age-rating answers as Apple's `name → value` map (enum strings or booleans); only changed keys are sent. */
  ageRating?: Record<string, AgeRatingValue>;
  categories?: ReleaseCategories;
  pricing?: ReleasePricing;
  reviewDetails?: ReviewDetailsConfig;
}

/**
 * Where the **sidecar-only** surfaces keep their `*.config.json` desired-state files when not at the
 * default filename. These surfaces have no typed field on {@link LaunchConfig}, so without this map a
 * non-interactive caller — chiefly `launch plan` / `launch drift`, which has no per-surface `--config`
 * flag — can only find a sidecar at its default name. Declaring a path here makes `plan` read the same
 * file the command would (the existing `resolveSidecarConfig` consumes it). Each entry is optional; omit
 * the whole map to use defaults (`availability.config.json`, `accessibility.config.json`,
 * `experiments.config.json`, `custom-pages.config.json`).
 */
export interface SurfaceConfigFiles {
  availability?: string;
  accessibility?: string;
  experiments?: string;
  customPages?: string;
}

/**
 * The capability tiers a tool can require, in ascending order of blast radius — the gate behind
 * `launch mcp`. A tool is tagged with exactly one tier; the MCP server registers only the tools whose
 * tier the user has enabled in {@link McpConfig.capabilities}, so an agent can never reach a write tool
 * the operator didn't opt into.
 * - `read` — pure introspection (plan, audit, doctor): no store or filesystem writes. The safe default.
 * - `dryRun` — rehearses a mutation and reports what it *would* do, still writing nothing.
 * - `write` — reconciles live store state (e.g. `launch sync`): visible, reversible-with-effort changes.
 * - `dangerous` — destructive or hard-to-reverse (deletions, irreversible submissions); opt-in only.
 */
export type McpCapability = "read" | "dryRun" | "write" | "dangerous";

/**
 * The `mcp` block of `launch.config.ts` — how `launch mcp` exposes Launch to AI agents. Absent means
 * least privilege: the server offers only `read`-tier tools, so wiring up an agent can never mutate a
 * store until the operator widens {@link McpConfig.capabilities} on purpose. Declared here (not inline in
 * the command) so #173's generator emits it into the config schema and `launch config validate/docs`
 * cover it for free.
 */
export interface McpConfig {
  /**
   * Which capability tiers the MCP server may expose. Each enabled tier unlocks the tools tagged at that
   * tier; omit (or `[]`) for `["read"]` — read-only. Listing a higher tier does not imply the lower ones,
   * so `["read", "write"]` is the usual "let agents read everything and run reconciles" posture.
   */
  capabilities?: McpCapability[];
}
