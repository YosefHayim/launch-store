/**
 * In-app purchase & subscription catalog: products, prices, the offer family
 * (intro / promotional / win-back / offer-code), subscription groups, and the Google Play overrides —
 * everything reachable from {@link AppProducts}.
 */

/**
 * Apple's billing period for an auto-renewable subscription — the `subscriptionPeriod` enum the App
 * Store Connect API expects on a `subscriptions` resource. There is no "lifetime" period; a one-off
 * unlock is an {@link InAppPurchaseConfig} of type `NON_CONSUMABLE`, not a subscription.
 */
export type SubscriptionPeriod = "ONE_WEEK" | "ONE_MONTH" | "TWO_MONTHS" | "THREE_MONTHS" | "SIX_MONTHS" | "ONE_YEAR";

/**
 * The kind of one-off in-app purchase, mirroring Apple's `inAppPurchaseType` on `inAppPurchasesV2`.
 * Auto-renewable subscriptions are deliberately NOT here — they live under {@link SubscriptionGroupConfig}
 * because Apple models them as a distinct resource with group-level mutual exclusivity.
 */
export type InAppPurchaseType = "CONSUMABLE" | "NON_CONSUMABLE" | "NON_RENEWING_SUBSCRIPTION";

/**
 * One locale's customer-facing copy for a subscription or in-app purchase — the display name (and
 * optional description) shown on the product page. Apple keeps a product in "Missing Metadata" until
 * it has at least one localization, so the reconciler rejects an empty list rather than silently
 * creating an unsubmittable product. The `locale` is the natural key the reconciler matches on.
 */
export interface ProductLocalization {
  /** App Store locale code, e.g. `en-US`. */
  locale: string;
  /** Customer-facing display name (Apple limit: 30 characters). */
  name: string;
  /** Customer-facing description (Apple limit: 45 characters). Omitted when not provided. */
  description?: string;
}

/**
 * One locale's display name for a subscription GROUP. Groups carry only a name (no description); it's
 * shown at the point of purchase grouping the subscription levels. Without one, every subscription in
 * the group is stuck in "Missing Metadata", so at least one is required per group.
 */
export interface GroupLocalization {
  /** App Store locale code, e.g. `en-US`. */
  locale: string;
  /** Customer-facing group name. */
  name: string;
}

/**
 * A product's baseline price, expressed as the customer-facing amount in a base territory.
 *
 * Apple does not accept arbitrary numbers — every price is one of a fixed ladder of *price points*.
 * The reconciler resolves this declaration to the price point whose `customerPrice` equals
 * {@link ProductPrice.customerPrice} in {@link ProductPrice.baseTerritory}, erroring (with the nearby
 * points listed) when none matches exactly, then anchors the other territories off it — the same model
 * the App Store Connect UI uses. A product with no price can never be submitted, so omit this only
 * when you intend to set the price by hand in the UI.
 */
export interface ProductPrice {
  /** Base territory whose price point is matched, e.g. `USA`. Defaults to `USA`. */
  baseTerritory?: string;
  /** Exact customer-facing price in the base territory's currency, e.g. `9.99`. Must equal an Apple price point. */
  customerPrice: number;
}

/**
 * Who an offer is allowed to target, mirroring Apple's `customerEligibilities`: `NEW` (never
 * subscribed), `EXISTING` (currently subscribed), `EXPIRED` (previously subscribed, now lapsed).
 */
export type OfferCustomerEligibility = "NEW" | "EXISTING" | "EXPIRED";

/**
 * Whether an offer stacks with or replaces the subscription's introductory offer
 * (Apple's `offerEligibility` on offer codes). `REPLACE_INTRO_OFFERS` is the common choice.
 */
export type OfferEligibility = "STACK_WITH_INTRO_OFFERS" | "REPLACE_INTRO_OFFERS";

/**
 * One offer billing unit, mirroring Apple's `SubscriptionOfferDuration`. The offer lasts
 * {@link OfferConfigBase.numberOfPeriods} × this duration.
 */
export type OfferDuration =
  | "THREE_DAYS"
  | "ONE_WEEK"
  | "TWO_WEEKS"
  | "ONE_MONTH"
  | "TWO_MONTHS"
  | "THREE_MONTHS"
  | "SIX_MONTHS"
  | "ONE_YEAR";

/**
 * How an offer discounts, mirroring Apple's `SubscriptionOfferMode`: `PAY_AS_YOU_GO` (a reduced price
 * each period), `PAY_UP_FRONT` (one reduced price for the whole span), or `FREE_TRIAL` (no charge — and
 * so no {@link OfferPrice} is allowed).
 */
export type OfferMode = "PAY_AS_YOU_GO" | "PAY_UP_FRONT" | "FREE_TRIAL";

/**
 * One territory's discounted price for an offer, resolved to an Apple subscription price point exactly
 * like {@link ProductPrice} (the customer-facing amount must equal a point on Apple's fixed ladder).
 * Omit prices entirely for a `FREE_TRIAL` offer.
 */
export interface OfferPrice {
  /** Territory whose price point is matched, e.g. `USA`. Defaults to `USA`. */
  territory?: string;
  /** Exact customer-facing price in the territory's currency, e.g. `4.99`. Must equal an Apple price point. */
  customerPrice: number;
}

/**
 * Fields shared by the price-bearing offer kinds (offer codes, promotional, win-back). `numberOfPeriods`
 * is how many {@link OfferConfigBase.duration} units the offer runs; `prices` is per-territory and
 * required unless `offerMode` is `FREE_TRIAL`.
 */
export interface OfferConfigBase {
  /** Offer billing duration unit. */
  duration: OfferDuration;
  /** How the offer discounts. `FREE_TRIAL` must omit {@link OfferConfigBase.prices}. */
  offerMode: OfferMode;
  /** How many {@link OfferConfigBase.duration} units the offer spans. */
  numberOfPeriods: number;
  /** Per-territory discounted prices. Required unless `offerMode` is `FREE_TRIAL`. */
  prices?: OfferPrice[];
}

/**
 * A subscription offer-code campaign (Apple's `subscriptionOfferCodes`) — a redeemable promo that grants
 * an introductory price. `name` is the reconciler's natural key (unique per subscription); offer-code
 * terms are immutable once created, so the reconciler only ever creates a missing code, never edits one
 * (deactivation is the explicit `launch offers deactivate` action). One-time-use and custom code batches
 * are generated separately (the imperative `launch offers codes` subcommands), not declared here.
 */
export interface OfferCodeConfig extends OfferConfigBase {
  /** Campaign name shown in App Store Connect — unique per subscription; the reconciler's key. */
  name: string;
  /** Which customers may redeem the code. */
  customerEligibilities: OfferCustomerEligibility[];
  /** Whether the code stacks with or replaces the intro offer. */
  offerEligibility: OfferEligibility;
}

/**
 * A promotional offer (Apple's `subscriptionPromotionalOffers`) — a developer-presented discount
 * surfaced in-app to existing/lapsed subscribers. `offerCode` is the product-level identifier the app
 * passes to StoreKit at redemption; it is the reconciler's natural key (unique per subscription).
 */
export interface PromotionalOfferConfig extends OfferConfigBase {
  /** Internal name shown in App Store Connect. */
  name: string;
  /** Product-level offer identifier the app references in StoreKit — the reconciler's key. */
  offerCode: string;
}

/**
 * An introductory offer (Apple's `subscriptionIntroductoryOffers`) — the one auto-applied first-time
 * discount. Apple allows at most one per (subscription, territory); when `territory` is omitted it
 * applies to all territories the subscription is sold in. `territory` is the reconciler's natural key.
 */
export interface IntroductoryOfferConfig {
  /** Billing duration unit. */
  duration: OfferDuration;
  /** How the offer discounts. `FREE_TRIAL` must omit {@link IntroductoryOfferConfig.price}. */
  offerMode: OfferMode;
  /** How many `duration` units the offer spans. */
  numberOfPeriods: number;
  /** Territory this intro offer applies to (the reconciler's key); omit for all territories. */
  territory?: string;
  /** The discounted price in {@link IntroductoryOfferConfig.territory}. Required unless `FREE_TRIAL`. */
  price?: OfferPrice;
  /** ISO date (`YYYY-MM-DD`) the offer starts; omit to start immediately. */
  startDate?: string;
  /** ISO date (`YYYY-MM-DD`) the offer ends; omit for no end. */
  endDate?: string;
}

/**
 * A win-back offer (Apple's `winBackOffers`) — a discount shown on the App Store to lapsed subscribers,
 * gated on how long they previously paid and how long ago they churned. `offerId` is the reconciler's
 * natural key (unique within the app). Win-back offers carry no images here — promotion artwork is the
 * `promotionIntent` auto-generated path; custom artwork is a deferred follow-up.
 */
export interface WinBackOfferConfig extends OfferConfigBase {
  /** Stable offer identifier the app references — the reconciler's key (unique within the app). */
  offerId: string;
  /** Internal reference name shown in App Store Connect. */
  referenceName: string;
  /** Minimum months the customer must previously have paid to be eligible. */
  eligiblePaidMonths: number;
  /** Eligible window since the customer last subscribed, in months (inclusive `[min, max]`). */
  monthsSinceLastSubscribed: { min: number; max: number };
  /** Minimum months to wait between showing successive win-back offers; omit for Apple's default. */
  waitBetweenOffersMonths?: number;
  /** ISO date (`YYYY-MM-DD`) the offer starts. Required by Apple. */
  startDate: string;
  /** ISO date (`YYYY-MM-DD`) the offer ends; omit for no end. */
  endDate?: string;
  /** Display priority among competing win-back offers. Defaults to `NORMAL`. */
  priority?: "HIGH" | "NORMAL";
  /** Whether Apple auto-generates promotion artwork (`USE_AUTO_GENERATED_ASSETS`) or the offer isn't promoted. */
  promotionIntent?: "NOT_PROMOTED" | "USE_AUTO_GENERATED_ASSETS";
}

/**
 * One Google Play offer on a subscription's base plan — a free trial, an introductory price, or both
 * (Play allows up to two offer phases). `offerId` is the natural key the reconciler matches on. Set
 * {@link PlaySubscriptionOfferConfig.freeTrialDuration} for a free phase and/or
 * {@link PlaySubscriptionOfferConfig.introPrices} for a discounted phase; an offer with neither is
 * rejected (it would discount nothing).
 */
export interface PlaySubscriptionOfferConfig {
  /** Play offer id (unique within the base plan). */
  offerId: string;
  /** Free-trial length as an ISO-8601 duration (e.g. `P1W`, `P1M`). Omit for no trial phase. */
  freeTrialDuration?: string;
  /** Introductory per-region prices (region code → micro-units + currency). Omit for no intro phase. */
  introPrices?: Record<string, PlayPriceConfig>;
  /** How many billing periods the introductory price repeats for. Defaults to 1. */
  introRecurrenceCount?: number;
}

/**
 * Google Play overrides for a {@link SubscriptionConfig}, so one subscription declaration can drive both
 * stores. Apple models each billing period as a separate product, so Launch maps one config to one Play
 * subscription with a single auto-renewing **base plan** whose billing period is derived from
 * {@link SubscriptionConfig.subscriptionPeriod}. Listings come from the shared localizations; pricing is
 * declared HERE (Play's per-region `units`+`nanos` money diverges from Apple's price points — see
 * {@link PlayPriceConfig}). Present this object to publish the subscription to Play via
 * `launch play-subscriptions`; omit it to keep the subscription Apple-only.
 */
export interface PlaySubscriptionOverride {
  /** Play subscription product id; defaults to the shared {@link SubscriptionConfig.productId}. */
  productId?: string;
  /** Base-plan id; defaults to a slug of the billing period (e.g. `p1m`). */
  basePlanId?: string;
  /** Per-region base-plan prices (region code → micro-units + currency). At least one region required. */
  prices: Record<string, PlayPriceConfig>;
  /** Offers (free trials / introductory pricing) to ensure exist on the base plan. */
  offers?: PlaySubscriptionOfferConfig[];
}

/**
 * One auto-renewable subscription product inside a {@link SubscriptionGroupConfig}. `productId` is the
 * globally-unique Apple product id the app references at runtime and the reconciler's natural key. Add a
 * {@link PlaySubscriptionOverride} under `play` to also publish it to Google Play.
 */
export interface SubscriptionConfig {
  /** Apple product id, e.g. `com.acme.pro.monthly`. Globally unique; the reconciler matches on it. */
  productId: string;
  /** Internal reference name shown only in App Store Connect (Apple limit: 64 characters). */
  referenceName: string;
  /** Billing period for this level. */
  subscriptionPeriod: SubscriptionPeriod;
  /** Per-locale display copy; at least one entry is required for a submittable product. */
  localizations: ProductLocalization[];
  /** Baseline price. Omit only to price manually in the UI. */
  price?: ProductPrice;
  /** Offer-code campaigns to ensure exist on this subscription (`launch offers`). */
  offerCodes?: OfferCodeConfig[];
  /** Promotional offers to ensure exist on this subscription. */
  promotionalOffers?: PromotionalOfferConfig[];
  /** Introductory offers (at most one per territory) to ensure exist on this subscription. */
  introductoryOffers?: IntroductoryOfferConfig[];
  /** Win-back offers to ensure exist on this subscription. */
  winBackOffers?: WinBackOfferConfig[];
  /**
   * Path (relative to the app directory) to this subscription's **App Review screenshot** — the image
   * Apple requires before a subscription can be submitted. `launch sync` uploads it via the reservation
   * flow, idempotently: it's skipped when the live screenshot's MD5 already matches the local file. Omit
   * to attach it by hand in App Store Connect. Reconciled in `core/ascScreenshots.ts`, not here.
   */
  reviewScreenshot?: string;
  /** Google Play overrides; present this to also publish the subscription to Play (see {@link PlaySubscriptionOverride}). */
  play?: PlaySubscriptionOverride;
}

/**
 * A subscription group — Apple's container for mutually-exclusive subscription levels (a customer holds
 * at most one active subscription per group). `referenceName` is unique within the app and is the
 * reconciler's natural key for the group.
 */
export interface SubscriptionGroupConfig {
  /** Internal reference name (unique within the app) — the reconciler's natural key for the group. */
  referenceName: string;
  /** Per-locale group display name; at least one entry is required (else the group's subs stay unsubmittable). */
  localizations: GroupLocalization[];
  /** The subscription levels in this group. */
  subscriptions: SubscriptionConfig[];
}

/**
 * A Google Play price: an exact amount in a currency's micro-units (millionths) plus the ISO currency
 * code. Play has no price-point ladder — `"1990000"` with currency `"USD"` is $1.99. Used for both a
 * product's default price and any per-region overrides. Kept distinct from {@link ProductPrice} because
 * the two stores model money differently (Apple resolves a fixed price point; Play takes a literal
 * micro-unit amount), so a single shared price field can't serve both.
 */
export interface PlayPriceConfig {
  /** Amount in micro-units: 1,000,000 = one whole unit of `currency`. */
  priceMicros: string;
  /** ISO 4217 currency code, e.g. `USD`. */
  currency: string;
}

/**
 * Google Play overrides for an {@link InAppPurchaseConfig}, so one product declaration can drive both
 * stores. The shared fields are reused for Play — `productId` becomes the Play SKU (override via
 * {@link PlayProductOverride.sku}) and each {@link ProductLocalization} becomes a Play listing
 * (`name` → title, `description` → description), with the first localization's locale as the product's
 * default language. Pricing is declared HERE rather than reused from {@link InAppPurchaseConfig.price}
 * because the two stores' money models don't line up (see {@link PlayPriceConfig}). Present this object
 * to publish the product to Play via `launch play-products` as an active managed product; omit it to
 * keep the product Apple-only.
 */
export interface PlayProductOverride {
  /** Play SKU; defaults to the shared {@link InAppPurchaseConfig.productId} when omitted. */
  sku?: string;
  /** Default price applied to every region without an explicit {@link PlayProductOverride.prices} entry. */
  defaultPrice?: PlayPriceConfig;
  /** Per-region price overrides keyed by ISO region code (e.g. `US`). */
  prices?: Record<string, PlayPriceConfig>;
}

/**
 * One non-subscription in-app purchase (consumable, non-consumable, or non-renewing subscription).
 * `productId` is the globally-unique Apple product id and the reconciler's natural key. Add a
 * {@link PlayProductOverride} under `play` to also publish it to Google Play.
 */
export interface InAppPurchaseConfig {
  /** Apple product id, e.g. `com.acme.coins.100`. Globally unique; the reconciler matches on it. */
  productId: string;
  /** Internal reference name shown only in App Store Connect. */
  referenceName: string;
  /** The purchase kind. */
  type: InAppPurchaseType;
  /** Per-locale display copy; at least one entry is required for a submittable product. */
  localizations: ProductLocalization[];
  /** Baseline price. Omit only to price manually in the UI. */
  price?: ProductPrice;
  /** Google Play overrides; present this to also publish the product to Play (see {@link PlayProductOverride}). */
  play?: PlayProductOverride;
}

/**
 * One promoted purchase (Apple's `promotedPurchases`) — an IAP or subscription surfaced on the app's
 * App Store product page. Declaration order in {@link AppProducts.promotedPurchases} is the display
 * order Apple shows; `launch offers` reorders the live list to match. `productId` references an existing
 * subscription or in-app purchase; the reconciler resolves it to the live resource.
 */
export interface PromotedPurchaseConfig {
  /** Apple product id of the subscription or in-app purchase to promote. */
  productId: string;
  /** Whether the promotion is visible to all users (vs. targeted via the API). Defaults to `true`. */
  visibleForAllUsers?: boolean;
  /** Whether the promotion is enabled. Defaults to `true`. */
  enabled?: boolean;
}

/**
 * The declarative App Store Connect product catalog for ONE app, keyed by iOS bundle id under
 * {@link LaunchConfig.products}. `launch sync` reconciles the live account to match this: it creates
 * missing groups/subscriptions/IAPs, fills in localizations, and sets prices. `launch offers` reconciles
 * the subscription offers nested under {@link SubscriptionGroupConfig} and the
 * {@link AppProducts.promotedPurchases} ordering. All fields are optional so an app can sell only
 * subscriptions, only one-off purchases, or (with none set) nothing.
 */
export interface AppProducts {
  /** Auto-renewable subscription groups and the subscriptions within them. */
  subscriptionGroups?: SubscriptionGroupConfig[];
  /** One-off in-app purchases. */
  inAppPurchases?: InAppPurchaseConfig[];
  /** Promoted purchases in product-page display order (`launch offers` reorders the live list to match). */
  promotedPurchases?: PromotedPurchaseConfig[];
}
