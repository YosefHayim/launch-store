// Holds App Store release, Game Center, App Clip, Wallet, and related store settings.

import type {
  APP_CLIP_ACTIONS,
  LEADERBOARD_FORMATTERS,
  LEADERBOARD_SORT_TYPES,
  LEADERBOARD_SUBMISSION_TYPES,
} from './apple-catalog.ts';

/** How an approved iOS build reaches the public App Store. */
export type ReleaseType = 'AFTER_APPROVAL' | 'MANUAL' | 'SCHEDULED';

/** How `launch-store release` publishes an approved iOS version. */
export type ReleaseConfig = {
  /** What happens after Apple approves the version. */
  readonly releaseType?: ReleaseType;
  /** When a scheduled version goes live, as an ISO-8601 instant such as `2026-09-01T12:00:00Z`. */
  readonly earliestReleaseDate?: string;
  /** Copyright line Apple shows on the version, such as `2026 Acme`. */
  readonly copyright?: string;
  /** Turn on Apple's 7-day phased release, which grows the share of users each day. */
  readonly phasedRelease?: boolean;
  /** Apple's export-compliance question */
  readonly usesNonExemptEncryption?: boolean;
  /** "What's New in This Version", shown to people updating the app. */
  readonly releaseNotes?: string | Record<string, string>;
  /** Locale used when `releaseNotes` is a single string. */
  readonly primaryLocale?: string;
};

/** A ping Launch sends after a build, a submit, a review verdict, or a rollout change. */
export type NotifyConfig = {
  /** Webhook posted on each selected event. */
  readonly webhookUrl?: string;
  /** Shell command run on each selected event, the same way a git hook runs. */
  readonly command?: string;
  /** Which events send a ping. */
  readonly events?: Array<'build' | 'submit' | 'review' | 'rollout'>;
};

/** One Game Center achievement. `launch-store game-center` creates it if Apple does not have it yet. */
export type AchievementConfig = {
  /** Stable id you choose, such as `first_win`. */
  readonly vendorIdentifier: string;
  /** Name shown only inside App Store Connect, not to players. */
  readonly referenceName: string;
  /** Points a player earns. */
  readonly points: number;
  /** Whether players can see the achievement before they earn it. */
  readonly showBeforeEarned?: boolean;
  /** Whether a player can earn it more than once. */
  readonly repeatable?: boolean;
  /** Title the player sees, in `locale`. */
  readonly name: string;
  /** What the player reads before they earn it, in `locale`. */
  readonly beforeEarnedDescription: string;
  /** What the player reads after they earn it, in `locale`. */
  readonly afterEarnedDescription: string;
  /** Language of `name` and the two descriptions. */
  readonly locale?: string;
};

/** One Game Center leaderboard. `launch-store game-center` creates it if Apple does not have it yet. */
export type LeaderboardConfig = {
  /** Stable id you choose, such as `high_score`. */
  readonly vendorIdentifier: string;
  /** Name shown only inside App Store Connect, not to players. */
  readonly referenceName: string;
  /** How a score is printed. */
  readonly defaultFormatter: (typeof LEADERBOARD_FORMATTERS)[number];
  /** Which score is kept for each player. */
  readonly submissionType: (typeof LEADERBOARD_SUBMISSION_TYPES)[number];
  /** Which end of the list ranks first. */
  readonly scoreSortType: (typeof LEADERBOARD_SORT_TYPES)[number];
  /** Title the player sees, in `locale`. */
  readonly name: string;
  /** Language of `name`. */
  readonly locale?: string;
};

/** Game Center content for one app, under `gameCenter` keyed by that app's bundle id. */
export type GameCenterConfig = {
  /** Achievements to create. */
  readonly achievements?: readonly AchievementConfig[];
  /** Leaderboards to create. */
  readonly leaderboards?: readonly LeaderboardConfig[];
};

/** The subtitle on an App Clip card in one language. */
export type AppClipLocalizationConfig = {
  /** Short line under the app name on the App Clip card, in this locale. */
  readonly subtitle: string;
};

/** The card for one App Clip. The clip binary itself comes from the Xcode build, not from this block. */
export type AppClipConfig = {
  /** The button on the App Clip card. */
  readonly action?: (typeof APP_CLIP_ACTIONS)[number];
  /** Card subtitles, keyed by Apple locale such as `en-US`. */
  readonly localizations?: Record<string, AppClipLocalizationConfig>;
};

/** App Clips that belong to one parent app. */
export type AppClipsConfig = {
  /** One card per clip, keyed by the clip bundle id, such as `com.acme.app.Clip`. */
  readonly clips: Record<string, AppClipConfig>;
};

/** One domain the team may ship iOS apps from in the EU. */
export type EuDistributionDomainConfig = {
  /** Host name that will serve the install packages, such as `downloads.example.com`. */
  readonly domain: string;
  /** Label shown in App Store Connect so you can tell this domain from the others. */
  readonly referenceName: string;
};

/** EU alternative-distribution domains for the whole Apple team. `launch-store eu-distribution` registers them. */
export type EuDistributionConfig = {
  /** Domains to authorize. */
  readonly domains: readonly EuDistributionDomainConfig[];
};

/** One Apple Pay merchant id or one Wallet pass type id. */
export type WalletIdConfig = {
  /** Reverse-DNS id to register, such as `merchant.com.acme.app` or `pass.com.acme.app`. */
  readonly identifier: string;
  /** Label shown in the Apple developer portal. */
  readonly name: string;
};

/** Apple Pay and Wallet ids for the whole team. `launch-store wallet` registers them. */
export type WalletConfig = {
  /** Apple Pay merchant ids. */
  readonly merchantIds?: readonly WalletIdConfig[];
  /** Wallet pass type ids. */
  readonly passTypeIds?: readonly WalletIdConfig[];
};

/** The App Store categories shoppers browse, under `releaseAttributes`. */
export type ReleaseCategories = {
  /** Main category id, such as `PRODUCTIVITY` or `GAMES`. */
  readonly primary?: string;
  /** Optional second category, the same kind of id. */
  readonly secondary?: string;
};

/** The app's price on the App Store, under `releaseAttributes`. This is the app itself, not an in-app purchase. */
export type ReleasePricing = {
  /** Territory whose price ladder is used, such as `USA`. */
  readonly baseTerritory?: string;
  /** Price the customer pays in that territory. */
  readonly customerPrice: number;
};

/** Who App Review contacts, and how they sign in, under `releaseAttributes`. */
export type ReviewDetailsConfig = {
  /** First name of the person App Review should contact. */
  readonly contactFirstName?: string;
  /** Last name of that person. */
  readonly contactLastName?: string;
  /** Phone number App Review can call. */
  readonly contactPhone?: string;
  /** Email App Review uses if they need to reach you. */
  readonly contactEmail?: string;
  /** True when the reviewer has to sign in before they can use the app. */
  readonly demoAccountRequired?: boolean;
  /** User name for that demo account. */
  readonly demoAccountName?: string;
  /** Password for that demo account. */
  readonly demoAccountPassword?: string;
  /** Anything else the reviewer should know, such as "No login is required." */
  readonly notes?: string;
};

/** Age rating, categories, price, and review contact for one app. */
export type ReleaseAttributesConfig = {
  /** Answers to Apple's age-rating questions, keyed by Apple's question id */
  readonly ageRating?: Record<string, string | boolean>;
  /** Primary and secondary App Store categories. */
  readonly categories?: ReleaseCategories;
  /** Price of the app itself. */
  readonly pricing?: ReleasePricing;
  /** Contact and demo account for App Review. */
  readonly reviewDetails?: ReviewDetailsConfig;
};

/** Paths to the JSON files for store surfaces that have no inline block in launch.config.ts. */
export type SurfaceConfigFiles = {
  /** Territories the app is sold in. */
  readonly availability?: string;
  /** Apple's accessibility nutrition labels. */
  readonly accessibility?: string;
  /** Product-page A/B tests (icon, screenshots, or text). */
  readonly experiments?: string;
  /** Extra App Store product pages, each with its own link. */
  readonly customPages?: string;
};
