/**
 * In-app purchase & subscription catalog types: products, prices, the offer family
 * (intro / promotional / win-back / offer-code), subscription groups, and Google Play overrides —
 * everything reachable from {@link AppProducts}.
 *
 * Shapes match the Effect Schema SSOT in `src/core/config/schema.ts` (ADR 0013). Validation is not
 * performed here — these are the public TypeScript contracts for config and reconcilers.
 */

/** Apple's billing period for an auto-renewable subscription. */
export type SubscriptionPeriod =
  | 'ONE_WEEK'
  | 'ONE_MONTH'
  | 'TWO_MONTHS'
  | 'THREE_MONTHS'
  | 'SIX_MONTHS'
  | 'ONE_YEAR';

/** Kind of one-off in-app purchase (`inAppPurchasesV2`). */
export type InAppPurchaseType = 'CONSUMABLE' | 'NON_CONSUMABLE' | 'NON_RENEWING_SUBSCRIPTION';

/** Who an offer may target (`customerEligibilities`). */
export type OfferCustomerEligibility = 'NEW' | 'EXISTING' | 'EXPIRED';

/** Whether an offer stacks with or replaces the intro offer. */
export type OfferEligibility = 'STACK_WITH_INTRO_OFFERS' | 'REPLACE_INTRO_OFFERS';

/** One offer billing unit (`SubscriptionOfferDuration`). */
export type OfferDuration =
  | 'THREE_DAYS'
  | 'ONE_WEEK'
  | 'TWO_WEEKS'
  | 'ONE_MONTH'
  | 'TWO_MONTHS'
  | 'THREE_MONTHS'
  | 'SIX_MONTHS'
  | 'ONE_YEAR';

/** How an offer discounts (`SubscriptionOfferMode`). */
export type OfferMode = 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT' | 'FREE_TRIAL';

/** One locale's customer-facing copy for a subscription or IAP. */
export interface ProductLocalization {
  locale: string;
  name: string;
  description?: string;
}

/** One locale's display name for a subscription group. */
export interface GroupLocalization {
  locale: string;
  name: string;
}

/** Product baseline price in a base territory (Apple price-point ladder). */
export interface ProductPrice {
  baseTerritory?: string;
  customerPrice: number;
}

/** One territory's discounted price for an offer. */
export interface OfferPrice {
  territory?: string;
  customerPrice: number;
}

/** Google Play price in micro-units + ISO currency. */
export interface PlayPriceConfig {
  priceMicros: string;
  currency: string;
}

/** Fields shared by price-bearing offer kinds. */
export interface OfferConfigBase {
  duration: OfferDuration;
  offerMode: OfferMode;
  numberOfPeriods: number;
  prices?: OfferPrice[];
}

/** Subscription offer-code campaign. */
export interface OfferCodeConfig extends OfferConfigBase {
  name: string;
  customerEligibilities: OfferCustomerEligibility[];
  offerEligibility: OfferEligibility;
}

/** Promotional offer. */
export interface PromotionalOfferConfig extends OfferConfigBase {
  name: string;
  offerCode: string;
}

/** Introductory offer (single price, not prices[]). */
export interface IntroductoryOfferConfig {
  duration: OfferDuration;
  offerMode: OfferMode;
  numberOfPeriods: number;
  territory?: string;
  price?: OfferPrice;
  startDate?: string;
  endDate?: string;
}

/** Win-back offer. */
export interface WinBackOfferConfig extends OfferConfigBase {
  offerId: string;
  referenceName: string;
  eligiblePaidMonths: number;
  monthsSinceLastSubscribed: { min: number; max: number };
  waitBetweenOffersMonths?: number;
  startDate: string;
  endDate?: string;
  priority?: 'HIGH' | 'NORMAL';
  promotionIntent?: 'NOT_PROMOTED' | 'USE_AUTO_GENERATED_ASSETS';
}

/** One Google Play offer on a subscription base plan. */
export interface PlaySubscriptionOfferConfig {
  offerId: string;
  freeTrialDuration?: string;
  introPrices?: Record<string, PlayPriceConfig>;
  introRecurrenceCount?: number;
}

/** Google Play overrides for a subscription. */
export interface PlaySubscriptionOverride {
  productId?: string;
  basePlanId?: string;
  prices: Record<string, PlayPriceConfig>;
  offers?: PlaySubscriptionOfferConfig[];
}

/** One auto-renewable subscription product inside a group. */
export interface SubscriptionConfig {
  productId: string;
  referenceName: string;
  subscriptionPeriod: SubscriptionPeriod;
  localizations: ProductLocalization[];
  price?: ProductPrice;
  offerCodes?: OfferCodeConfig[];
  promotionalOffers?: PromotionalOfferConfig[];
  introductoryOffers?: IntroductoryOfferConfig[];
  winBackOffers?: WinBackOfferConfig[];
  reviewScreenshot?: string;
  play?: PlaySubscriptionOverride;
}

/** Subscription group (mutually exclusive levels). */
export interface SubscriptionGroupConfig {
  referenceName: string;
  localizations: GroupLocalization[];
  subscriptions: SubscriptionConfig[];
}

/** Google Play overrides for a one-off IAP. */
export interface PlayProductOverride {
  sku?: string;
  defaultPrice?: PlayPriceConfig;
  prices?: Record<string, PlayPriceConfig>;
}

/** Non-subscription in-app purchase. */
export interface InAppPurchaseConfig {
  productId: string;
  referenceName: string;
  type: InAppPurchaseType;
  localizations: ProductLocalization[];
  price?: ProductPrice;
  play?: PlayProductOverride;
}

/** Promoted purchase on the App Store product page. */
export interface PromotedPurchaseConfig {
  productId: string;
  visibleForAllUsers?: boolean;
  enabled?: boolean;
}

/** Declarative product catalog for one app (keyed under `LaunchConfig.products`). */
export interface AppProducts {
  subscriptionGroups?: SubscriptionGroupConfig[];
  inAppPurchases?: InAppPurchaseConfig[];
  promotedPurchases?: PromotedPurchaseConfig[];
}
