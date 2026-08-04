import { type Effect, Schema } from 'effect';
import type { ParseResult } from 'effect';
import {
  APP_CLIP_ACTIONS,
  LEADERBOARD_FORMATTERS,
  LEADERBOARD_SORT_TYPES,
  LEADERBOARD_SUBMISSION_TYPES,
} from '../types/appleCatalog.js';
import type { SchemaViolation } from './jsonSchema.js';
import {
  DEFAULT_BUILD_ENGINE,
  DEFAULT_CREDENTIALS_PROVIDER,
  DEFAULT_STORAGE_PROVIDER,
  DEFAULT_SUBMITTER,
} from '../types/config.js';
import { PLAY_TRACKS } from '../types/app.js';
const CONFIG_PARSE_OPTIONS = { errors: 'all', onExcessProperty: 'error' } as const;
const OptionalString = Schema.optional(Schema.String);
const OptionalBoolean = Schema.optional(Schema.Boolean);
const StringArray = Schema.Array(Schema.String);
const OptionalStringArray = Schema.optional(StringArray);
const StringMap = Schema.Record({ key: Schema.String, value: Schema.String });
const described = <A, I, R>(
  valueSchema: Schema.Schema<A, I, R>,
  description: string,
): Schema.Schema<A, I, R> => {
  return valueSchema.annotations({ description });
};
const PlayTrackSchema = Schema.Literal(...PLAY_TRACKS);
const SubmitByPlatformEffectSchema = Schema.Struct({
  ios: OptionalStringArray,
  android: OptionalStringArray,
  tvos: OptionalStringArray,
  macos: OptionalStringArray,
  visionos: OptionalStringArray,
}).annotations({ identifier: 'SubmitByPlatform' });
const BuildProfileEffectSchema = Schema.Struct({
  name: Schema.String.annotations({ description: 'Profile name as referenced by `--profile`.' }),
  envFile: Schema.optional(
    Schema.String.annotations({
      description:
        'Dotenv file to load for this profile, relative to the app dir. Defaults to `.env`.',
    }),
  ),
  env: Schema.optional(
    described(
      Schema.Record({ key: Schema.String, value: Schema.String }),
      'Inline env vars for this profile, merged into the build/update/release environment. They sit above the dotenv files (`.env.local`, `.env.<profile>`, `.env`) but below keychain secrets and `--env` flags in the precedence ladder - see `core/env.ts` `resolveEnv`. Use for non-secret, committed config that should travel with the profile; keep real secrets in `launch secret`.',
    ),
  ),
  ssl: Schema.optional(
    Schema.Boolean.annotations({
      description:
        'Enable SSL pinning for this profile (mirrors the existing build.ts toggle). Defaults to false.',
    }),
  ),
  sizeBudgetMB: Schema.optional(
    Schema.Number.annotations({
      description: `Per-device download-size budget in megabytes. When the size report exceeds it, the build soft-gates (asks for confirmation) rather than failing. Defaults to 200 (Apple's cellular line).`,
    }),
  ),
  track: Schema.optional(
    described(
      PlayTrackSchema,
      'Android-only: default Play track for `launch build android` when `--track` is omitted. Defaults to `internal` (the only safe target for a fresh account). Ignored on iOS.',
    ),
  ),
  rollout: Schema.optional(
    Schema.Number.annotations({
      description:
        'Android-only: default staged-rollout fraction (0-1) for production releases when `--rollout` is omitted. Defaults to `1.0` (full rollout). Ignored on iOS.',
    }),
  ),
}).annotations({
  identifier: 'BuildProfile',
  description:
    'A named build profile from `launch.config.ts` (e.g. `production`, `preview`). Holds only Launch-specific settings; app facts stay in `app.json`. A profile maps to a `.env` file whose values are injected into the build and gates the artifact on size.',
});
const ProductLocalizationEffectSchema = Schema.Struct({
  locale: Schema.String.annotations({ description: 'App Store locale code, e.g. `en-US`.' }),
  name: Schema.String.annotations({
    description: 'Customer-facing display name (Apple limit: 30 characters).',
  }),
  description: Schema.optional(
    Schema.String.annotations({
      description:
        'Customer-facing description (Apple limit: 45 characters). Omitted when not provided.',
    }),
  ),
}).annotations({
  identifier: 'ProductLocalization',
  description: `One locale's customer-facing copy for a subscription or in-app purchase - the display name (and optional description) shown on the product page. Apple keeps a product in "Missing Metadata" until it has at least one localization, so the reconciler rejects an empty list rather than silently creating an unsubmittable product. The \`locale\` is the natural key the reconciler matches on.`,
});
const GroupLocalizationEffectSchema = Schema.Struct({
  locale: Schema.String.annotations({ description: 'App Store locale code, e.g. `en-US`.' }),
  name: Schema.String.annotations({ description: 'Customer-facing group name.' }),
}).annotations({
  identifier: 'GroupLocalization',
  description: `One locale's display name for a subscription GROUP. Groups carry only a name (no description); it's shown at the point of purchase grouping the subscription levels. Without one, every subscription in the group is stuck in "Missing Metadata", so at least one is required per group.`,
});
const ProductPriceEffectSchema = Schema.Struct({
  baseTerritory: Schema.optional(
    Schema.String.annotations({
      description: 'Base territory whose price point is matched, e.g. `USA`. Defaults to `USA`.',
    }),
  ),
  customerPrice: Schema.Number.annotations({
    description: `Exact customer-facing price in the base territory's currency, e.g. \`9.99\`. Must equal an Apple price point.`,
  }),
}).annotations({
  identifier: 'ProductPrice',
  description: `A product's baseline price, expressed as the customer-facing amount in a base territory. Apple does not accept arbitrary numbers - every price is one of a fixed ladder of price points. The reconciler resolves this declaration to the price point whose \`customerPrice\` equals \`customerPrice\` in \`baseTerritory\`, erroring (with the nearby points listed) when none matches exactly, then anchors the other territories off it - the same model the App Store Connect UI uses. A product with no price can never be submitted, so omit this only when you intend to set the price by hand in the UI.`,
});
const OfferPriceEffectSchema = Schema.Struct({
  territory: Schema.optional(
    Schema.String.annotations({
      description: 'Territory whose price point is matched, e.g. `USA`. Defaults to `USA`.',
    }),
  ),
  customerPrice: Schema.Number.annotations({
    description: `Exact customer-facing price in the territory's currency, e.g. \`4.99\`. Must equal an Apple price point.`,
  }),
}).annotations({
  identifier: 'OfferPrice',
  description: `One territory's discounted price for an offer, resolved to an Apple subscription price point exactly like {@link ProductPrice} (the customer-facing amount must equal a point on Apple's fixed ladder). Omit prices entirely for a \`FREE_TRIAL\` offer.`,
});
const PlayPriceConfigEffectSchema = Schema.Struct({
  priceMicros: Schema.String.annotations({
    description: 'Amount in micro-units: 1,000,000 = one whole unit of `currency`.',
  }),
  currency: Schema.String.annotations({ description: 'ISO 4217 currency code, e.g. `USD`.' }),
}).annotations({
  identifier: 'PlayPriceConfig',
  description: `A Google Play price: an exact amount in a currency's micro-units (millionths) plus the ISO currency code. Play has no price-point ladder - \`"1990000"\` with currency \`"USD"\` is $1.99. Used for both a product's default price and any per-region overrides. Kept distinct from {@link ProductPrice} because the two stores model money differently (Apple resolves a fixed price point; Play takes a literal micro-unit amount), so a single shared price field can't serve both.`,
});
const OfferDurationSchema = Schema.Literal(
  'THREE_DAYS',
  'ONE_WEEK',
  'TWO_WEEKS',
  'ONE_MONTH',
  'TWO_MONTHS',
  'THREE_MONTHS',
  'SIX_MONTHS',
  'ONE_YEAR',
);
const OfferModeSchema = Schema.Literal('PAY_AS_YOU_GO', 'PAY_UP_FRONT', 'FREE_TRIAL');
const OfferCustomerEligibilitySchema = Schema.Literal('NEW', 'EXISTING', 'EXPIRED');
const OfferEligibilitySchema = Schema.Literal('STACK_WITH_INTRO_OFFERS', 'REPLACE_INTRO_OFFERS');
const OfferConfigBaseSchema = {
  duration: described(OfferDurationSchema, 'Offer billing duration unit.'),
  offerMode: described(
    OfferModeSchema,
    'How the offer discounts. `FREE_TRIAL` must omit {@link OfferConfigBase.prices}.',
  ),
  numberOfPeriods: Schema.Number.annotations({
    description: 'How many {@link OfferConfigBase.duration} units the offer spans.',
  }),
  prices: Schema.optional(
    described(
      Schema.Array(OfferPriceEffectSchema),
      'Per-territory discounted prices. Required unless `offerMode` is `FREE_TRIAL`.',
    ),
  ),
};
const OfferCodeConfigEffectSchema = Schema.Struct({
  ...OfferConfigBaseSchema,
  name: Schema.String.annotations({
    description: `Campaign name shown in App Store Connect - unique per subscription; the reconciler's key.`,
  }),
  customerEligibilities: described(
    Schema.Array(OfferCustomerEligibilitySchema),
    'Which customers may redeem the code.',
  ),
  offerEligibility: described(
    OfferEligibilitySchema,
    'Whether the code stacks with or replaces the intro offer.',
  ),
}).annotations({
  identifier: 'OfferCodeConfig',
  description: `A subscription offer-code campaign (Apple's \`subscriptionOfferCodes\`) - a redeemable promo that grants an introductory price. \`name\` is the reconciler's natural key (unique per subscription); offer-code terms are immutable once created, so the reconciler only ever creates a missing code, never edits one (deactivation is the explicit \`launch offers deactivate\` action). One-time-use and custom code batches are generated separately (the imperative \`launch offers codes\` subcommands), not declared here.`,
});
const PromotionalOfferConfigEffectSchema = Schema.Struct({
  duration: described(OfferDurationSchema, 'Offer billing duration unit.'),
  offerMode: described(
    OfferModeSchema,
    'How the offer discounts. `FREE_TRIAL` must omit {@link OfferConfigBase.prices}.',
  ),
  numberOfPeriods: Schema.Number.annotations({
    description: 'How many {@link OfferConfigBase.duration} units the offer spans.',
  }),
  prices: Schema.optional(
    described(
      Schema.Array(OfferPriceEffectSchema),
      'Per-territory discounted prices. Required unless `offerMode` is `FREE_TRIAL`.',
    ),
  ),
  name: Schema.String.annotations({ description: 'Internal name shown in App Store Connect.' }),
  offerCode: Schema.String.annotations({
    description: `Product-level offer identifier the app references in StoreKit - the reconciler's key.`,
  }),
}).annotations({
  identifier: 'PromotionalOfferConfig',
  description: `A promotional offer (Apple's \`subscriptionPromotionalOffers\`) - a developer-presented discount surfaced in-app to existing/lapsed subscribers. \`offerCode\` is the product-level identifier the app passes to StoreKit at redemption; it is the reconciler's natural key (unique per subscription).`,
});
const IntroductoryOfferConfigEffectSchema = Schema.Struct({
  duration: described(OfferDurationSchema, 'Billing duration unit.'),
  offerMode: described(
    OfferModeSchema,
    'How the offer discounts. `FREE_TRIAL` must omit {@link IntroductoryOfferConfig.price}.',
  ),
  numberOfPeriods: Schema.Number.annotations({
    description: 'How many `duration` units the offer spans.',
  }),
  territory: Schema.optional(
    Schema.String.annotations({
      description: `Territory this intro offer applies to (the reconciler's key); omit for all territories.`,
    }),
  ),
  price: Schema.optional(
    described(
      OfferPriceEffectSchema,
      'The discounted price in {@link IntroductoryOfferConfig.territory}. Required unless `FREE_TRIAL`.',
    ),
  ),
  startDate: Schema.optional(
    Schema.String.annotations({
      description: 'ISO date (`YYYY-MM-DD`) the offer starts; omit to start immediately.',
    }),
  ),
  endDate: Schema.optional(
    Schema.String.annotations({
      description: 'ISO date (`YYYY-MM-DD`) the offer ends; omit for no end.',
    }),
  ),
}).annotations({
  identifier: 'IntroductoryOfferConfig',
  description: `An introductory offer (Apple's \`subscriptionIntroductoryOffers\`) - the one auto-applied first-time discount. Apple allows at most one per (subscription, territory); when \`territory\` is omitted it applies to all territories the subscription is sold in. \`territory\` is the reconciler's natural key.`,
});
const WinBackOfferConfigEffectSchema = Schema.Struct({
  duration: described(OfferDurationSchema, 'Offer billing duration unit.'),
  offerMode: described(
    OfferModeSchema,
    'How the offer discounts. `FREE_TRIAL` must omit {@link OfferConfigBase.prices}.',
  ),
  numberOfPeriods: Schema.Number.annotations({
    description: 'How many {@link OfferConfigBase.duration} units the offer spans.',
  }),
  prices: Schema.optional(
    described(
      Schema.Array(OfferPriceEffectSchema),
      'Per-territory discounted prices. Required unless `offerMode` is `FREE_TRIAL`.',
    ),
  ),
  offerId: Schema.String.annotations({
    description: `Stable offer identifier the app references - the reconciler's key (unique within the app).`,
  }),
  referenceName: Schema.String.annotations({
    description: 'Internal reference name shown in App Store Connect.',
  }),
  eligiblePaidMonths: Schema.Number.annotations({
    description: 'Minimum months the customer must previously have paid to be eligible.',
  }),
  monthsSinceLastSubscribed: described(
    Schema.Struct({ min: Schema.Number, max: Schema.Number }),
    'Eligible window since the customer last subscribed, in months (inclusive `[min, max]`).',
  ),
  waitBetweenOffersMonths: Schema.optional(
    Schema.Number.annotations({
      description: `Minimum months to wait between showing successive win-back offers; omit for Apple's default.`,
    }),
  ),
  startDate: Schema.String.annotations({
    description: 'ISO date (`YYYY-MM-DD`) the offer starts. Required by Apple.',
  }),
  endDate: Schema.optional(
    Schema.String.annotations({
      description: 'ISO date (`YYYY-MM-DD`) the offer ends; omit for no end.',
    }),
  ),
  priority: Schema.optional(
    described(
      Schema.Literal('HIGH', 'NORMAL'),
      'Display priority among competing win-back offers. Defaults to `NORMAL`.',
    ),
  ),
  promotionIntent: Schema.optional(
    described(
      Schema.Literal('NOT_PROMOTED', 'USE_AUTO_GENERATED_ASSETS'),
      `Whether Apple auto-generates promotion artwork (\`USE_AUTO_GENERATED_ASSETS\`) or the offer isn't promoted.`,
    ),
  ),
}).annotations({
  identifier: 'WinBackOfferConfig',
  description: `A win-back offer (Apple's \`winBackOffers\`) - a discount shown on the App Store to lapsed subscribers, gated on how long they previously paid and how long ago they churned. \`offerId\` is the reconciler's natural key (unique within the app). Win-back offers carry no images here - promotion artwork is the \`promotionIntent\` auto-generated path; custom artwork is a deferred follow-up.`,
});
const PlaySubscriptionOfferConfigEffectSchema = Schema.Struct({
  offerId: Schema.String.annotations({
    description: 'Play offer id (unique within the base plan).',
  }),
  freeTrialDuration: Schema.optional(
    Schema.String.annotations({
      description:
        'Free-trial length as an ISO-8601 duration (e.g. `P1W`, `P1M`). Omit for no trial phase.',
    }),
  ),
  introPrices: Schema.optional(
    described(
      Schema.Record({ key: Schema.String, value: PlayPriceConfigEffectSchema }),
      'Introductory per-region prices (region code -> micro-units + currency). Omit for no intro phase.',
    ),
  ),
  introRecurrenceCount: Schema.optional(
    Schema.Number.annotations({
      description: 'How many billing periods the introductory price repeats for. Defaults to 1.',
    }),
  ),
}).annotations({
  identifier: 'PlaySubscriptionOfferConfig',
  description: `One Google Play offer on a subscription's base plan - a free trial, an introductory price, or both (Play allows up to two offer phases). \`offerId\` is the natural key the reconciler matches on. Set \`freeTrialDuration\` for a free phase and/or \`introPrices\` for a discounted phase; an offer with neither is rejected (it would discount nothing).`,
});
const PlaySubscriptionOverrideEffectSchema = Schema.Struct({
  productId: Schema.optional(
    Schema.String.annotations({
      description:
        'Play subscription product id; defaults to the shared {@link SubscriptionConfig.productId}.',
    }),
  ),
  basePlanId: Schema.optional(
    Schema.String.annotations({
      description: 'Base-plan id; defaults to a slug of the billing period (e.g. `p1m`).',
    }),
  ),
  prices: described(
    Schema.Record({ key: Schema.String, value: PlayPriceConfigEffectSchema }),
    'Per-region base-plan prices (region code -> micro-units + currency). At least one region required.',
  ),
  offers: Schema.optional(
    described(
      Schema.Array(PlaySubscriptionOfferConfigEffectSchema),
      'Offers (free trials / introductory pricing) to ensure exist on the base plan.',
    ),
  ),
}).annotations({
  identifier: 'PlaySubscriptionOverride',
  description: `Google Play overrides for a {@link SubscriptionConfig}, so one subscription declaration can drive both stores. Apple models each billing period as a separate product, so Launch maps one config to one Play subscription with a single auto-renewing base plan whose billing period is derived from \`subscriptionPeriod\`. Listings come from the shared localizations; pricing is declared HERE (Play's per-region \`units\`+\`nanos\` money diverges from Apple's price points - see {@link PlayPriceConfig}). Present this object to publish the subscription to Play via \`launch play-subscriptions\`; omit it to keep the subscription Apple-only.`,
});
const SubscriptionPeriodSchema = Schema.Literal(
  'ONE_WEEK',
  'ONE_MONTH',
  'TWO_MONTHS',
  'THREE_MONTHS',
  'SIX_MONTHS',
  'ONE_YEAR',
);
const SubscriptionConfigEffectSchema = Schema.Struct({
  productId: Schema.String.annotations({
    description:
      'Apple product id, e.g. `com.acme.pro.monthly`. Globally unique; the reconciler matches on it.',
  }),
  referenceName: Schema.String.annotations({
    description:
      'Internal reference name shown only in App Store Connect (Apple limit: 64 characters).',
  }),
  subscriptionPeriod: described(SubscriptionPeriodSchema, 'Billing period for this level.'),
  localizations: described(
    Schema.Array(ProductLocalizationEffectSchema),
    'Per-locale display copy; at least one entry is required for a submittable product.',
  ),
  price: Schema.optional(
    described(ProductPriceEffectSchema, 'Baseline price. Omit only to price manually in the UI.'),
  ),
  offerCodes: Schema.optional(
    described(
      Schema.Array(OfferCodeConfigEffectSchema),
      'Offer-code campaigns to ensure exist on this subscription (`launch offers`).',
    ),
  ),
  promotionalOffers: Schema.optional(
    described(
      Schema.Array(PromotionalOfferConfigEffectSchema),
      'Promotional offers to ensure exist on this subscription.',
    ),
  ),
  introductoryOffers: Schema.optional(
    described(
      Schema.Array(IntroductoryOfferConfigEffectSchema),
      'Introductory offers (at most one per territory) to ensure exist on this subscription.',
    ),
  ),
  winBackOffers: Schema.optional(
    described(
      Schema.Array(WinBackOfferConfigEffectSchema),
      'Win-back offers to ensure exist on this subscription.',
    ),
  ),
  reviewScreenshot: Schema.optional(
    Schema.String.annotations({
      description: `Path (relative to the app directory) to this subscription's App Review screenshot - the image Apple requires before a subscription can be submitted. \`launch sync\` uploads it via the reservation flow, idempotently: it's skipped when the live screenshot's MD5 already matches the local file. Omit to attach it by hand in App Store Connect. Reconciled in \`core/store/ascScreenshots.ts\`, not here.`,
    }),
  ),
  play: Schema.optional(
    described(
      PlaySubscriptionOverrideEffectSchema,
      'Google Play overrides; present this to also publish the subscription to Play (see {@link PlaySubscriptionOverride}).',
    ),
  ),
}).annotations({
  identifier: 'SubscriptionConfig',
  description: `One auto-renewable subscription product inside a {@link SubscriptionGroupConfig}. \`productId\` is the globally-unique Apple product id the app references at runtime and the reconciler's natural key. Add a {@link PlaySubscriptionOverride} under \`play\` to also publish it to Google Play.`,
});
const SubscriptionGroupConfigEffectSchema = Schema.Struct({
  referenceName: Schema.String.annotations({
    description: `Internal reference name (unique within the app) - the reconciler's natural key for the group.`,
  }),
  localizations: described(
    Schema.Array(GroupLocalizationEffectSchema),
    `Per-locale group display name; at least one entry is required (else the group's subs stay unsubmittable).`,
  ),
  subscriptions: described(
    Schema.Array(SubscriptionConfigEffectSchema),
    'The subscription levels in this group.',
  ),
}).annotations({
  identifier: 'SubscriptionGroupConfig',
  description: `A subscription group - Apple's container for mutually-exclusive subscription levels (a customer holds at most one active subscription per group). \`referenceName\` is unique within the app and is the reconciler's natural key for the group.`,
});
const PlayProductOverrideEffectSchema = Schema.Struct({
  sku: Schema.optional(
    Schema.String.annotations({
      description:
        'Play SKU; defaults to the shared {@link InAppPurchaseConfig.productId} when omitted.',
    }),
  ),
  defaultPrice: Schema.optional(
    described(
      PlayPriceConfigEffectSchema,
      'Default price applied to every region without an explicit {@link PlayProductOverride.prices} entry.',
    ),
  ),
  prices: Schema.optional(
    described(
      Schema.Record({ key: Schema.String, value: PlayPriceConfigEffectSchema }),
      'Per-region price overrides keyed by ISO region code (e.g. `US`).',
    ),
  ),
}).annotations({
  identifier: 'PlayProductOverride',
  description: `Google Play overrides for an {@link InAppPurchaseConfig}, so one product declaration can drive both stores. The shared fields are reused for Play - \`productId\` becomes the Play SKU (override via \`sku\`) and each {@link ProductLocalization} becomes a Play listing (\`name\` -> title, \`description\` -> description), with the first localization's locale as the product's default language. Pricing is declared HERE rather than reused from {@link InAppPurchaseConfig.price} because the two stores' money models don't line up (see {@link PlayPriceConfig}). Present this object to publish the product to Play via \`launch play-products\` as an active managed product; omit it to keep the product Apple-only.`,
});
const InAppPurchaseConfigEffectSchema = Schema.Struct({
  productId: Schema.String.annotations({
    description:
      'Apple product id, e.g. `com.acme.coins.100`. Globally unique; the reconciler matches on it.',
  }),
  referenceName: Schema.String.annotations({
    description: 'Internal reference name shown only in App Store Connect.',
  }),
  type: described(
    Schema.Literal('CONSUMABLE', 'NON_CONSUMABLE', 'NON_RENEWING_SUBSCRIPTION'),
    'The purchase kind.',
  ),
  localizations: described(
    Schema.Array(ProductLocalizationEffectSchema),
    'Per-locale display copy; at least one entry is required for a submittable product.',
  ),
  price: Schema.optional(
    described(ProductPriceEffectSchema, 'Baseline price. Omit only to price manually in the UI.'),
  ),
  play: Schema.optional(
    described(
      PlayProductOverrideEffectSchema,
      'Google Play overrides; present this to also publish the product to Play (see {@link PlayProductOverride}).',
    ),
  ),
}).annotations({
  identifier: 'InAppPurchaseConfig',
  description: `One non-subscription in-app purchase (consumable, non-consumable, or non-renewing subscription). \`productId\` is the globally-unique Apple product id and the reconciler's natural key. Add a {@link PlayProductOverride} under \`play\` to also publish it to Google Play.`,
});
const PromotedPurchaseConfigEffectSchema = Schema.Struct({
  productId: Schema.String.annotations({
    description: 'Apple product id of the subscription or in-app purchase to promote.',
  }),
  visibleForAllUsers: Schema.optional(
    Schema.Boolean.annotations({
      description:
        'Whether the promotion is visible to all users (vs. targeted via the API). Defaults to `true`.',
    }),
  ),
  enabled: Schema.optional(
    Schema.Boolean.annotations({
      description: 'Whether the promotion is enabled. Defaults to `true`.',
    }),
  ),
}).annotations({
  identifier: 'PromotedPurchaseConfig',
  description: `One promoted purchase (Apple's \`promotedPurchases\`) - an IAP or subscription surfaced on the app's App Store product page. Declaration order in {@link AppProducts.promotedPurchases} is the display order Apple shows; \`launch offers\` reorders the live list to match. \`productId\` references an existing subscription or in-app purchase; the reconciler resolves it to the live resource.`,
});
const AppProductsEffectSchema = Schema.Struct({
  subscriptionGroups: Schema.optional(
    described(
      Schema.Array(SubscriptionGroupConfigEffectSchema),
      'Auto-renewable subscription groups and the subscriptions within them.',
    ),
  ),
  inAppPurchases: Schema.optional(
    described(Schema.Array(InAppPurchaseConfigEffectSchema), 'One-off in-app purchases.'),
  ),
  promotedPurchases: Schema.optional(
    described(
      Schema.Array(PromotedPurchaseConfigEffectSchema),
      'Promoted purchases in product-page display order (`launch offers` reorders the live list to match).',
    ),
  ),
}).annotations({
  identifier: 'AppProducts',
  description:
    'The declarative App Store Connect product catalog for ONE app, keyed by iOS bundle id under {@link LaunchConfig.products}. `launch sync` reconciles the live account to match this: it creates missing groups/subscriptions/IAPs, fills in localizations, and sets prices. `launch offers` reconciles the subscription offers nested under {@link SubscriptionGroupConfig} and the {@link AppProducts.promotedPurchases} ordering. All fields are optional so an app can sell only subscriptions, only one-off purchases, or (with none set) nothing.',
});
const ReleaseConfigEffectSchema = Schema.Struct({
  releaseType: Schema.optional(
    described(
      Schema.Literal('AFTER_APPROVAL', 'MANUAL', 'SCHEDULED'),
      'How an approved build reaches the store. Defaults to `AFTER_APPROVAL`. Overridable with `--manual`/`--scheduled`.',
    ),
  ),
  earliestReleaseDate: Schema.optional(
    Schema.String.annotations({
      description: `ISO-8601 instant to go live at - only meaningful with \`releaseType: "SCHEDULED"\` (ignored otherwise). A \`--scheduled <iso>\` flag sets both this and the release type for one run.`,
    }),
  ),
  phasedRelease: Schema.optional(
    Schema.Boolean.annotations({
      description: `Opt into Apple's 7-day phased release (a gradual percentage rollout) for an approved update. Defaults to \`false\` - an immediate 100% release. Overridable per-run with \`--phased\`, and steerable afterward with \`launch rollout <pause|resume|complete>\`. Ignored for a first version (Apple only phases updates).`,
    }),
  ),
  usesNonExemptEncryption: Schema.optional(
    Schema.Boolean.annotations({
      description: `Whether the binary contains non-exempt encryption (Apple's export-compliance question). \`false\` - the common case for apps using only standard HTTPS/system crypto - lets Launch declare compliance over the API so the build clears \`WAITING_FOR_EXPORT_COMPLIANCE\` without a portal trip. Set \`true\` only if you ship proprietary/non-exempt encryption; Launch then stops and points you to the portal, since genuine non-exempt encryption requires documentation Apple's API can't accept. Defaults to \`false\`.`,
    }),
  ),
  releaseNotes: Schema.optional(
    described(
      Schema.Union(Schema.String, StringMap),
      `Release notes ("What's New in This Version"), per App Store locale (e.g. \`{ "en-US": "Bug fixes." }\`) or a single string applied to {@link ReleaseConfig.primaryLocale}. When absent, Launch reuses the previous version's notes so a release never ships an empty "What's New". Apple stores these on the version's localization, not the version itself.`,
    ),
  ),
  primaryLocale: Schema.optional(
    Schema.String.annotations({
      description:
        'Primary App Store locale for a bare-string {@link ReleaseConfig.releaseNotes}. Defaults to `en-US`.',
    }),
  ),
}).annotations({
  identifier: 'ReleaseConfig',
  description: `iOS public-release policy, declared under {@link LaunchConfig.release}. These are the defaults \`launch release\` applies to the App Store version it submits; every field is optional, so an absent \`release\` block means "go live after approval, all at once" - the safe, common case. Android release policy is unaffected (it rides on the Play track + \`--rollout\`, see {@link AndroidReleaseOptions}). Scope: this drives an UPDATE to an already-configured app. A brand-new app's first submission still needs portal-only steps (screenshots, age rating, signed agreements) and the app record itself - which Apple has no API to create - so \`launch release\` detects that and prints a one-time checklist.`,
});
const NotifyConfigEffectSchema = Schema.Struct({
  webhookUrl: Schema.optional(
    Schema.String.annotations({
      description:
        'Incoming-webhook URL posted a JSON body on each transition. The payload carries both `text` (Slack) and `content` (Discord) set to a human summary, plus the structured event fields, so a Slack or Discord webhook renders it directly and a custom endpoint can read the typed data.',
    }),
  ),
  command: Schema.optional(
    Schema.String.annotations({
      description:
        'Shell command run on each transition with the event in its environment as `LAUNCH_*` vars (`LAUNCH_EVENT`, `LAUNCH_STATUS`, `LAUNCH_APP`, `LAUNCH_VERSION`; plus `LAUNCH_BUILD_NUMBER`, `LAUNCH_DESTINATION`, `LAUNCH_ERROR` on build/submit, or `LAUNCH_DETAIL` on review/rollout). Runs under `/bin/sh -c`, like a git hook.',
    }),
  ),
  events: Schema.optional(
    described(
      Schema.Array(Schema.Literal('build', 'submit', 'review', 'rollout')),
      'Which transitions fire a notification. Absent = all.',
    ),
  ),
}).annotations({
  identifier: 'NotifyConfig',
  description: `Transition notifications - the EAS-\`webhook\` parity hook, declared under {@link LaunchConfig.notify}. Fires on the milestones a dev waits on: a build/submit finishing, an App Store review reaching a verdict, and a phased rollout changing state. A local Mac build can run many minutes and Apple's verdict lands hours later; this pings on each transition. All fields are optional and independent: set a \`webhookUrl\`, a \`command\`, both, or (absent) get the silent default; restrict which transitions fire with \`events\`. Fired on success AND failure; never blocks or fails the run (best-effort).`,
});
const AchievementConfigEffectSchema = Schema.Struct({
  vendorIdentifier: Schema.String.annotations({
    description: `Developer-chosen stable id used to match config to Apple's record (never shown to players).`,
  }),
  referenceName: Schema.String.annotations({
    description: 'Internal name shown in App Store Connect.',
  }),
  points: Schema.Number.annotations({
    description: 'Points awarded (Apple caps the total across achievements at 1000).',
  }),
  showBeforeEarned: Schema.optional(
    Schema.Boolean.annotations({
      description: `Whether the achievement is visible to players before it's earned (default false).`,
    }),
  ),
  repeatable: Schema.optional(
    Schema.Boolean.annotations({
      description: 'Whether it can be earned more than once (default false).',
    }),
  ),
  name: Schema.String.annotations({ description: 'Player-facing title in the localization.' }),
  beforeEarnedDescription: Schema.String.annotations({
    description: 'Player-facing description shown before the achievement is earned.',
  }),
  afterEarnedDescription: Schema.String.annotations({
    description: `Player-facing description shown after it's earned.`,
  }),
  locale: Schema.optional(
    Schema.String.annotations({
      description: 'Locale for the localization above (default `en-US`).',
    }),
  ),
}).annotations({
  identifier: 'AchievementConfig',
  description: `One declared Game Center achievement: Apple's create attributes plus its default-locale localization.`,
});
const LeaderboardConfigEffectSchema = Schema.Struct({
  vendorIdentifier: Schema.String,
  referenceName: Schema.String,
  defaultFormatter: described(
    Schema.Literal(...LEADERBOARD_FORMATTERS),
    'How scores are formatted (e.g. `INTEGER`, `ELAPSED_TIME_SECOND`).',
  ),
  submissionType: described(
    Schema.Literal(...LEADERBOARD_SUBMISSION_TYPES),
    `Whether the board keeps each player's best or most recent score.`,
  ),
  scoreSortType: described(
    Schema.Literal(...LEADERBOARD_SORT_TYPES),
    'Whether higher (`DESC`) or lower (`ASC`) scores rank first.',
  ),
  name: Schema.String.annotations({ description: 'Player-facing title in the localization.' }),
  locale: Schema.optional(
    Schema.String.annotations({
      description: 'Locale for the localization above (default `en-US`).',
    }),
  ),
}).annotations({
  identifier: 'LeaderboardConfig',
  description: `One declared Game Center leaderboard: Apple's create attributes plus its default-locale localization name.`,
});
const GameCenterConfigEffectSchema = Schema.Struct({
  achievements: Schema.optional(Schema.Array(AchievementConfigEffectSchema)),
  leaderboards: Schema.optional(Schema.Array(LeaderboardConfigEffectSchema)),
}).annotations({
  identifier: 'GameCenterConfig',
  description: `An app's declared Game Center achievements and leaderboards - the \`gamecenter.config.json\` document, or one entry of {@link LaunchConfig.gameCenter} (keyed by iOS bundle id). Either list may be omitted. Reconciled additively by \`launch game-center\`.`,
});
const AppClipLocalizationConfigEffectSchema = Schema.Struct({
  subtitle: Schema.String,
}).annotations({
  identifier: 'AppClipLocalizationConfig',
  description:
    'One locale of an App Clip card: the subtitle shown under the app name in that locale.',
});
const AppClipConfigEffectSchema = Schema.Struct({
  action: Schema.optional(
    described(
      Schema.Literal(...APP_CLIP_ACTIONS),
      `The card's call-to-action button (\`OPEN\` / \`VIEW\` / \`PLAY\`).`,
    ),
  ),
  localizations: Schema.optional(
    described(
      Schema.Record({ key: Schema.String, value: AppClipLocalizationConfigEffectSchema }),
      'Per-locale card subtitles, keyed by Apple locale (e.g. `en-US`).',
    ),
  ),
}).annotations({
  identifier: 'AppClipConfig',
  description: `One App Clip's declared card metadata. Both fields are optional and reconciled independently, so a clip may declare just an \`action\`, just \`localizations\`, or both.`,
});
const AppClipsConfigEffectSchema = Schema.Struct({
  clips: Schema.Record({ key: Schema.String, value: AppClipConfigEffectSchema }),
}).annotations({
  identifier: 'AppClipsConfig',
  description: `An app's declared App Clips - the \`appclips.config.json\` document, or one entry of {@link LaunchConfig.appClips} (keyed by the parent app's iOS bundle id). Each App Clip is keyed by its own bundle id (e.g. \`com.acme.app.Clip\`), which is how a config entry is matched to the clip the build produced. Reconciled by \`launch app-clips\`.`,
});
const EuDistributionDomainConfigEffectSchema = Schema.Struct({
  domain: Schema.String.annotations({
    description: 'The domain authorized to host distribution packages (e.g. `downloads.acme.com`).',
  }),
  referenceName: Schema.String.annotations({
    description: 'A label shown in App Store Connect to identify the domain.',
  }),
}).annotations({
  identifier: 'EuDistributionDomainConfig',
  description:
    'One authorized EU distribution domain: the host plus a human-readable reference name.',
});
const EuDistributionConfigEffectSchema = Schema.Struct({
  domains: described(
    Schema.Array(EuDistributionDomainConfigEffectSchema),
    'Domains to authorize for EU alternative distribution.',
  ),
}).annotations({
  identifier: 'EuDistributionConfig',
  description: `The team's EU alternative-distribution domains - the \`eu-distribution.config.json\` document, or {@link LaunchConfig.euDistribution}. Team-level (not per-app); reconciled by \`launch eu-distribution\`.`,
});
const WalletIdConfigEffectSchema = Schema.Struct({
  identifier: Schema.String.annotations({
    description:
      'The identifier to register (e.g. `merchant.com.acme.app` or `pass.com.acme.coupon`).',
  }),
  name: Schema.String.annotations({
    description: 'A label shown in App Store Connect / the developer portal.',
  }),
}).annotations({
  identifier: 'WalletIdConfig',
  description:
    'One declared Apple identifier: the reverse-DNS id plus a human-readable name shown in the portal.',
});
const WalletConfigEffectSchema = Schema.Struct({
  merchantIds: Schema.optional(
    described(Schema.Array(WalletIdConfigEffectSchema), 'Apple Pay merchant ids to register.'),
  ),
  passTypeIds: Schema.optional(
    described(Schema.Array(WalletIdConfigEffectSchema), 'Wallet pass type ids to register.'),
  ),
}).annotations({
  identifier: 'WalletConfig',
  description: `The team's Apple Pay merchant ids and Wallet pass type ids - the \`wallet.config.json\` document, or {@link LaunchConfig.wallet}. Team-level; either family may be omitted. Registered by \`launch wallet\`.`,
});
const ReleaseCategoriesEffectSchema = Schema.Struct({
  primary: OptionalString,
  secondary: OptionalString,
}).annotations({
  identifier: 'ReleaseCategories',
  description:
    'Declared primary/secondary App Store categories (`appCategories` ids such as `PRODUCTIVITY`).',
});
const ReleasePricingEffectSchema = Schema.Struct({
  baseTerritory: Schema.optional(
    Schema.String.annotations({
      description: 'Base territory to anchor the price on (default `USA`).',
    }),
  ),
  customerPrice: Schema.Number.annotations({
    description: `The customer-facing price in the base territory; must match one of Apple's price-ladder rungs.`,
  }),
}).annotations({
  identifier: 'ReleasePricing',
  description:
    'Declared base price: a customer price (e.g. `9.99`) in a base territory Apple equalizes from.',
});
const ReviewDetailsConfigEffectSchema = Schema.Struct({
  contactFirstName: OptionalString,
  contactLastName: OptionalString,
  contactPhone: OptionalString,
  contactEmail: OptionalString,
  demoAccountRequired: OptionalBoolean,
  demoAccountName: OptionalString,
  demoAccountPassword: Schema.optional(
    Schema.String.annotations({
      description: `The reviewer demo-account password. Prefer an indirection over a plaintext literal so the secret needn't sit in a repo-committed config (per "secrets never touch the repo"): \`env:VAR_NAME\` reads it from the environment, \`keychain:ACCOUNT\` from the OS keychain - both resolved only at submit time, so a plan never reads or holds it. Any other value is used as a literal (backward compatible).`,
    }),
  ),
  notes: OptionalString,
}).annotations({
  identifier: 'ReviewDetailsConfig',
  description: `Declared App Review details: the contact Apple reaches and the demo account its reviewer signs in with. Field names match Apple's \`appStoreReviewDetails\` attributes verbatim. \`demoAccountPassword\` is never read back from Apple or logged.`,
});
const ReleaseAttributesConfigEffectSchema = Schema.Struct({
  ageRating: Schema.optional(
    described(
      Schema.Record({ key: Schema.String, value: Schema.Union(Schema.String, Schema.Boolean) }),
      `Age-rating answers as Apple's \`name -> value\` map (enum strings or booleans); only changed keys are sent.`,
    ),
  ),
  categories: Schema.optional(ReleaseCategoriesEffectSchema),
  pricing: Schema.optional(ReleasePricingEffectSchema),
  reviewDetails: Schema.optional(ReviewDetailsConfigEffectSchema),
}).annotations({
  identifier: 'ReleaseAttributesConfig',
  description: `An app's declared App Store *release attributes* - age rating, App Store categories, base price, and App Review details - the \`release.config.json\` document, or one entry of {@link LaunchConfig.releaseAttributes} (keyed by iOS bundle id). Every section is optional and reconciled independently by \`launch release-config\`, so a file may declare only the attribute(s) you manage as code (e.g. just \`pricing\`). Named to avoid colliding with {@link ReleaseConfig}, which is the distinct iOS *release policy* (when/how a version goes live).`,
});
const SurfaceConfigFilesEffectSchema = Schema.Struct({
  availability: OptionalString,
  accessibility: OptionalString,
  experiments: OptionalString,
  customPages: OptionalString,
}).annotations({
  identifier: 'SurfaceConfigFiles',
  description:
    'Where the sidecar-only surfaces keep their `*.config.json` desired-state files when not at the default filename. These surfaces have no typed field on {@link LaunchConfig}, so without this map a non-interactive caller - chiefly `launch plan` / `launch drift`, which has no per-surface `--config` flag - can only find a sidecar at its default name. Declaring a path here makes `plan` read the same file the command would (the existing `resolveSidecarConfig` consumes it). Each entry is optional; omit the whole map to use defaults (`availability.config.json`, `accessibility.config.json`, `experiments.config.json`, `custom-pages.config.json`).',
});
const McpConfigEffectSchema = Schema.Struct({
  capabilities: Schema.optional(
    described(
      Schema.Array(Schema.Literal('read', 'dryRun', 'write', 'dangerous')),
      `Which capability tiers the MCP server may expose. Each enabled tier unlocks the tools tagged at that tier; omit (or \`[]\`) for \`["read"]\` - read-only. Listing a higher tier does not imply the lower ones, so \`["read", "write"]\` is the usual "let agents read everything and run reconciles" posture.`,
    ),
  ),
}).annotations({
  identifier: 'McpConfig',
  description: `The \`mcp\` block of \`launch.config.ts\` - how \`launch mcp\` exposes Launch to AI agents. Absent means least privilege: the server offers only \`read\`-tier tools, so wiring up an agent can never mutate a store until the operator widens {@link McpConfig.capabilities} on purpose. Declared here (not inline in the command) so #173's generator emits it into the config schema and \`launch config validate/docs\` cover it for free.`,
});
const AwsConfigEffectSchema = Schema.Struct({
  region: Schema.String.annotations({
    description: 'AWS region to allocate the Dedicated Host in (e.g. `us-east-1`).',
  }),
  profile: Schema.optional(
    Schema.String.annotations({
      description:
        'Named profile in `~/.aws` to resolve via the credential chain. Omit to use the default chain.',
    }),
  ),
  amiId: Schema.optional(
    Schema.String.annotations({
      description:
        'BYO golden AMI id. Omit to bootstrap + snapshot one into your own account on first use.',
    }),
  ),
  instanceType: Schema.optional(
    Schema.String.annotations({
      description:
        'EC2 Mac instance type. Defaults to `mac2.metal` (cheapest M-series in most regions).',
    }),
  ),
}).annotations({
  identifier: 'AwsConfig',
  description:
    'AWS settings for the EC2 Mac compute host, declared in `launch.config.ts` under `aws`. Launch stores NO AWS secrets: credentials resolve through the standard SDK chain (env -> `~/.aws` profiles -> SSO -> IMDS). `amiId` is an optional BYO golden image; omit it to let Launch bootstrap one and persist its id to `~/.launch/cloud.json`.',
});
const StorageConfigEffectSchema = Schema.Struct({
  endpoint: Schema.optional(
    Schema.String.annotations({
      description:
        'S3-compatible endpoint, e.g. `https://<account>.r2.cloudflarestorage.com` (Cloudflare R2), a Backblaze B2 / MinIO endpoint, etc. Omit for AWS S3 (the SDK derives it from the region). Unused by the `supabase` provider.',
    }),
  ),
  bucket: Schema.String.annotations({
    description: 'Bucket name (S3-compatible) or storage bucket id (Supabase).',
  }),
  region: Schema.optional(
    Schema.String.annotations({
      description:
        'Region for an S3-compatible provider. Defaults to `auto` (correct for R2) when omitted; unused by Supabase.',
    }),
  ),
  publicBaseUrl: Schema.String.annotations({
    description:
      'Public base URL that maps to the bucket root - used to build install links and OTA manifest URLs. e.g. an R2 custom domain `https://cdn.example.com`, or a Supabase public object URL prefix `https://<project>.supabase.co/storage/v1/object/public/<bucket>`. No trailing slash required.',
  }),
  supabaseUrl: Schema.optional(
    Schema.String.annotations({
      description:
        'Supabase project URL (`https://<project>.supabase.co`). Required by `supabase`, unused by `s3`.',
    }),
  ),
}).annotations({
  identifier: 'StorageConfig',
  description:
    'Non-secret settings for a cloud {@link StorageProvider}. Launch writes static artifacts (install plists, OTA manifests, JS bundles, IPAs/AABs) here and serves them from {@link StorageConfig.publicBaseUrl}, so the user owns the infra (no Launch-hosted server). Credentials are NEVER stored here - the S3 access key / Supabase service key resolve from env vars or the OS secret store at call time.',
});
/**
 * Effect Schema source of truth for the authoring shape and decoded runtime config.
 */
export const LaunchConfigEffectSchema = Schema.Struct({
  profiles: described(
    Schema.Record({ key: Schema.String, value: BuildProfileEffectSchema }),
    'Build profiles keyed by name.',
  ),
  credentials: Schema.optionalWith(
    described(
      Schema.String,
      'Registered name of the credentials provider to use. Defaults to `local` (serves both platforms).',
    ),
    {
      default: () => DEFAULT_CREDENTIALS_PROVIDER,
    },
  ),
  storage: Schema.optionalWith(
    described(
      Schema.String,
      'Registered name of the artifact storage provider to use. Defaults to `local`.',
    ),
    {
      default: () => DEFAULT_STORAGE_PROVIDER,
    },
  ),
  buildEngine: Schema.optionalWith(
    described(
      Schema.String,
      'Registered name of the build engine. Carries the iOS default `fastlane` (or `eas` for the cloud handoff); an Android build swaps that iOS baseline for its twin `gradle` unless overridden here.',
    ),
    {
      default: () => DEFAULT_BUILD_ENGINE,
    },
  ),
  submit: Schema.optionalWith(
    described(
      Schema.Union(Schema.String, SubmitByPlatformEffectSchema),
      'Where built artifacts are submitted, in one of two forms: a single registered submitter name (the iOS default `app-store-connect`, which an Android build swaps for its twin `google-play`; or `eas`) - the original, unchanged shape; or a per-platform {@link SubmitByPlatform} map, to fan one build out to several stores from this one config (e.g. an Android `.aab` to `google-play` and `amazon-appstore`). The pipeline resolves this to a store list per platform (see `resolveSubmitters`), so the build target and the store are no longer welded 1:1. See `docs/adr/0006-platform-store-split.md`.',
    ),
    { default: () => DEFAULT_SUBMITTER },
  ),
  appRoots: Schema.optional(
    described(
      Schema.Array(Schema.String),
      'Glob roots to scan for apps. Defaults to the repo root.',
    ),
  ),
  products: Schema.optional(
    described(
      Schema.Record({ key: Schema.String, value: AppProductsEffectSchema }),
      `Declarative App Store Connect product catalog, keyed by iOS bundle id. Drives \`launch sync\`, which reconciles each app's subscriptions, in-app purchases, and pricing on App Store Connect to match this. Absent for apps that sell nothing. See {@link AppProducts}.`,
    ),
  ),
  notify: Schema.optional(
    described(
      NotifyConfigEffectSchema,
      'Build/submit completion notifications (webhook + shell hook). Absent = no notifications. See {@link NotifyConfig}.',
    ),
  ),
  release: Schema.optional(
    described(
      ReleaseConfigEffectSchema,
      'iOS public-release policy for `launch release` (release type, scheduled date, phased rollout, export compliance, release notes). Absent = the safe defaults (go live after approval, all at once). See {@link ReleaseConfig}.',
    ),
  ),
  gameCenter: Schema.optional(
    described(
      Schema.Record({ key: Schema.String, value: GameCenterConfigEffectSchema }),
      'Game Center achievements & leaderboards, keyed by iOS bundle id. Drives `launch game-center`. The single-config form of `gamecenter.config.json` (still accepted for back-compat). See {@link GameCenterConfig}.',
    ),
  ),
  appClips: Schema.optional(
    described(
      Schema.Record({ key: Schema.String, value: AppClipsConfigEffectSchema }),
      `App Clip card metadata, keyed by the parent app's iOS bundle id. Drives \`launch app-clips\`. The single-config form of \`appclips.config.json\` (still accepted for back-compat). See {@link AppClipsConfig}.`,
    ),
  ),
  releaseAttributes: Schema.optional(
    described(
      Schema.Record({ key: Schema.String, value: ReleaseAttributesConfigEffectSchema }),
      'App Store release attributes (age rating, categories, price, review details), keyed by iOS bundle id. Drives `launch release-config`. The single-config form of `release.config.json` (still accepted for back-compat). Distinct from {@link LaunchConfig.release} (the release policy). See {@link ReleaseAttributesConfig}.',
    ),
  ),
  wallet: Schema.optional(
    described(
      WalletConfigEffectSchema,
      'Team-level Apple Pay merchant ids & Wallet pass type ids. Drives `launch wallet`. The single-config form of `wallet.config.json` (still accepted for back-compat). See {@link WalletConfig}.',
    ),
  ),
  euDistribution: Schema.optional(
    described(
      EuDistributionConfigEffectSchema,
      'Team-level EU alternative-distribution domains (DMA). Drives `launch eu-distribution`. The single-config form of `eu-distribution.config.json` (still accepted for back-compat). See {@link EuDistributionConfig}.',
    ),
  ),
  configFiles: Schema.optional(
    described(
      SurfaceConfigFilesEffectSchema,
      `Optional non-default paths for the sidecar-only surfaces' \`*.config.json\` files (availability, accessibility, experiments, custom pages). Lets \`launch plan\` / \`launch drift\` find a sidecar that isn't at its default filename, since those surfaces have no typed field here. Omit to use defaults. See {@link SurfaceConfigFiles}.`,
    ),
  ),
  aws: Schema.optional(
    described(
      AwsConfigEffectSchema,
      'AWS EC2 Mac settings for remote (off-Mac) builds. Only needed when building via `--remote aws`.',
    ),
  ),
  storageConfig: Schema.optional(
    described(
      StorageConfigEffectSchema,
      `Bucket/endpoint settings for a cloud {@link StorageProvider} (\`s3\` / \`supabase\`). Required when \`storage\` names a cloud provider - it's where ad-hoc install links and OTA update manifests are hosted. Secrets stay out: access keys resolve from env / the OS secret store, never from here.`,
    ),
  ),
  artifactDir: Schema.optional(
    Schema.String.annotations({
      description:
        'Where the `local` storage provider writes build binaries and raw objects (install plists, OTA manifests). A relative path resolves against the project root (the `launch.config.ts` directory); a leading `~/` expands to the home directory; an absolute path is used as-is. Omit to use the global `~/.launch/artifacts` (the default - existing projects are unaffected). `launch init` and the no-args wizard scaffold this as the in-repo `./.launch/artifacts` and add it to `.gitignore`, so build binaries never get committed. Only the `local` provider observes it - cloud stores key off {@link StorageConfig}. The history index stays under `~/.launch`, so build history and retention span projects regardless of where the binaries land.',
    }),
  ),
  artifactRetentionDays: Schema.optional(
    Schema.Number.annotations({
      description:
        'How many days a local build binary is kept before the artifact store auto-prunes it to reclaim disk (the newest build per app+platform is always kept, so a promotable artifact never disappears). Runs after each successful local build. Defaults to 30 when omitted; set to `0` to disable the automatic sweep entirely (`launch builds prune` still works on demand). Only the `local` provider observes this - cloud stores manage retention through their own bucket lifecycle rules.',
    }),
  ),
  envExclude: Schema.optional(
    described(
      Schema.Array(Schema.String),
      `Env var names that must NEVER be injected into a build - a hard denylist applied across every layer (\`.env\`, \`.env.<profile>\`, keychain, profile \`env:\`, even an explicit \`--env\`). A matched name is dropped outright, so it can't reach the build subprocess and therefore can't be baked into the shipped app even by an \`app.config.js\` that forwards environment variables.

Each entry is either an exact, case-sensitive name or a \`PREFIX*\` wildcard: \`OPENAI_*\` drops every name starting with \`OPENAI_\` (e.g. \`OPENAI_API_KEY\`, \`OPENAI_ORG_ID\`), so a whole family of backend keys collapses to one line instead of being listed individually. Wildcards anchor at the START - there is no tail/\`*_KEY\` form, by design, since that would also snag a publishable \`EXPO_PUBLIC_..._KEY\`.

This is the home for *backend-only* values that sit in the app's \`.env\` for local tooling but must never ship (e.g. \`OPENAI_API_KEY\`, a server-side \`SENTRY_AUTH_TOKEN\`). It is distinct from \`launch secret set\`: a stored secret is still *injected* - the build needs it - it's just moved out of plaintext; \`envExclude\` means "don't inject this at all". A name matched here is exempt from the \`.env.example\` missing-key gate (even when no layer sets it). Omit (or \`[]\`) to exclude nothing.`,
    ),
  ),
  mcp: Schema.optional(
    described(
      McpConfigEffectSchema,
      'How `launch mcp` exposes Launch to AI agents - chiefly which capability tiers it may offer. Absent = least privilege (read-only tools). See {@link McpConfig}.',
    ),
  ),
}).annotations({
  identifier: 'LaunchConfig',
  description:
    'The fully-resolved configuration for one `launch` invocation. Produced by {@link loadConfig} from `launch.config.ts` plus auto-discovered apps. Names here (`storage`, `credentials`, `buildEngine`) are looked up in the provider registry at runtime.',
});
export type ParsedLaunchConfig = Schema.Schema.Type<typeof LaunchConfigEffectSchema>;
export type LaunchConfigEffectInput = Schema.Schema.Encoded<typeof LaunchConfigEffectSchema>;
export const parseLaunchConfig = (
  candidateConfig: unknown,
): Effect.Effect<ParsedLaunchConfig, ParseResult.ParseError> => {
  return Schema.decodeUnknown(LaunchConfigEffectSchema, CONFIG_PARSE_OPTIONS)(candidateConfig);
};
export const validateLaunchConfig = (candidateConfig: unknown): SchemaViolation[] => {
  const decodedConfig = Schema.decodeUnknownEither(
    LaunchConfigEffectSchema,
    CONFIG_PARSE_OPTIONS,
  )(candidateConfig);
  if (decodedConfig._tag === 'Right') return [];
  return parseIssueToViolations(decodedConfig.left.issue, []);
};
const parseIssueToViolations = (
  parseIssue: ParseResult.ParseIssue,
  parentPath: PropertyKey[],
): SchemaViolation[] => {
  switch (parseIssue._tag) {
    case 'Composite':
      return parseIssuesToViolations(parseIssue.issues, parentPath);
    case 'Pointer':
      return parseIssueToViolations(parseIssue.issue, [
        ...parentPath,
        ...pathSegments(parseIssue.path),
      ]);
    case 'Refinement':
    case 'Transformation':
      return parseIssueToViolations(parseIssue.issue, parentPath);
    case 'Unexpected':
      return [{ path: formatPath(parentPath), message: 'unknown property' }];
    case 'Missing': {
      let message = parseIssue.message;
      if (message === undefined) message = 'is required';
      return [{ path: formatPath(parentPath), message }];
    }
    case 'Type':
    case 'Forbidden': {
      let message = parseIssue.message;
      if (message === undefined) message = 'invalid value';
      return [{ path: formatPath(parentPath), message }];
    }
  }
};
const pathSegments = (path: ParseResult.Path): PropertyKey[] => {
  const pathValue: PropertyKey | readonly PropertyKey[] = path;
  if (typeof pathValue === 'string') return [pathValue];
  if (typeof pathValue === 'number') return [pathValue];
  if (typeof pathValue === 'symbol') return [pathValue];
  return [...pathValue];
};
const parseIssuesToViolations = (
  parseIssues: ParseResult.SingleOrNonEmpty<ParseResult.ParseIssue>,
  parentPath: PropertyKey[],
): SchemaViolation[] => {
  let issueList: readonly ParseResult.ParseIssue[];
  if ('_tag' in parseIssues) issueList = [parseIssues];
  else issueList = parseIssues;
  return issueList.flatMap((nestedIssue) => parseIssueToViolations(nestedIssue, parentPath));
};
const formatPath = (path: readonly PropertyKey[]): string => {
  let formattedPath = '';
  for (const pathSegment of path) {
    if (typeof pathSegment === 'number') {
      formattedPath += `[${pathSegment}]`;
    } else if (typeof pathSegment === 'string' && /^[A-Za-z_$][\w$]*$/.test(pathSegment)) {
      if (formattedPath) formattedPath += `.${pathSegment}`;
      else formattedPath += pathSegment;
    } else {
      formattedPath += `[${JSON.stringify(String(pathSegment))}]`;
    }
  }
  return formattedPath;
};
