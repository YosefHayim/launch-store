/**
 * Store-surface config sections: release attributes, Game Center, App Clips, EU distribution,
 * Wallet, MCP capabilities, and release/notify policy.
 *
 * Shapes match the Effect Schema SSOT in `src/core/config/schema.ts` (ADR 0013).
 */

import {
  APP_CLIP_ACTIONS,
  LEADERBOARD_FORMATTERS,
  LEADERBOARD_SORT_TYPES,
  LEADERBOARD_SUBMISSION_TYPES,
} from '../../apple/ascResources.js';

/** How an approved iOS build reaches the public App Store. */
export type ReleaseType = 'AFTER_APPROVAL' | 'MANUAL' | 'SCHEDULED';

/** iOS public-release policy under `LaunchConfig.release`. */
export interface ReleaseConfig {
  releaseType?: ReleaseType;
  earliestReleaseDate?: string;
  phasedRelease?: boolean;
  usesNonExemptEncryption?: boolean;
  releaseNotes?: string | Record<string, string>;
  primaryLocale?: string;
}

/** Transition notifications under `LaunchConfig.notify`. */
export interface NotifyConfig {
  webhookUrl?: string;
  command?: string;
  events?: Array<'build' | 'submit' | 'review' | 'rollout'>;
}

/** One Game Center achievement declaration. */
export interface AchievementConfig {
  vendorIdentifier: string;
  referenceName: string;
  points: number;
  showBeforeEarned?: boolean;
  repeatable?: boolean;
  name: string;
  beforeEarnedDescription: string;
  afterEarnedDescription: string;
  locale?: string;
}

/** One Game Center leaderboard declaration. */
export interface LeaderboardConfig {
  vendorIdentifier: string;
  referenceName: string;
  defaultFormatter: (typeof LEADERBOARD_FORMATTERS)[number];
  submissionType: (typeof LEADERBOARD_SUBMISSION_TYPES)[number];
  scoreSortType: (typeof LEADERBOARD_SORT_TYPES)[number];
  name: string;
  locale?: string;
}

/** Game Center achievements & leaderboards for one app. */
export interface GameCenterConfig {
  achievements?: AchievementConfig[];
  leaderboards?: LeaderboardConfig[];
}

/** One locale of an App Clip card. */
export interface AppClipLocalizationConfig {
  subtitle: string;
}

/** One App Clip's card metadata. */
export interface AppClipConfig {
  action?: (typeof APP_CLIP_ACTIONS)[number];
  localizations?: Record<string, AppClipLocalizationConfig>;
}

/** An app's App Clips, keyed by clip bundle id. */
export interface AppClipsConfig {
  clips: Record<string, AppClipConfig>;
}

/** One authorized EU distribution domain. */
export interface EuDistributionDomainConfig {
  domain: string;
  referenceName: string;
}

/** Team-level EU alternative-distribution domains. */
export interface EuDistributionConfig {
  domains: EuDistributionDomainConfig[];
}

/** One Apple Pay merchant id or Wallet pass type id. */
export interface WalletIdConfig {
  identifier: string;
  name: string;
}

/** Team-level Apple Pay / Wallet identifiers. */
export interface WalletConfig {
  merchantIds?: WalletIdConfig[];
  passTypeIds?: WalletIdConfig[];
}

/** Declared primary/secondary App Store categories. */
export interface ReleaseCategories {
  primary?: string;
  secondary?: string;
}

/** Declared base price for release attributes. */
export interface ReleasePricing {
  baseTerritory?: string;
  customerPrice: number;
}

/** Declared App Review contact / demo details. */
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
 * App Store release attributes (age rating, categories, price, review details).
 * Distinct from {@link ReleaseConfig} (when/how a version goes live).
 */
export interface ReleaseAttributesConfig {
  ageRating?: Record<string, string | boolean>;
  categories?: ReleaseCategories;
  pricing?: ReleasePricing;
  reviewDetails?: ReviewDetailsConfig;
}

/** Non-default paths for sidecar-only `*.config.json` surfaces. */
export interface SurfaceConfigFiles {
  availability?: string;
  accessibility?: string;
  experiments?: string;
  customPages?: string;
}

/** MCP tool capability tier. */
export type McpCapability = 'read' | 'dryRun' | 'write' | 'dangerous';

/** `mcp` block of `launch.config.ts`. */
export interface McpConfig {
  capabilities?: McpCapability[];
}
