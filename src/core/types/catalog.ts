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
export type ProductLocalization = Readonly<{
  locale: string;
  name: string;
  description?: string;
}>;
/** One locale's display name for a subscription group. */
export type GroupLocalization = Readonly<{
  locale: string;
  name: string;
}>;
/** Product baseline price in a base territory (Apple price-point ladder). */
export type ProductPrice = Readonly<{
  baseTerritory?: string;
  customerPrice: number;
}>;
/** One territory's discounted price for an offer. */
export type OfferPrice = Readonly<{
  territory?: string;
  customerPrice: number;
}>;
/** Google Play price in micro-units + ISO currency. */
export type PlayPriceConfig = Readonly<{
  priceMicros: string;
  currency: string;
}>;
/** Fields shared by price-bearing offer kinds. */
export type OfferConfigBase = Readonly<{
  duration: OfferDuration;
  offerMode: OfferMode;
  numberOfPeriods: number;
  prices?: readonly OfferPrice[];
}>;
/** Subscription offer-code campaign. */
export type OfferCodeConfig = OfferConfigBase &
  Readonly<{
    name: string;
    customerEligibilities: readonly OfferCustomerEligibility[];
    offerEligibility: OfferEligibility;
  }>;
/** Promotional offer. */
export type PromotionalOfferConfig = OfferConfigBase &
  Readonly<{
    name: string;
    offerCode: string;
  }>;
/** Introductory offer (single price, not prices[]). */
export type IntroductoryOfferConfig = Readonly<{
  duration: OfferDuration;
  offerMode: OfferMode;
  numberOfPeriods: number;
  territory?: string;
  price?: OfferPrice;
  startDate?: string;
  endDate?: string;
}>;
/** Win-back offer. */
export type WinBackOfferConfig = OfferConfigBase &
  Readonly<{
    offerId: string;
    referenceName: string;
    eligiblePaidMonths: number;
    monthsSinceLastSubscribed: Readonly<{
      min: number;
      max: number;
    }>;
    waitBetweenOffersMonths?: number;
    startDate: string;
    endDate?: string;
    priority?: 'HIGH' | 'NORMAL';
    promotionIntent?: 'NOT_PROMOTED' | 'USE_AUTO_GENERATED_ASSETS';
  }>;
/** One Google Play offer on a subscription base plan. */
export type PlaySubscriptionOfferConfig = Readonly<{
  offerId: string;
  freeTrialDuration?: string;
  introPrices?: Record<string, PlayPriceConfig>;
  introRecurrenceCount?: number;
}>;
/** Google Play overrides for a subscription. */
export type PlaySubscriptionOverride = Readonly<{
  productId?: string;
  basePlanId?: string;
  prices: Record<string, PlayPriceConfig>;
  offers?: readonly PlaySubscriptionOfferConfig[];
}>;
/** One auto-renewable subscription product inside a group. */
export type SubscriptionConfig = Readonly<{
  productId: string;
  referenceName: string;
  subscriptionPeriod: SubscriptionPeriod;
  localizations: readonly ProductLocalization[];
  price?: ProductPrice;
  offerCodes?: readonly OfferCodeConfig[];
  promotionalOffers?: readonly PromotionalOfferConfig[];
  introductoryOffers?: readonly IntroductoryOfferConfig[];
  winBackOffers?: readonly WinBackOfferConfig[];
  reviewScreenshot?: string;
  play?: PlaySubscriptionOverride;
}>;
/** Subscription group (mutually exclusive levels). */
export type SubscriptionGroupConfig = Readonly<{
  referenceName: string;
  localizations: readonly GroupLocalization[];
  subscriptions: readonly SubscriptionConfig[];
}>;
/** Google Play overrides for a one-off IAP. */
export type PlayProductOverride = Readonly<{
  sku?: string;
  defaultPrice?: PlayPriceConfig;
  prices?: Record<string, PlayPriceConfig>;
}>;
/** Non-subscription in-app purchase. */
export type InAppPurchaseConfig = Readonly<{
  productId: string;
  referenceName: string;
  type: InAppPurchaseType;
  localizations: readonly ProductLocalization[];
  price?: ProductPrice;
  play?: PlayProductOverride;
}>;
/** Promoted purchase on the App Store product page. */
export type PromotedPurchaseConfig = Readonly<{
  productId: string;
  visibleForAllUsers?: boolean;
  enabled?: boolean;
}>;
/** Declarative product catalog for one app (keyed under `LaunchConfig.products`). */
export type AppProducts = Readonly<{
  subscriptionGroups?: readonly SubscriptionGroupConfig[];
  inAppPurchases?: readonly InAppPurchaseConfig[];
  promotedPurchases?: readonly PromotedPurchaseConfig[];
}>;
