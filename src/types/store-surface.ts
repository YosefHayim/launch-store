import type {
  APP_CLIP_ACTIONS,
  LEADERBOARD_FORMATTERS,
  LEADERBOARD_SORT_TYPES,
  LEADERBOARD_SUBMISSION_TYPES,
} from './apple-catalog.ts';
/**
 * How an approved iOS build reaches the public App Store.
 * `AFTER_APPROVAL` goes live as soon as Apple says yes.
 * `MANUAL` waits until you release it yourself.
 * `SCHEDULED` waits until `earliestReleaseDate`.
 */
export type ReleaseType = 'AFTER_APPROVAL' | 'MANUAL' | 'SCHEDULED';
/** How `launch release` publishes an approved iOS version. */
export type ReleaseConfig = Readonly<{
  /**
   * What happens after Apple approves the version.
   * `AFTER_APPROVAL` publishes immediately. That is the default.
   * `MANUAL` waits for you. `SCHEDULED` waits for `earliestReleaseDate`.
   * `--manual` and `--scheduled` override this for one run.
   */
  releaseType?: ReleaseType;
  /**
   * When a scheduled version goes live, as an ISO-8601 instant such as `2026-09-01T12:00:00Z`.
   * Only used when `releaseType` is `SCHEDULED`. Other release types ignore it.
   */
  earliestReleaseDate?: string;
  /**
   * Copyright line Apple shows on the version, such as `2026 Acme`.
   * Apple will not send a version to review with an empty copyright.
   * Leave it out to keep whatever is already set in App Store Connect.
   */
  copyright?: string;
  /**
   * Turn on Apple's 7-day phased release, which grows the share of users each day.
   * Leave it out, or set false, to publish to everyone at once.
   * `--phased` overrides this for one run. Apple only phases updates, not a brand-new app.
   * After release, `launch rollout` can pause, resume, or finish the ramp.
   */
  phasedRelease?: boolean;
  /**
   * Apple's export-compliance question: does the binary contain encryption beyond ordinary HTTPS?
   * `false` is the usual answer and lets Launch clear the question over the API.
   * `true` means you ship your own encryption. Launch then stops, because Apple needs documents the API cannot accept.
   * The default is `false`.
   */
  usesNonExemptEncryption?: boolean;
  /**
   * "What's New in This Version", shown to people updating the app.
   * A string is used for `primaryLocale`. An object is one note per locale, such as `{ "en-US": "Bug fixes." }`.
   * Leave it out and Launch copies the previous version's notes, so a release does not ship an empty What's New.
   * The first version of an app has no What's New, and this is skipped.
   */
  releaseNotes?: string | Record<string, string>;
  /**
   * Locale used when `releaseNotes` is a single string. The default is `en-US`.
   * When notes are an object, this is the locale Launch treats as the primary one.
   */
  primaryLocale?: string;
}>;
/** A ping Launch sends after a build, a submit, a review verdict, or a rollout change. */
export type NotifyConfig = Readonly<{
  /**
   * Webhook posted on each selected event. The address is not a secret.
   * The JSON body has `text` for Slack and `content` for Discord, plus the event fields,
   * so either kind of incoming webhook can show it without a translator.
   */
  webhookUrl?: string;
  /**
   * Shell command run on each selected event, the same way a git hook runs.
   * The event is in the environment as `LAUNCH_EVENT`, `LAUNCH_STATUS`, `LAUNCH_APP`, and `LAUNCH_VERSION`.
   * A build or submit also sets `LAUNCH_BUILD_NUMBER`, `LAUNCH_DESTINATION`, and `LAUNCH_ERROR`.
   * A review or rollout sets `LAUNCH_DETAIL`.
   */
  command?: string;
  /**
   * Which events send a ping. Leave this out to send all four.
   * `build` and `submit` fire when that step finishes. `review` fires when Apple approves or rejects.
   * `rollout` fires when a phased release pauses, resumes, completes, or moves forward.
   */
  events?: Array<'build' | 'submit' | 'review' | 'rollout'>;
}>;
/** One Game Center achievement. `launch game-center` creates it if Apple does not have it yet. */
export type AchievementConfig = Readonly<{
  /**
   * Stable id you choose, such as `first_win`.
   * Launch matches this config entry to Apple's achievement with it. Players never see it.
   */
  vendorIdentifier: string;
  /**
   * Name shown only inside App Store Connect, not to players.
   */
  referenceName: string;
  /**
   * Points a player earns. Apple caps the total of every achievement in the app at 1000.
   */
  points: number;
  /**
   * Whether players can see the achievement before they earn it.
   * Leave it out and it stays hidden until earned.
   */
  showBeforeEarned?: boolean;
  /**
   * Whether a player can earn it more than once.
   * Leave it out and it can be earned once.
   */
  repeatable?: boolean;
  /**
   * Title the player sees, in `locale`.
   */
  name: string;
  /**
   * What the player reads before they earn it, in `locale`.
   */
  beforeEarnedDescription: string;
  /**
   * What the player reads after they earn it, in `locale`.
   */
  afterEarnedDescription: string;
  /**
   * Language of `name` and the two descriptions. The default is `en-US`.
   */
  locale?: string;
}>;
/** One Game Center leaderboard. `launch game-center` creates it if Apple does not have it yet. */
export type LeaderboardConfig = Readonly<{
  /**
   * Stable id you choose, such as `high_score`.
   * Launch matches this config entry to Apple's leaderboard with it. Players never see it.
   */
  vendorIdentifier: string;
  /**
   * Name shown only inside App Store Connect, not to players.
   */
  referenceName: string;
  /**
   * How a score is printed. `INTEGER` is a whole number. `ELAPSED_TIME_SECOND` is a time.
   * The money values print a currency. Apple's list is closed: you cannot invent a formatter.
   */
  defaultFormatter: (typeof LEADERBOARD_FORMATTERS)[number];
  /**
   * Which score is kept for each player.
   * `BEST_SCORE` keeps their best. `MOST_RECENT_SCORE` replaces it every time they submit.
   */
  submissionType: (typeof LEADERBOARD_SUBMISSION_TYPES)[number];
  /**
   * Which end of the list ranks first.
   * `DESC` means a higher score wins. `ASC` means a lower score wins, such as a faster time.
   */
  scoreSortType: (typeof LEADERBOARD_SORT_TYPES)[number];
  /**
   * Title the player sees, in `locale`.
   */
  name: string;
  /**
   * Language of `name`. The default is `en-US`.
   */
  locale?: string;
}>;
/** Game Center content for one app, under `gameCenter` keyed by that app's bundle id. */
export type GameCenterConfig = Readonly<{
  /**
   * Achievements to create. Leave it out if the app has none.
   */
  achievements?: readonly AchievementConfig[];
  /**
   * Leaderboards to create. Leave it out if the app has none.
   */
  leaderboards?: readonly LeaderboardConfig[];
}>;
/** The subtitle on an App Clip card in one language. */
export type AppClipLocalizationConfig = Readonly<{
  /**
   * Short line under the app name on the App Clip card, in this locale.
   */
  subtitle: string;
}>;
/** The card for one App Clip. The clip binary itself comes from the Xcode build, not from this block. */
export type AppClipConfig = Readonly<{
  /**
   * The button on the App Clip card.
   * `OPEN` opens the clip. `VIEW` is for looking. `PLAY` is for a game. Leave it out to keep Apple's current button.
   */
  action?: (typeof APP_CLIP_ACTIONS)[number];
  /**
   * Card subtitles, keyed by Apple locale such as `en-US`.
   */
  localizations?: Record<string, AppClipLocalizationConfig>;
}>;
/**
 * App Clips that belong to one parent app.
 * The key under `appClips` is the parent bundle id. Each key inside `clips` is the clip's own bundle id.
 */
export type AppClipsConfig = Readonly<{
  /**
   * One card per clip, keyed by the clip bundle id, such as `com.acme.app.Clip`.
   * `launch app-clips` matches that id to the clip the build already uploaded.
   */
  clips: Record<string, AppClipConfig>;
}>;
/** One domain the team may ship iOS apps from in the EU. */
export type EuDistributionDomainConfig = Readonly<{
  /**
   * Host name that will serve the install packages, such as `downloads.example.com`.
   * No `https://` prefix.
   */
  domain: string;
  /**
   * Label shown in App Store Connect so you can tell this domain from the others.
   */
  referenceName: string;
}>;
/** EU alternative-distribution domains for the whole Apple team. `launch eu-distribution` registers them. */
export type EuDistributionConfig = Readonly<{
  /**
   * Domains to authorize. Launch adds any that the team does not have yet.
   */
  domains: readonly EuDistributionDomainConfig[];
}>;
/** One Apple Pay merchant id or one Wallet pass type id. */
export type WalletIdConfig = Readonly<{
  /**
   * Reverse-DNS id to register, such as `merchant.com.acme.app` or `pass.com.acme.app`.
   */
  identifier: string;
  /**
   * Label shown in the Apple developer portal.
   */
  name: string;
}>;
/** Apple Pay and Wallet ids for the whole team. `launch wallet` registers them. */
export type WalletConfig = Readonly<{
  /**
   * Apple Pay merchant ids. The payment certificate is a separate step in the developer portal.
   */
  merchantIds?: readonly WalletIdConfig[];
  /**
   * Wallet pass type ids. A `.pkpass` is signed against one of these.
   */
  passTypeIds?: readonly WalletIdConfig[];
}>;
/** The App Store categories shoppers browse, under `releaseAttributes`. */
export type ReleaseCategories = Readonly<{
  /**
   * Main category id, such as `PRODUCTIVITY` or `GAMES`.
   * This is the category Apple shows first on the product page.
   */
  primary?: string;
  /**
   * Optional second category, the same kind of id.
   * Leave it out to keep the second category already on the app.
   */
  secondary?: string;
}>;
/** The app's price on the App Store, under `releaseAttributes`. This is the app itself, not an in-app purchase. */
export type ReleasePricing = Readonly<{
  /**
   * Territory whose price ladder is used, such as `USA`. The default is `USA`.
   * Apple sets the other territories from this one.
   */
  baseTerritory?: string;
  /**
   * Price the customer pays in that territory. `0` is free.
   * It must be a rung on Apple's price ladder, such as `0.99`, not an arbitrary amount.
   */
  customerPrice: number;
}>;
/** Who App Review contacts, and how they sign in, under `releaseAttributes`. */
export type ReviewDetailsConfig = Readonly<{
  /**
   * First name of the person App Review should contact.
   */
  contactFirstName?: string;
  /**
   * Last name of that person.
   */
  contactLastName?: string;
  /**
   * Phone number App Review can call. Include the country code.
   */
  contactPhone?: string;
  /**
   * Email App Review uses if they need to reach you.
   */
  contactEmail?: string;
  /**
   * True when the reviewer has to sign in before they can use the app.
   * False when the app works without an account.
   */
  demoAccountRequired?: boolean;
  /**
   * User name for that demo account. Leave it out when no sign-in is required.
   */
  demoAccountName?: string;
  /**
   * Password for that demo account. Prefer not to commit the real password.
   * `env:REVIEW_PASSWORD` reads it from the environment. `keychain:review-password` reads it from the OS keychain.
   * Any other text is sent as the password itself. Launch does not print it and does not read it back from Apple.
   */
  demoAccountPassword?: string;
  /**
   * Anything else the reviewer should know, such as "No login is required."
   */
  notes?: string;
}>;
/**
 * Age rating, categories, price, and review contact for one app.
 * The key under `releaseAttributes` is the iOS bundle id. `launch release-config` writes each section you set.
 * This is not `release`, which only decides when an approved version goes live.
 */
export type ReleaseAttributesConfig = Readonly<{
  /**
   * Answers to Apple's age-rating questions, keyed by Apple's question id, such as `violenceCartoonOrFantasy`.
   * A frequency answer is `NONE`, `INFREQUENT_OR_MILD`, or `FREQUENT_OR_INTENSE`. A yes-or-no question is a boolean.
   * Leave this out to keep the rating already set in App Store Connect.
   */
  ageRating?: Record<string, string | boolean>;
  /**
   * Primary and secondary App Store categories.
   */
  categories?: ReleaseCategories;
  /**
   * Price of the app itself. `customerPrice: 0` is free.
   */
  pricing?: ReleasePricing;
  /**
   * Contact and demo account for App Review.
   */
  reviewDetails?: ReviewDetailsConfig;
}>;
/**
 * Paths to the JSON files for store surfaces that have no inline block in launch.config.ts.
 * Each path is relative to the folder that holds launch.config.ts. Leave one out to use its default file name.
 */
export type SurfaceConfigFiles = Readonly<{
  /**
   * Territories the app is sold in. The default file name is `availability.config.json`.
   * `launch availability` reads it.
   */
  availability?: string;
  /**
   * Apple's accessibility nutrition labels. The default file name is `accessibility.config.json`.
   * `launch accessibility` reads it.
   */
  accessibility?: string;
  /**
   * Product-page A/B tests (icon, screenshots, or text). The default file name is `experiments.config.json`.
   * `launch experiments` reads it.
   */
  experiments?: string;
  /**
   * Extra App Store product pages, each with its own link. The default file name is `custom-pages.config.json`.
   * `launch custom-pages` reads it.
   */
  customPages?: string;
}>;
/**
 * What an agent using `launch mcp` is allowed to do.
 * A higher tier does not include the ones below it. List every tier you want.
 */
export type McpCapability = 'read' | 'dryRun' | 'write' | 'dangerous';
/** The `mcp` block of launch.config.ts. Leave the whole block out for read-only. */
export type McpConfig = Readonly<{
  /**
   * Tools the MCP server may expose.
   * `read` looks at the project and the store and changes nothing. That is the default.
   * `dryRun` shows what a change would do and still changes nothing.
   * `write` applies a reconcile. `dangerous` includes a sync that can delete store records.
   * An empty list is treated the same as leaving this out: read only.
   */
  capabilities?: readonly McpCapability[];
}>;
