/**
 * In-app purchase & subscription catalog: products, prices, the offer family
 * (intro / promotional / win-back / offer-code), subscription groups, and the Google Play overrides —
 * everything reachable from {@link AppProducts}. Authored config surface, so every shape is a zod schema
 * (the SSOT — see [ADR 0008](../../../docs/adr/0008-adopt-zod-config-ssot.md)) with its TypeScript type
 * inferred; the barrel re-exports the inferred types, `config.ts` composes the schemas.
 */

import { z } from 'zod';

/**
 * Apple's billing period for an auto-renewable subscription — the `subscriptionPeriod` enum the App
 * Store Connect API expects on a `subscriptions` resource. There is no "lifetime" period; a one-off
 * unlock is an {@link InAppPurchaseConfig} of type `NON_CONSUMABLE`, not a subscription.
 */
const SubscriptionPeriodSchema = z.enum([
  'ONE_WEEK',
  'ONE_MONTH',
  'TWO_MONTHS',
  'THREE_MONTHS',
  'SIX_MONTHS',
  'ONE_YEAR',
]);
export type SubscriptionPeriod = z.infer<typeof SubscriptionPeriodSchema>;

/**
 * The kind of one-off in-app purchase, mirroring Apple's `inAppPurchaseType` on `inAppPurchasesV2`.
 * Auto-renewable subscriptions are deliberately NOT here — they live under {@link SubscriptionGroupConfig}
 * because Apple models them as a distinct resource with group-level mutual exclusivity.
 */
const InAppPurchaseTypeSchema = z.enum([
  'CONSUMABLE',
  'NON_CONSUMABLE',
  'NON_RENEWING_SUBSCRIPTION',
]);
export type InAppPurchaseType = z.infer<typeof InAppPurchaseTypeSchema>;

/**
 * Who an offer is allowed to target, mirroring Apple's `customerEligibilities`: `NEW` (never
 * subscribed), `EXISTING` (currently subscribed), `EXPIRED` (previously subscribed, now lapsed).
 */
const OfferCustomerEligibilitySchema = z.enum(['NEW', 'EXISTING', 'EXPIRED']);
export type OfferCustomerEligibility = z.infer<typeof OfferCustomerEligibilitySchema>;

/**
 * Whether an offer stacks with or replaces the subscription's introductory offer
 * (Apple's `offerEligibility` on offer codes). `REPLACE_INTRO_OFFERS` is the common choice.
 */
const OfferEligibilitySchema = z.enum(['STACK_WITH_INTRO_OFFERS', 'REPLACE_INTRO_OFFERS']);
export type OfferEligibility = z.infer<typeof OfferEligibilitySchema>;

/**
 * One offer billing unit, mirroring Apple's `SubscriptionOfferDuration`. The offer lasts
 * {@link OfferConfigBase.numberOfPeriods} × this duration.
 */
const OfferDurationSchema = z.enum([
  'THREE_DAYS',
  'ONE_WEEK',
  'TWO_WEEKS',
  'ONE_MONTH',
  'TWO_MONTHS',
  'THREE_MONTHS',
  'SIX_MONTHS',
  'ONE_YEAR',
]);
export type OfferDuration = z.infer<typeof OfferDurationSchema>;

/**
 * How an offer discounts, mirroring Apple's `SubscriptionOfferMode`: `PAY_AS_YOU_GO` (a reduced price
 * each period), `PAY_UP_FRONT` (one reduced price for the whole span), or `FREE_TRIAL` (no charge — and
 * so no {@link OfferPrice} is allowed).
 */
const OfferModeSchema = z.enum(['PAY_AS_YOU_GO', 'PAY_UP_FRONT', 'FREE_TRIAL']);
export type OfferMode = z.infer<typeof OfferModeSchema>;

/**
 * One locale's customer-facing copy for a subscription or in-app purchase — see
 * {@link ProductLocalizationSchema}. Apple keeps a product in "Missing Metadata" until it has at least
 * one localization, so the reconciler rejects an empty list. The `locale` is the natural key.
 */
const ProductLocalizationSchema = z
  .strictObject({
    locale: z.string().describe('App Store locale code, e.g. `en-US`.'),
    name: z.string().describe('Customer-facing display name (Apple limit: 30 characters).'),
    description: z
      .string()
      .describe(
        'Customer-facing description (Apple limit: 45 characters). Omitted when not provided.',
      )
      .optional(),
  })
  .meta({
    id: 'ProductLocalization',
    description:
      'One locale\'s customer-facing copy for a subscription or in-app purchase — the display name (and optional description) shown on the product page. Apple keeps a product in "Missing Metadata" until it has at least one localization, so the reconciler rejects an empty list rather than silently creating an unsubmittable product. The `locale` is the natural key the reconciler matches on.',
  });
export type ProductLocalization = z.infer<typeof ProductLocalizationSchema>;

/**
 * One locale's display name for a subscription GROUP — see {@link GroupLocalizationSchema}. Groups carry
 * only a name (no description); at least one is required per group.
 */
const GroupLocalizationSchema = z
  .strictObject({
    locale: z.string().describe('App Store locale code, e.g. `en-US`.'),
    name: z.string().describe('Customer-facing group name.'),
  })
  .meta({
    id: 'GroupLocalization',
    description:
      'One locale\'s display name for a subscription GROUP. Groups carry only a name (no description); it\'s shown at the point of purchase grouping the subscription levels. Without one, every subscription in the group is stuck in "Missing Metadata", so at least one is required per group.',
  });
export type GroupLocalization = z.infer<typeof GroupLocalizationSchema>;

/**
 * A product's baseline price, expressed as the customer-facing amount in a base territory — see
 * {@link ProductPriceSchema}. Apple accepts only fixed price points; the reconciler resolves this to the
 * matching point and anchors the other territories off it.
 */
const ProductPriceSchema = z
  .strictObject({
    baseTerritory: z
      .string()
      .describe('Base territory whose price point is matched, e.g. `USA`. Defaults to `USA`.')
      .optional(),
    customerPrice: z
      .number()
      .describe(
        "Exact customer-facing price in the base territory's currency, e.g. `9.99`. Must equal an Apple price point.",
      ),
  })
  .meta({
    id: 'ProductPrice',
    description:
      "A product's baseline price, expressed as the customer-facing amount in a base territory. Apple does not accept arbitrary numbers — every price is one of a fixed ladder of price points. The reconciler resolves this declaration to the price point whose `customerPrice` equals `customerPrice` in `baseTerritory`, erroring (with the nearby points listed) when none matches exactly, then anchors the other territories off it — the same model the App Store Connect UI uses. A product with no price can never be submitted, so omit this only when you intend to set the price by hand in the UI.",
  });
export type ProductPrice = z.infer<typeof ProductPriceSchema>;

/**
 * One territory's discounted price for an offer — see {@link OfferPriceSchema}. Resolved to an Apple
 * price point exactly like {@link ProductPrice}. Omit prices entirely for a `FREE_TRIAL` offer.
 */
const OfferPriceSchema = z
  .strictObject({
    territory: z
      .string()
      .describe('Territory whose price point is matched, e.g. `USA`. Defaults to `USA`.')
      .optional(),
    customerPrice: z
      .number()
      .describe(
        "Exact customer-facing price in the territory's currency, e.g. `4.99`. Must equal an Apple price point.",
      ),
  })
  .meta({
    id: 'OfferPrice',
    description:
      "One territory's discounted price for an offer, resolved to an Apple subscription price point exactly like {@link ProductPrice} (the customer-facing amount must equal a point on Apple's fixed ladder). Omit prices entirely for a `FREE_TRIAL` offer.",
  });
export type OfferPrice = z.infer<typeof OfferPriceSchema>;

/**
 * A Google Play price — see {@link PlayPriceConfigSchema}. An exact amount in a currency's micro-units
 * (millionths) plus the ISO currency code. Kept distinct from {@link ProductPrice} because the two
 * stores model money differently.
 */
const PlayPriceConfigSchema = z
  .strictObject({
    priceMicros: z
      .string()
      .describe('Amount in micro-units: 1,000,000 = one whole unit of `currency`.'),
    currency: z.string().describe('ISO 4217 currency code, e.g. `USD`.'),
  })
  .meta({
    id: 'PlayPriceConfig',
    description:
      'A Google Play price: an exact amount in a currency\'s micro-units (millionths) plus the ISO currency code. Play has no price-point ladder — `"1990000"` with currency `"USD"` is $1.99. Used for both a product\'s default price and any per-region overrides. Kept distinct from {@link ProductPrice} because the two stores model money differently (Apple resolves a fixed price point; Play takes a literal micro-unit amount), so a single shared price field can\'t serve both.',
  });
export type PlayPriceConfig = z.infer<typeof PlayPriceConfigSchema>;

/**
 * Fields shared by the price-bearing offer kinds (offer codes, promotional, win-back) — see
 * {@link OfferConfigBaseSchema}. Kept as a reusable shape (not a named schema def) that the concrete
 * offer schemas spread in.
 */
const OfferConfigBaseSchema = z.strictObject({
  duration: OfferDurationSchema.describe('Offer billing duration unit.'),
  offerMode: OfferModeSchema.describe(
    'How the offer discounts. `FREE_TRIAL` must omit {@link OfferConfigBase.prices}.',
  ),
  numberOfPeriods: z
    .number()
    .describe('How many {@link OfferConfigBase.duration} units the offer spans.'),
  prices: z
    .array(OfferPriceSchema)
    .describe('Per-territory discounted prices. Required unless `offerMode` is `FREE_TRIAL`.')
    .optional(),
});
export type OfferConfigBase = z.infer<typeof OfferConfigBaseSchema>;

/**
 * A subscription offer-code campaign (Apple's `subscriptionOfferCodes`) — see
 * {@link OfferCodeConfigSchema}. A redeemable promo granting an introductory price; `name` is the
 * reconciler's natural key. Offer-code terms are immutable, so the reconciler only ever creates one.
 */
const OfferCodeConfigSchema = z
  .strictObject({
    ...OfferConfigBaseSchema.shape,
    name: z
      .string()
      .describe(
        "Campaign name shown in App Store Connect — unique per subscription; the reconciler's key.",
      ),
    customerEligibilities: z
      .array(OfferCustomerEligibilitySchema)
      .describe('Which customers may redeem the code.'),
    offerEligibility: OfferEligibilitySchema.describe(
      'Whether the code stacks with or replaces the intro offer.',
    ),
  })
  .meta({
    id: 'OfferCodeConfig',
    description:
      "A subscription offer-code campaign (Apple's `subscriptionOfferCodes`) — a redeemable promo that grants an introductory price. `name` is the reconciler's natural key (unique per subscription); offer-code terms are immutable once created, so the reconciler only ever creates a missing code, never edits one (deactivation is the explicit `launch offers deactivate` action). One-time-use and custom code batches are generated separately (the imperative `launch offers codes` subcommands), not declared here.",
  });
export type OfferCodeConfig = z.infer<typeof OfferCodeConfigSchema>;

/**
 * A promotional offer (Apple's `subscriptionPromotionalOffers`) — see {@link PromotionalOfferConfigSchema}.
 * A developer-presented discount surfaced in-app; `offerCode` is the reconciler's natural key.
 */
const PromotionalOfferConfigSchema = z
  .strictObject({
    ...OfferConfigBaseSchema.shape,
    name: z.string().describe('Internal name shown in App Store Connect.'),
    offerCode: z
      .string()
      .describe(
        "Product-level offer identifier the app references in StoreKit — the reconciler's key.",
      ),
  })
  .meta({
    id: 'PromotionalOfferConfig',
    description:
      "A promotional offer (Apple's `subscriptionPromotionalOffers`) — a developer-presented discount surfaced in-app to existing/lapsed subscribers. `offerCode` is the product-level identifier the app passes to StoreKit at redemption; it is the reconciler's natural key (unique per subscription).",
  });
export type PromotionalOfferConfig = z.infer<typeof PromotionalOfferConfigSchema>;

/**
 * An introductory offer (Apple's `subscriptionIntroductoryOffers`) — see
 * {@link IntroductoryOfferConfigSchema}. The one auto-applied first-time discount; `territory` is the
 * reconciler's natural key. Does not share {@link OfferConfigBase} (it takes a single `price`, not `prices`).
 */
const IntroductoryOfferConfigSchema = z
  .strictObject({
    duration: OfferDurationSchema.describe('Billing duration unit.'),
    offerMode: OfferModeSchema.describe(
      'How the offer discounts. `FREE_TRIAL` must omit {@link IntroductoryOfferConfig.price}.',
    ),
    numberOfPeriods: z.number().describe('How many `duration` units the offer spans.'),
    territory: z
      .string()
      .describe(
        "Territory this intro offer applies to (the reconciler's key); omit for all territories.",
      )
      .optional(),
    price: OfferPriceSchema.describe(
      'The discounted price in {@link IntroductoryOfferConfig.territory}. Required unless `FREE_TRIAL`.',
    ).optional(),
    startDate: z
      .string()
      .describe('ISO date (`YYYY-MM-DD`) the offer starts; omit to start immediately.')
      .optional(),
    endDate: z
      .string()
      .describe('ISO date (`YYYY-MM-DD`) the offer ends; omit for no end.')
      .optional(),
  })
  .meta({
    id: 'IntroductoryOfferConfig',
    description:
      "An introductory offer (Apple's `subscriptionIntroductoryOffers`) — the one auto-applied first-time discount. Apple allows at most one per (subscription, territory); when `territory` is omitted it applies to all territories the subscription is sold in. `territory` is the reconciler's natural key.",
  });
export type IntroductoryOfferConfig = z.infer<typeof IntroductoryOfferConfigSchema>;

/**
 * A win-back offer (Apple's `winBackOffers`) — see {@link WinBackOfferConfigSchema}. A discount shown on
 * the App Store to lapsed subscribers, gated on prior tenure and time since churn; `offerId` is the key.
 */
const WinBackOfferConfigSchema = z
  .strictObject({
    ...OfferConfigBaseSchema.shape,
    offerId: z
      .string()
      .describe(
        "Stable offer identifier the app references — the reconciler's key (unique within the app).",
      ),
    referenceName: z.string().describe('Internal reference name shown in App Store Connect.'),
    eligiblePaidMonths: z
      .number()
      .describe('Minimum months the customer must previously have paid to be eligible.'),
    monthsSinceLastSubscribed: z
      .strictObject({ min: z.number(), max: z.number() })
      .describe(
        'Eligible window since the customer last subscribed, in months (inclusive `[min, max]`).',
      ),
    waitBetweenOffersMonths: z
      .number()
      .describe(
        "Minimum months to wait between showing successive win-back offers; omit for Apple's default.",
      )
      .optional(),
    startDate: z.string().describe('ISO date (`YYYY-MM-DD`) the offer starts. Required by Apple.'),
    endDate: z
      .string()
      .describe('ISO date (`YYYY-MM-DD`) the offer ends; omit for no end.')
      .optional(),
    priority: z
      .enum(['HIGH', 'NORMAL'])
      .describe('Display priority among competing win-back offers. Defaults to `NORMAL`.')
      .optional(),
    promotionIntent: z
      .enum(['NOT_PROMOTED', 'USE_AUTO_GENERATED_ASSETS'])
      .describe(
        "Whether Apple auto-generates promotion artwork (`USE_AUTO_GENERATED_ASSETS`) or the offer isn't promoted.",
      )
      .optional(),
  })
  .meta({
    id: 'WinBackOfferConfig',
    description:
      "A win-back offer (Apple's `winBackOffers`) — a discount shown on the App Store to lapsed subscribers, gated on how long they previously paid and how long ago they churned. `offerId` is the reconciler's natural key (unique within the app). Win-back offers carry no images here — promotion artwork is the `promotionIntent` auto-generated path; custom artwork is a deferred follow-up.",
  });
export type WinBackOfferConfig = z.infer<typeof WinBackOfferConfigSchema>;

/**
 * One Google Play offer on a subscription's base plan — see {@link PlaySubscriptionOfferConfigSchema}. A
 * free trial, an introductory price, or both; `offerId` is the natural key. An offer with neither phase
 * is rejected.
 */
const PlaySubscriptionOfferConfigSchema = z
  .strictObject({
    offerId: z.string().describe('Play offer id (unique within the base plan).'),
    freeTrialDuration: z
      .string()
      .describe(
        'Free-trial length as an ISO-8601 duration (e.g. `P1W`, `P1M`). Omit for no trial phase.',
      )
      .optional(),
    introPrices: z
      .record(z.string(), PlayPriceConfigSchema)
      .describe(
        'Introductory per-region prices (region code → micro-units + currency). Omit for no intro phase.',
      )
      .optional(),
    introRecurrenceCount: z
      .number()
      .describe('How many billing periods the introductory price repeats for. Defaults to 1.')
      .optional(),
  })
  .meta({
    id: 'PlaySubscriptionOfferConfig',
    description:
      "One Google Play offer on a subscription's base plan — a free trial, an introductory price, or both (Play allows up to two offer phases). `offerId` is the natural key the reconciler matches on. Set `freeTrialDuration` for a free phase and/or `introPrices` for a discounted phase; an offer with neither is rejected (it would discount nothing).",
  });
export type PlaySubscriptionOfferConfig = z.infer<typeof PlaySubscriptionOfferConfigSchema>;

/**
 * Google Play overrides for a {@link SubscriptionConfig} — see {@link PlaySubscriptionOverrideSchema}.
 * Present it to publish the subscription to Play; omit to keep it Apple-only.
 */
const PlaySubscriptionOverrideSchema = z
  .strictObject({
    productId: z
      .string()
      .describe(
        'Play subscription product id; defaults to the shared {@link SubscriptionConfig.productId}.',
      )
      .optional(),
    basePlanId: z
      .string()
      .describe('Base-plan id; defaults to a slug of the billing period (e.g. `p1m`).')
      .optional(),
    prices: z
      .record(z.string(), PlayPriceConfigSchema)
      .describe(
        'Per-region base-plan prices (region code → micro-units + currency). At least one region required.',
      ),
    offers: z
      .array(PlaySubscriptionOfferConfigSchema)
      .describe('Offers (free trials / introductory pricing) to ensure exist on the base plan.')
      .optional(),
  })
  .meta({
    id: 'PlaySubscriptionOverride',
    description:
      "Google Play overrides for a {@link SubscriptionConfig}, so one subscription declaration can drive both stores. Apple models each billing period as a separate product, so Launch maps one config to one Play subscription with a single auto-renewing base plan whose billing period is derived from `subscriptionPeriod`. Listings come from the shared localizations; pricing is declared HERE (Play's per-region `units`+`nanos` money diverges from Apple's price points — see {@link PlayPriceConfig}). Present this object to publish the subscription to Play via `launch play-subscriptions`; omit it to keep the subscription Apple-only.",
  });
export type PlaySubscriptionOverride = z.infer<typeof PlaySubscriptionOverrideSchema>;

/**
 * One auto-renewable subscription product inside a {@link SubscriptionGroupConfig} — see
 * {@link SubscriptionConfigSchema}. `productId` is the reconciler's natural key.
 */
const SubscriptionConfigSchema = z
  .strictObject({
    productId: z
      .string()
      .describe(
        'Apple product id, e.g. `com.acme.pro.monthly`. Globally unique; the reconciler matches on it.',
      ),
    referenceName: z
      .string()
      .describe(
        'Internal reference name shown only in App Store Connect (Apple limit: 64 characters).',
      ),
    subscriptionPeriod: SubscriptionPeriodSchema.describe('Billing period for this level.'),
    localizations: z
      .array(ProductLocalizationSchema)
      .describe(
        'Per-locale display copy; at least one entry is required for a submittable product.',
      ),
    price: ProductPriceSchema.describe(
      'Baseline price. Omit only to price manually in the UI.',
    ).optional(),
    offerCodes: z
      .array(OfferCodeConfigSchema)
      .describe('Offer-code campaigns to ensure exist on this subscription (`launch offers`).')
      .optional(),
    promotionalOffers: z
      .array(PromotionalOfferConfigSchema)
      .describe('Promotional offers to ensure exist on this subscription.')
      .optional(),
    introductoryOffers: z
      .array(IntroductoryOfferConfigSchema)
      .describe(
        'Introductory offers (at most one per territory) to ensure exist on this subscription.',
      )
      .optional(),
    winBackOffers: z
      .array(WinBackOfferConfigSchema)
      .describe('Win-back offers to ensure exist on this subscription.')
      .optional(),
    reviewScreenshot: z
      .string()
      .describe(
        "Path (relative to the app directory) to this subscription's App Review screenshot — the image Apple requires before a subscription can be submitted. `launch sync` uploads it via the reservation flow, idempotently: it's skipped when the live screenshot's MD5 already matches the local file. Omit to attach it by hand in App Store Connect. Reconciled in `core/ascScreenshots.ts`, not here.",
      )
      .optional(),
    play: PlaySubscriptionOverrideSchema.describe(
      'Google Play overrides; present this to also publish the subscription to Play (see {@link PlaySubscriptionOverride}).',
    ).optional(),
  })
  .meta({
    id: 'SubscriptionConfig',
    description:
      "One auto-renewable subscription product inside a {@link SubscriptionGroupConfig}. `productId` is the globally-unique Apple product id the app references at runtime and the reconciler's natural key. Add a {@link PlaySubscriptionOverride} under `play` to also publish it to Google Play.",
  });
export type SubscriptionConfig = z.infer<typeof SubscriptionConfigSchema>;

/**
 * A subscription group — Apple's container for mutually-exclusive subscription levels — see
 * {@link SubscriptionGroupConfigSchema}. `referenceName` is the reconciler's natural key.
 */
const SubscriptionGroupConfigSchema = z
  .strictObject({
    referenceName: z
      .string()
      .describe(
        "Internal reference name (unique within the app) — the reconciler's natural key for the group.",
      ),
    localizations: z
      .array(GroupLocalizationSchema)
      .describe(
        "Per-locale group display name; at least one entry is required (else the group's subs stay unsubmittable).",
      ),
    subscriptions: z
      .array(SubscriptionConfigSchema)
      .describe('The subscription levels in this group.'),
  })
  .meta({
    id: 'SubscriptionGroupConfig',
    description:
      "A subscription group — Apple's container for mutually-exclusive subscription levels (a customer holds at most one active subscription per group). `referenceName` is unique within the app and is the reconciler's natural key for the group.",
  });
export type SubscriptionGroupConfig = z.infer<typeof SubscriptionGroupConfigSchema>;

/**
 * Google Play overrides for an {@link InAppPurchaseConfig} — see {@link PlayProductOverrideSchema}.
 * Present it to publish the product to Play; omit to keep it Apple-only.
 */
const PlayProductOverrideSchema = z
  .strictObject({
    sku: z
      .string()
      .describe(
        'Play SKU; defaults to the shared {@link InAppPurchaseConfig.productId} when omitted.',
      )
      .optional(),
    defaultPrice: PlayPriceConfigSchema.describe(
      'Default price applied to every region without an explicit {@link PlayProductOverride.prices} entry.',
    ).optional(),
    prices: z
      .record(z.string(), PlayPriceConfigSchema)
      .describe('Per-region price overrides keyed by ISO region code (e.g. `US`).')
      .optional(),
  })
  .meta({
    id: 'PlayProductOverride',
    description:
      "Google Play overrides for an {@link InAppPurchaseConfig}, so one product declaration can drive both stores. The shared fields are reused for Play — `productId` becomes the Play SKU (override via `sku`) and each {@link ProductLocalization} becomes a Play listing (`name` → title, `description` → description), with the first localization's locale as the product's default language. Pricing is declared HERE rather than reused from {@link InAppPurchaseConfig.price} because the two stores' money models don't line up (see {@link PlayPriceConfig}). Present this object to publish the product to Play via `launch play-products` as an active managed product; omit it to keep the product Apple-only.",
  });
export type PlayProductOverride = z.infer<typeof PlayProductOverrideSchema>;

/**
 * One non-subscription in-app purchase (consumable, non-consumable, or non-renewing subscription) — see
 * {@link InAppPurchaseConfigSchema}. `productId` is the reconciler's natural key.
 */
const InAppPurchaseConfigSchema = z
  .strictObject({
    productId: z
      .string()
      .describe(
        'Apple product id, e.g. `com.acme.coins.100`. Globally unique; the reconciler matches on it.',
      ),
    referenceName: z.string().describe('Internal reference name shown only in App Store Connect.'),
    type: InAppPurchaseTypeSchema.describe('The purchase kind.'),
    localizations: z
      .array(ProductLocalizationSchema)
      .describe(
        'Per-locale display copy; at least one entry is required for a submittable product.',
      ),
    price: ProductPriceSchema.describe(
      'Baseline price. Omit only to price manually in the UI.',
    ).optional(),
    play: PlayProductOverrideSchema.describe(
      'Google Play overrides; present this to also publish the product to Play (see {@link PlayProductOverride}).',
    ).optional(),
  })
  .meta({
    id: 'InAppPurchaseConfig',
    description:
      "One non-subscription in-app purchase (consumable, non-consumable, or non-renewing subscription). `productId` is the globally-unique Apple product id and the reconciler's natural key. Add a {@link PlayProductOverride} under `play` to also publish it to Google Play.",
  });
export type InAppPurchaseConfig = z.infer<typeof InAppPurchaseConfigSchema>;

/**
 * One promoted purchase (Apple's `promotedPurchases`) — see {@link PromotedPurchaseConfigSchema}. Surfaced
 * on the app's App Store product page; declaration order is the display order.
 */
const PromotedPurchaseConfigSchema = z
  .strictObject({
    productId: z
      .string()
      .describe('Apple product id of the subscription or in-app purchase to promote.'),
    visibleForAllUsers: z
      .boolean()
      .describe(
        'Whether the promotion is visible to all users (vs. targeted via the API). Defaults to `true`.',
      )
      .optional(),
    enabled: z
      .boolean()
      .describe('Whether the promotion is enabled. Defaults to `true`.')
      .optional(),
  })
  .meta({
    id: 'PromotedPurchaseConfig',
    description:
      "One promoted purchase (Apple's `promotedPurchases`) — an IAP or subscription surfaced on the app's App Store product page. Declaration order in {@link AppProducts.promotedPurchases} is the display order Apple shows; `launch offers` reorders the live list to match. `productId` references an existing subscription or in-app purchase; the reconciler resolves it to the live resource.",
  });
export type PromotedPurchaseConfig = z.infer<typeof PromotedPurchaseConfigSchema>;

/**
 * The declarative App Store Connect product catalog for ONE app — see {@link AppProductsSchema}. Keyed by
 * iOS bundle id under {@link LaunchConfig.products}; `launch sync` reconciles the live account to match.
 */
export const AppProductsSchema = z
  .strictObject({
    subscriptionGroups: z
      .array(SubscriptionGroupConfigSchema)
      .describe('Auto-renewable subscription groups and the subscriptions within them.')
      .optional(),
    inAppPurchases: z
      .array(InAppPurchaseConfigSchema)
      .describe('One-off in-app purchases.')
      .optional(),
    promotedPurchases: z
      .array(PromotedPurchaseConfigSchema)
      .describe(
        'Promoted purchases in product-page display order (`launch offers` reorders the live list to match).',
      )
      .optional(),
  })
  .meta({
    id: 'AppProducts',
    description:
      'The declarative App Store Connect product catalog for ONE app, keyed by iOS bundle id under {@link LaunchConfig.products}. `launch sync` reconciles the live account to match this: it creates missing groups/subscriptions/IAPs, fills in localizations, and sets prices. `launch offers` reconciles the subscription offers nested under {@link SubscriptionGroupConfig} and the {@link AppProducts.promotedPurchases} ordering. All fields are optional so an app can sell only subscriptions, only one-off purchases, or (with none set) nothing.',
  });
export type AppProducts = z.infer<typeof AppProductsSchema>;
