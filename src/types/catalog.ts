import type { components } from '../apple-api-types.ts';

/**
 * How often an auto-renewable subscription bills.
 * `ONE_WEEK` and `ONE_MONTH` are the usual ones. `ONE_YEAR` is annual.
 */
export type SubscriptionPeriod =
  | 'ONE_WEEK'
  | 'ONE_MONTH'
  | 'TWO_MONTHS'
  | 'THREE_MONTHS'
  | 'SIX_MONTHS'
  | 'ONE_YEAR';
/**
 * Kind of one-off in-app purchase.
 * `CONSUMABLE` can be bought again, such as coins. `NON_CONSUMABLE` is bought once, such as a permanent unlock.
 * `NON_RENEWING_SUBSCRIPTION` expires and does not renew by itself.
 */
export type InAppPurchaseType = components['schemas']['InAppPurchaseType'];
/**
 * Who may redeem an offer code.
 * `NEW` has never subscribed. `EXISTING` is subscribed now. `EXPIRED` subscribed before and stopped.
 */
export type OfferCustomerEligibility = components['schemas']['SubscriptionCustomerEligibility'];
/**
 * What happens to the introductory offer when this offer is redeemed.
 * `STACK_WITH_INTRO_OFFERS` keeps the intro offer. `REPLACE_INTRO_OFFERS` takes its place.
 */
export type OfferEligibility = components['schemas']['SubscriptionOfferEligibility'];
/**
 * How long one period of an offer lasts.
 * `FREE_TRIAL` of `ONE_WEEK` with `numberOfPeriods: 1` is a one-week trial.
 */
export type OfferDuration = components['schemas']['SubscriptionOfferDuration'];
/**
 * How an offer charges.
 * `FREE_TRIAL` charges nothing and must not include a price.
 * `PAY_AS_YOU_GO` charges the discounted price each period. `PAY_UP_FRONT` charges once for the whole offer.
 */
export type OfferMode = components['schemas']['SubscriptionOfferMode'];
/** The name and description customers see for one product, in one language. */
export type ProductLocalization = {
  /**
   * App Store language code, such as `en-US`.
   */
  readonly locale: string;
  /**
   * Name shown on the store. Apple allows 30 characters.
   */
  readonly name: string;
  /**
   * Short description shown on the store. Apple allows 45 characters.
   * Leave it out to publish the name only.
   */
  readonly description?: string;
};
/** The name customers see for a subscription group, in one language. A group has no description. */
export type GroupLocalization = {
  /**
   * App Store language code, such as `en-US`.
   */
  readonly locale: string;
  /**
   * Name of the group, shown where the subscription levels are listed together.
   */
  readonly name: string;
};
/**
 * The everyday price of a product on the App Store.
 * Apple does not take an arbitrary amount. `customerPrice` must be a rung on Apple's price ladder, such as `0.99` or `4.99`.
 */
export type ProductPrice = {
  /**
   * Territory whose price ladder is used, such as `USA`. The default is `USA`.
   * Apple sets the other territories from this one.
   */
  readonly baseTerritory?: string;
  /**
   * Price the customer pays in that territory, such as `4.99`.
   */
  readonly customerPrice: number;
};
/** The discounted price of an offer in one territory. Same ladder rule as the product price. */
export type OfferPrice = {
  /**
   * Territory this discount applies to, such as `USA`. The default is `USA`.
   */
  readonly territory?: string;
  /**
   * Discounted price the customer pays, such as `0.99`. It must be a rung on Apple's price ladder.
   */
  readonly customerPrice: number;
};
/**
 * A Google Play price. Play takes an exact amount, not a ladder.
 * `priceMicros: "990000"` and `currency: "USD"` is $0.99. One million micros is one unit of the currency.
 */
export type PlayPriceConfig = {
  /**
   * Price in millionths of the currency unit. `"990000"` with `USD` is $0.99. The quotes are required: this is text, not a number.
   */
  readonly priceMicros: string;
  /**
   * ISO currency code, such as `USD`.
   */
  readonly currency: string;
};
/** The length and discount shared by Apple offer codes, promotional offers, and win-back offers. */
type OfferConfigBase = {
  /**
   * Length of one billing period of the offer, such as `ONE_WEEK` or `ONE_MONTH`.
   */
  readonly duration: OfferDuration;
  /**
   * How the customer is charged during the offer.
   * `FREE_TRIAL` must not include `prices`. The other two modes need them.
   */
  readonly offerMode: OfferMode;
  /**
   * How many `duration` periods the offer lasts. `1` with `ONE_WEEK` is one week.
   */
  readonly numberOfPeriods: number;
  /**
   * Discounted price in each territory. Required unless `offerMode` is `FREE_TRIAL`.
   */
  readonly prices?: readonly OfferPrice[];
};
/**
 * A code a customer can redeem for a subscription discount.
 * `launch offers` creates a code that does not exist yet. Apple does not let you edit a code after it is created.
 * Generating the actual code strings is `launch offers codes`, not this block.
 */
export type OfferCodeConfig = OfferConfigBase & {
  /**
   * Name of the campaign in App Store Connect. Unique for this subscription. Launch matches on it.
   */
  readonly name: string;
  /**
   * Who may redeem the code: new subscribers, current ones, lapsed ones, or a combination.
   */
  readonly customerEligibilities: readonly OfferCustomerEligibility[];
  /**
   * Whether redeeming the code keeps the introductory offer or replaces it.
   */
  readonly offerEligibility: OfferEligibility;
};
/**
 * A discount your app offers in StoreKit to someone who already subscribed or who lapsed.
 * `launch offers` creates it. The app passes `offerCode` to StoreKit when it redeems.
 */
export type PromotionalOfferConfig = OfferConfigBase & {
  /**
   * Name shown only in App Store Connect.
   */
  readonly name: string;
  /**
   * Id the app sends to StoreKit. Unique for this subscription. Launch matches on it.
   */
  readonly offerCode: string;
};
/**
 * The automatic first-time discount on a subscription. Apple allows one per territory.
 * `launch offers` creates it. A free trial omits `price`.
 */
export type IntroductoryOfferConfig = {
  /**
   * Length of one period, such as `ONE_WEEK`.
   */
  readonly duration: OfferDuration;
  /**
   * How the customer is charged. `FREE_TRIAL` must not include `price`.
   */
  readonly offerMode: OfferMode;
  /**
   * How many `duration` periods the offer lasts.
   */
  readonly numberOfPeriods: number;
  /**
   * Territory this intro offer applies to. Leave it out to apply it everywhere the subscription is sold.
   * Launch matches on this.
   */
  readonly territory?: string;
  /**
   * Discounted price. Required unless `offerMode` is `FREE_TRIAL`.
   */
  readonly price?: OfferPrice;
  /**
   * First day the offer is available, as `YYYY-MM-DD`. Leave it out to start now.
   */
  readonly startDate?: string;
  /**
   * Last day the offer is available, as `YYYY-MM-DD`. Leave it out for no end date.
   */
  readonly endDate?: string;
};
/**
 * A discount Apple shows on the App Store to someone who used to subscribe and stopped.
 * `launch offers` creates it. `offerId` is what the app and Launch both match on.
 */
export type WinBackOfferConfig = OfferConfigBase & {
  /**
   * Stable id, unique in the app. Launch matches on it.
   */
  readonly offerId: string;
  /**
   * Name shown only in App Store Connect.
   */
  readonly referenceName: string;
  /**
   * Fewest months the customer must have paid before they qualify.
   */
  readonly eligiblePaidMonths: number;
  /**
   * How long ago they must have stopped, in months. Both ends count.
   * `min: 1` and `max: 6` means they lapsed between one and six months ago.
   */
  readonly monthsSinceLastSubscribed: {
    /**
     * Fewest months since the subscription ended.
     */
    readonly min: number;
    /**
     * Most months since the subscription ended.
     */
    readonly max: number;
  };
  /**
   * Months to wait before showing this customer another win-back offer.
   * Leave it out for Apple's default gap.
   */
  readonly waitBetweenOffersMonths?: number;
  /**
   * First day the offer can be shown, as `YYYY-MM-DD`. Apple requires this.
   */
  readonly startDate: string;
  /**
   * Last day the offer can be shown, as `YYYY-MM-DD`. Leave it out for no end date.
   */
  readonly endDate?: string;
  /**
   * Which win-back offer Apple prefers when more than one fits.
   * `HIGH` is preferred over `NORMAL`. The default is `NORMAL`.
   */
  readonly priority?: 'HIGH' | 'NORMAL';
  /**
   * Whether Apple draws the promotional art.
   * `USE_AUTO_GENERATED_ASSETS` asks Apple to draw it. `NOT_PROMOTED` does not promote the offer.
   */
  readonly promotionIntent?: 'NOT_PROMOTED' | 'USE_AUTO_GENERATED_ASSETS';
};
/**
 * A discount on a Google Play subscription base plan: a free trial, an introductory price, or both.
 * `launch play-subscriptions` creates an offer whose `offerId` is not on the plan yet.
 */
export type PlaySubscriptionOfferConfig = {
  /**
   * Id of the offer, unique on this base plan. Launch matches on it.
   */
  readonly offerId: string;
  /**
   * Free-trial length as an ISO-8601 duration, such as `P7D` for 7 days or `P1M` for one month.
   * Leave it out when the offer has no free phase.
   */
  readonly freeTrialDuration?: string;
  /**
   * Introductory price in each Play region, such as `{ US: { priceMicros: "990000", currency: "USD" } }`.
   * Leave it out when the offer has no paid introductory phase.
   */
  readonly introPrices?: Record<string, PlayPriceConfig>;
  /**
   * How many billing periods the introductory price lasts. The default is 1.
   */
  readonly introRecurrenceCount?: number;
};
/**
 * The Google Play copy of a subscription. Set this when the same subscription should also exist on Play.
 * `launch play-subscriptions` writes it. The App Store fields above are unchanged.
 */
export type PlaySubscriptionOverride = {
  /**
   * Play product id. Leave it out to reuse the Apple `productId`.
   */
  readonly productId?: string;
  /**
   * Id of the base plan inside that product, such as `monthly`.
   * Leave it out and Launch derives one from the billing period.
   */
  readonly basePlanId?: string;
  /**
   * Price in each Play region. At least one region is required.
   * The key is the region code, such as `US`, not a currency.
   */
  readonly prices: Record<string, PlayPriceConfig>;
  /**
   * Free trials and introductory prices on that base plan.
   */
  readonly offers?: readonly PlaySubscriptionOfferConfig[];
};
/**
 * One auto-renewable subscription inside a group, such as Pro Monthly.
 * `productId` is what the app asks StoreKit for. `launch sync` creates it on the App Store.
 * Add `play` to also publish it on Google Play.
 */
export type SubscriptionConfig = {
  /**
   * Apple product id, such as `com.acme.pro_monthly`.
   * Letters, digits, underscores, and periods only. A hyphen is not allowed, even though a bundle id may contain one.
   * It must be unique across the whole App Store. Launch matches on it.
   */
  readonly productId: string;
  /**
   * Name shown only in App Store Connect. Apple allows 64 characters.
   */
  readonly referenceName: string;
  /**
   * How often it bills. `ONE_MONTH` is monthly. `ONE_YEAR` is annual.
   */
  readonly subscriptionPeriod: SubscriptionPeriod;
  /**
   * Store text in each language. At least one language is required, or Apple marks the product as missing metadata.
   */
  readonly localizations: readonly ProductLocalization[];
  /**
   * Everyday price. Leave it out only if you will set the price by hand in App Store Connect.
   */
  readonly price?: ProductPrice;
  /**
   * Redeemable offer-code campaigns. `launch offers` creates the ones that do not exist yet.
   */
  readonly offerCodes?: readonly OfferCodeConfig[];
  /**
   * Discounts the app presents in StoreKit. `launch offers` creates the ones that do not exist yet.
   */
  readonly promotionalOffers?: readonly PromotionalOfferConfig[];
  /**
   * Automatic first-time discounts. At most one per territory. `launch offers` creates them.
   */
  readonly introductoryOffers?: readonly IntroductoryOfferConfig[];
  /**
   * Discounts Apple shows to lapsed subscribers. `launch offers` creates them.
   */
  readonly winBackOffers?: readonly WinBackOfferConfig[];
  /**
   * Path to the review screenshot Apple requires before this subscription can be submitted.
   * Relative to the app folder. `launch sync` uploads it, and skips the upload when the file has not changed.
   * Leave it out to attach the screenshot yourself in App Store Connect.
   */
  readonly reviewScreenshot?: string;
  /**
   * Google Play product, prices, and offers for this same subscription.
   */
  readonly play?: PlaySubscriptionOverride;
};
/**
 * A set of subscriptions where the customer can hold only one at a time, such as Monthly and Yearly Pro.
 * `referenceName` is unique in the app. `launch sync` creates the group and the subscriptions inside it.
 */
export type SubscriptionGroupConfig = {
  /**
   * Name shown only in App Store Connect. Launch matches the group on this.
   */
  readonly referenceName: string;
  /**
   * Customer-facing group name in each language. At least one language is required.
   */
  readonly localizations: readonly GroupLocalization[];
  /**
   * The subscription levels in this group.
   */
  readonly subscriptions: readonly SubscriptionConfig[];
};
/**
 * The Google Play copy of a one-off in-app purchase.
 * Set this when the same product should also exist on Play. `launch play-products` writes it.
 */
export type PlayProductOverride = {
  /**
   * Play product id. Leave it out to reuse the Apple `productId`.
   */
  readonly sku?: string;
  /**
   * Price used in every region that `prices` does not override.
   */
  readonly defaultPrice?: PlayPriceConfig;
  /**
   * Price overrides keyed by Play region code, such as `US`.
   */
  readonly prices?: Record<string, PlayPriceConfig>;
};
/**
 * A one-off in-app purchase: coins, a permanent unlock, or a subscription that does not renew.
 * `launch sync` creates it on the App Store. Add `play` to also publish it on Google Play.
 */
export type InAppPurchaseConfig = {
  /**
   * Apple product id, such as `com.acme.coins_100`.
   * Letters, digits, underscores, and periods only. No hyphens.
   * It must be unique across the whole App Store. Launch matches on it.
   */
  readonly productId: string;
  /**
   * Name shown only in App Store Connect.
   */
  readonly referenceName: string;
  /**
   * `CONSUMABLE` can be bought again. `NON_CONSUMABLE` is bought once.
   * `NON_RENEWING_SUBSCRIPTION` expires and does not renew by itself.
   */
  readonly type: InAppPurchaseType;
  /**
   * Store text in each language. At least one language is required.
   */
  readonly localizations: readonly ProductLocalization[];
  /**
   * Everyday price. Leave it out only if you will set the price by hand in App Store Connect.
   */
  readonly price?: ProductPrice;
  /**
   * Google Play product id and prices for this same purchase.
   */
  readonly play?: PlayProductOverride;
};
/**
 * A product featured on the App Store product page.
 * The order of this list is the order Apple shows. `launch offers` reorders the live list to match.
 */
type PromotedPurchaseConfig = {
  /**
   * Apple product id of a subscription or in-app purchase that already exists.
   */
  readonly productId: string;
  /**
   * Whether every visitor sees the promotion. Leave it out and everyone sees it.
   */
  readonly visibleForAllUsers?: boolean;
  /**
   * Whether the promotion is turned on. Leave it out and it is on.
   */
  readonly enabled?: boolean;
};
/**
 * Everything one app sells, under `products` keyed by the iOS bundle id.
 * Leave a list out when the app does not sell that kind of thing.
 */
export type AppProducts = {
  /**
   * Subscription groups. A customer holds at most one active subscription in each group.
   */
  readonly subscriptionGroups?: readonly SubscriptionGroupConfig[];
  /**
   * One-off purchases: consumable, non-consumable, or non-renewing.
   */
  readonly inAppPurchases?: readonly InAppPurchaseConfig[];
  /**
   * Products featured on the App Store product page, in the order they should appear.
   */
  readonly promotedPurchases?: readonly PromotedPurchaseConfig[];
};
