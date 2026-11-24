// Holds in-app purchase and subscription settings Launch keeps for both stores.

import type { components } from './apple/apple-api-types.ts';

/** How often an auto-renewable subscription bills. */
export type SubscriptionPeriod =
  | 'ONE_WEEK'
  | 'ONE_MONTH'
  | 'TWO_MONTHS'
  | 'THREE_MONTHS'
  | 'SIX_MONTHS'
  | 'ONE_YEAR';

/** Kind of one-off in-app purchase. */
export type InAppPurchaseType = components['schemas']['InAppPurchaseType'];

/** Who may redeem an offer code. */
export type OfferCustomerEligibility = components['schemas']['SubscriptionCustomerEligibility'];

/** What happens to the introductory offer when this offer is redeemed. */
export type OfferEligibility = components['schemas']['SubscriptionOfferEligibility'];

/** How long one period of an offer lasts. */
export type OfferDuration = components['schemas']['SubscriptionOfferDuration'];

/** How an offer charges. */
export type OfferMode = components['schemas']['SubscriptionOfferMode'];

/** The name and description customers see for one product, in one language. */
export type ProductLocalization = {
  /** App Store language code, such as `en-US`. */
  readonly locale: string;
  /** Name shown on the store. */
  readonly name: string;
  /** Short description shown on the store. */
  readonly description?: string;
};

/** The name customers see for a subscription group, in one language. A group has no description. */
export type GroupLocalization = {
  /** App Store language code, such as `en-US`. */
  readonly locale: string;
  /** Name of the group, shown where the subscription levels are listed together. */
  readonly name: string;
};

/** The everyday price of a product on the App Store. */
export type ProductPrice = {
  /** Territory whose price ladder is used, such as `USA`. */
  readonly baseTerritory?: string;
  /** Price the customer pays in that territory, such as `4.99`. */
  readonly customerPrice: number;
};

/** The discounted price of an offer in one territory. Same ladder rule as the product price. */
export type OfferPrice = {
  /** Territory this discount applies to, such as `USA`. */
  readonly territory?: string;
  /** Discounted price the customer pays, such as `0.99`. */
  readonly customerPrice: number;
};

/** A Google Play price. */
export type PlayPriceConfig = {
  /** Price in millionths of the currency unit. */
  readonly priceMicros: string;
  /** ISO currency code, such as `USD`. */
  readonly currency: string;
};

/** The length and discount shared by Apple offer codes, promotional offers, and win-back offers. */
type OfferConfigBase = {
  /** Length of one billing period of the offer, such as `ONE_WEEK` or `ONE_MONTH`. */
  readonly duration: OfferDuration;
  /** How the customer is charged during the offer. */
  readonly offerMode: OfferMode;
  /** How many `duration` periods the offer lasts. */
  readonly numberOfPeriods: number;
  /** Discounted price in each territory. */
  readonly prices?: readonly OfferPrice[];
};

/** A code a customer can redeem for a subscription discount. */
export type OfferCodeConfig = OfferConfigBase & {
  /** Name of the campaign in App Store Connect. */
  readonly name: string;
  /** Who may redeem the code: new subscribers, current ones, lapsed ones, or a combination. */
  readonly customerEligibilities: readonly OfferCustomerEligibility[];
  /** Whether redeeming the code keeps the introductory offer or replaces it. */
  readonly offerEligibility: OfferEligibility;
};

/** A discount your app offers in StoreKit to someone who already subscribed or who lapsed. */
export type PromotionalOfferConfig = OfferConfigBase & {
  /** Name shown only in App Store Connect. */
  readonly name: string;
  /** Id the app sends to StoreKit. */
  readonly offerCode: string;
};

/** The automatic first-time discount on a subscription. */
export type IntroductoryOfferConfig = {
  /** Length of one period, such as `ONE_WEEK`. */
  readonly duration: OfferDuration;
  /** How the customer is charged. */
  readonly offerMode: OfferMode;
  /** How many `duration` periods the offer lasts. */
  readonly numberOfPeriods: number;
  /** Territory this intro offer applies to. */
  readonly territory?: string;
  /** Discounted price. */
  readonly price?: OfferPrice;
  /** First day the offer is available, as `YYYY-MM-DD`. */
  readonly startDate?: string;
  /** Last day the offer is available, as `YYYY-MM-DD`. */
  readonly endDate?: string;
};

/** A discount Apple shows on the App Store to someone who used to subscribe and stopped. */
export type WinBackOfferConfig = OfferConfigBase & {
  /** Stable id, unique in the app. */
  readonly offerId: string;
  /** Name shown only in App Store Connect. */
  readonly referenceName: string;
  /** Fewest months the customer must have paid before they qualify. */
  readonly eligiblePaidMonths: number;
  /** How long ago they must have stopped, in months. */
  readonly monthsSinceLastSubscribed: {
    /** Fewest months since the subscription ended. */
    readonly min: number;
    /** Most months since the subscription ended. */
    readonly max: number;
  };
  /** Months to wait before showing this customer another win-back offer. */
  readonly waitBetweenOffersMonths?: number;
  /** First day the offer can be shown, as `YYYY-MM-DD`. */
  readonly startDate: string;
  /** Last day the offer can be shown, as `YYYY-MM-DD`. */
  readonly endDate?: string;
  /** Which win-back offer Apple prefers when more than one fits. */
  readonly priority?: 'HIGH' | 'NORMAL';
  /** Whether Apple draws the promotional art. */
  readonly promotionIntent?: 'NOT_PROMOTED' | 'USE_AUTO_GENERATED_ASSETS';
};

/** A free trial or introductory price on a Play subscription base plan. */
export type PlaySubscriptionOfferConfig = {
  /** Id of the offer, unique on this base plan. */
  readonly offerId: string;
  /** Free-trial length as an ISO-8601 duration, such as `P7D` for 7 days or `P1M` for one month. */
  readonly freeTrialDuration?: string;
  /** Introductory price in each Play region, such as `{ US */
  readonly introPrices?: Record<string, PlayPriceConfig>;
  /** How many billing periods the introductory price lasts. */
  readonly introRecurrenceCount?: number;
};

/** The Google Play copy of a subscription. */
export type PlaySubscriptionOverride = {
  /** Play product id. */
  readonly productId?: string;
  /** Id of the base plan inside that product, such as `monthly`. */
  readonly basePlanId?: string;
  /** Price in each Play region. */
  readonly prices: Record<string, PlayPriceConfig>;
  /** Free trials and introductory prices on that base plan. */
  readonly offers?: readonly PlaySubscriptionOfferConfig[];
};

/** One auto-renewable subscription inside a group, such as Pro Monthly. */
export type SubscriptionConfig = {
  /** Apple product id, such as `com.acme.pro_monthly`. */
  readonly productId: string;
  /** Name shown only in App Store Connect. */
  readonly referenceName: string;
  /** How often it bills. */
  readonly subscriptionPeriod: SubscriptionPeriod;
  /** Store text in each language. */
  readonly localizations: readonly ProductLocalization[];
  /** Everyday price. */
  readonly price?: ProductPrice;
  /** Redeemable offer-code campaigns. */
  readonly offerCodes?: readonly OfferCodeConfig[];
  /** Discounts the app presents in StoreKit. */
  readonly promotionalOffers?: readonly PromotionalOfferConfig[];
  /** Automatic first-time discounts. */
  readonly introductoryOffers?: readonly IntroductoryOfferConfig[];
  /** Discounts Apple shows to lapsed subscribers. */
  readonly winBackOffers?: readonly WinBackOfferConfig[];
  /** Path to the review screenshot Apple requires before this subscription can be submitted. */
  readonly reviewScreenshot?: string;
  /** Google Play product, prices, and offers for this same subscription. */
  readonly play?: PlaySubscriptionOverride;
};

/** A set of subscriptions where the customer can hold only one at a time */
export type SubscriptionGroupConfig = {
  /** Name shown only in App Store Connect. */
  readonly referenceName: string;
  /** Customer-facing group name in each language. */
  readonly localizations: readonly GroupLocalization[];
  /** The subscription levels in this group. */
  readonly subscriptions: readonly SubscriptionConfig[];
};

/** The Google Play copy of a one-off in-app purchase. */
export type PlayProductOverride = {
  /** Play product id. */
  readonly sku?: string;
  /** Price used in every region that `prices` does not override. */
  readonly defaultPrice?: PlayPriceConfig;
  /** Price overrides keyed by Play region code, such as `US`. */
  readonly prices?: Record<string, PlayPriceConfig>;
};

/** A one-off in-app purchase: coins, a permanent unlock, or a subscription that does not renew. */
export type InAppPurchaseConfig = {
  /** Apple product id, such as `com.acme.coins_100`. */
  readonly productId: string;
  /** Name shown only in App Store Connect. */
  readonly referenceName: string;
  /** `CONSUMABLE` can be bought again. */
  readonly type: InAppPurchaseType;
  /** Store text in each language. */
  readonly localizations: readonly ProductLocalization[];
  /** Everyday price. */
  readonly price?: ProductPrice;
  /** Google Play product id and prices for this same purchase. */
  readonly play?: PlayProductOverride;
};

/** A product featured on the App Store product page. */
type PromotedPurchaseConfig = {
  /** Apple product id of a subscription or in-app purchase that already exists. */
  readonly productId: string;
  /** Whether every visitor sees the promotion. */
  readonly visibleForAllUsers?: boolean;
  /** Whether the promotion is turned on. */
  readonly enabled?: boolean;
};

/** Everything one app sells, under `products` keyed by the iOS bundle id. */
export type AppProducts = {
  /** Subscription groups. */
  readonly subscriptionGroups?: readonly SubscriptionGroupConfig[];
  /** One-off purchases: consumable, non-consumable, or non-renewing. */
  readonly inAppPurchases?: readonly InAppPurchaseConfig[];
  /** Products featured on the App Store product page, in the order they should appear. */
  readonly promotedPurchases?: readonly PromotedPurchaseConfig[];
};
