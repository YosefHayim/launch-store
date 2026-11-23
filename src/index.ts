// Exports the Launch config function and the config types an app imports.

export { defineConfig } from './define-launch-file.ts';
export type { BuildProfile, PlayTrack } from './types/app.ts';
export type {
  AppProducts,
  GroupLocalization,
  InAppPurchaseConfig,
  InAppPurchaseType,
  PlayPriceConfig,
  PlayProductOverride,
  PlaySubscriptionOfferConfig,
  PlaySubscriptionOverride,
  ProductLocalization,
  ProductPrice,
  SubscriptionConfig,
  SubscriptionGroupConfig,
  SubscriptionPeriod,
} from './types/catalog.ts';
export type { LaunchConfig, LaunchConfigInput } from './types/config.ts';
export type {
  AchievementConfig,
  AppClipConfig,
  AppClipLocalizationConfig,
  AppClipsConfig,
  EuDistributionConfig,
  EuDistributionDomainConfig,
  GameCenterConfig,
  LeaderboardConfig,
  ReleaseAttributesConfig,
  ReleaseCategories,
  ReleaseConfig,
  ReleasePricing,
  ReleaseType,
  ReviewDetailsConfig,
  WalletConfig,
  WalletIdConfig,
} from './types/store-surface.ts';
