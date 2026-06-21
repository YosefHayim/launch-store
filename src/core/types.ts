/**
 * Central domain types and the four provider interfaces that make Launch's
 * infrastructure pluggable.
 *
 * Everything Launch does flows through these shapes, so this file is the single
 * source of truth for the vocabulary: a build has a {@link ResolvedBuildContext},
 * it produces a {@link BuildArtifact} with a {@link SizeReport}, and each
 * swappable backend implements one of {@link CredentialsProvider},
 * {@link BuildEngine}, {@link StorageProvider}, or {@link Submitter}.
 */

// The five Launch-native config sections folded in from their JSON sidecars (issue #101) reuse the
// App Store Connect schema enums that `apple/ascClient.ts` owns and guards against the generated
// OpenAPI types. This is a type-only import (erased at build, no runtime dependency or cycle), and it
// keeps the enums single-sourced where they're validated rather than duplicating Apple's lists here.
import type {
  AgeRatingValue,
  AppClipActionValue,
  LeaderboardFormatter,
  LeaderboardSortType,
  LeaderboardSubmissionType,
} from "../apple/ascClient.js";

/** Target mobile platform. iOS can only be built (signed) on macOS; Android builds on any OS. */
export type Platform = "ios" | "android";

/**
 * Where an iOS build runs, as picked in the `launch` wizard. `local` is the host Mac's own Xcode;
 * `aws` and `ssh` are remote Macs; `eas` hands the build off to Expo's cloud. Android always builds
 * locally (gradle on the host), so this only varies for iOS. Persisted in a remembered wizard flow
 * (see {@link import("./lastRun.js").LastFlow}) so the next run can replay it.
 */
export type BuildLocation = "local" | "aws" | "ssh" | "eas";

/**
 * How a build is distributed.
 * - `store`: the normal path — App Store/TestFlight (iOS) or a Play track (Android). The default.
 * - `internal`: an install link for registered testers — an ad-hoc-signed `.ipa` (iOS, valid only for
 *   the devices on the ad-hoc profile) or a directly-installable `.apk` (Android), hosted on the
 *   user's own bucket with an `itms-services` manifest + landing page. The EAS "internal distribution"
 *   equivalent, with no shared cloud queue.
 */
export type Distribution = "store" | "internal";

/**
 * Where a submission lands, neutrally named and mapped to each store by the platform's submitter.
 * - `testing`: a testing track (iOS → TestFlight; Android → the chosen {@link PlayTrack}, default
 *   `internal`). The default, safe path.
 * - `production`: the store's public release queue (iOS App Store review / Android production track).
 *   Reached only by the deliberate `launch release` command.
 */
export type SubmitTarget = "testing" | "production";

/**
 * A Google Play release track. `internal` is the safe default: a new personal Play account must run
 * ~20 testers for 14 days on a testing track before production is unlocked, so defaulting anywhere
 * else would fail for fresh accounts. Has no iOS equivalent.
 */
export type PlayTrack = "internal" | "closed" | "open" | "production";

/**
 * Which web console page `launch open` deep-links to. Each value maps to a per-platform URL in
 * `core/consoleLinks.ts` — the connective tissue between a read-only finding ("agreement unsigned")
 * and the irreducible UI step that fixes it. `asc` / `play` are the platform consoles' home for the
 * app; the rest target a specific section:
 * - `asc`: the app's App Store Connect overview (Apple) — the default target.
 * - `play`: the Google Play Console (Android's equivalent of `asc`).
 * - `testflight`: the app's TestFlight tab (iOS only — Android testing lives on Play tracks).
 * - `listing`: the App Store / Play store-listing page where copy and screenshots are edited.
 * - `reviews`: the app's ratings-and-reviews page.
 * - `agreements`: the account's agreements, tax, and banking page (no per-app id).
 * - `app-record`: the app's record page — the one step the API can't create (see the `app-record` glossary topic).
 */
export type OpenTarget = "asc" | "play" | "testflight" | "listing" | "reviews" | "agreements" | "app-record";

/**
 * Resolved Android release settings for one invocation, carried on {@link ResolvedBuildContext} so the
 * Google Play submitter reads a single source of truth. Resolved from `--track`/`--rollout`, then the
 * profile's defaults, then the safe fallback. Present only for Android builds; absent on iOS.
 */
export interface AndroidReleaseOptions {
  /** The Play track this build is assigned to. */
  track: PlayTrack;
  /** Staged-rollout fraction for a production release, 0–1 (`1` = full rollout). Ignored off production. */
  rollout: number;
}

/**
 * One app discovered in the surrounding monorepo.
 *
 * Launch auto-discovers these by scanning for `app.json`/`app.config` files, so the
 * facts here (bundle id, version) come straight from Expo's config and are never
 * duplicated in Launch's own config — `app.json` stays the single source of truth.
 */
export interface AppDescriptor {
  /** Short, unique handle used on the CLI (`launch build ios --app <name>`). Derived from the app slug. */
  name: string;
  /** Absolute path to the app's project directory (the folder containing its `app.json`). */
  dir: string;
  /** Absolute path to the discovered `app.json` / `app.config.*`. */
  configPath: string;
  /** iOS bundle identifier (`ios.bundleIdentifier`), e.g. `com.loopi.pomedero`. Undefined for Android-only apps. */
  bundleId?: string;
  /** Android application id (`android.package`), e.g. `com.loopi.pomedero`. Undefined for iOS-only apps. */
  packageName?: string;
  /** Human version string (`expo.version`), e.g. `1.0.0`. */
  version?: string;
  /**
   * The app's iOS entitlements (`ios.entitlements` from `app.json`/`app.config`), verbatim. This is the
   * single source of truth for which capabilities `launch sync` enables on the bundle id — read from
   * the app's own Expo config (exactly where EAS reads them), never redeclared in `launch.config.ts`.
   * Absent when the app declares no entitlements.
   */
  iosEntitlements?: Record<string, unknown>;
  /**
   * Bundle identifiers of the app's embedded iOS app-extension targets (WidgetKit widgets, share /
   * notification extensions, …), e.g. `["com.loopi.pomedero.widget"]`. Each is provisioned exactly like
   * the main bundle (App ID → capabilities → App Store profile, reusing the team's one distribution
   * certificate) and added to the export-options `provisioningProfiles` map so `xcodebuild` can sign the
   * whole `.ipa`. Declared explicitly under the app's own Expo config (`ios.extensions`) so it stays
   * beside the bundle id it extends — read here rather than auto-discovered from the generated
   * `.xcodeproj`, since that project may not exist yet at provisioning time and its `project.pbxproj` is
   * a fragile, custom format to parse. Absent when the app has no extension targets.
   */
  iosExtensions?: string[];
  /**
   * Android `versionCode` floor from `app.json` (`android.versionCode`). The store's latest + 1 wins
   * when higher, so an intentional local bump is never clobbered but the store stays the source of truth.
   */
  androidVersionCode?: number;
  /**
   * Export-compliance answer from `app.json` (`ios.config.usesNonExemptEncryption`) — the standard Expo
   * field that becomes `ITSAppUsesNonExemptEncryption` in the built `Info.plist`. Read from the app's own
   * Expo config (exactly where EAS reads it), never redeclared in `launch.config.ts`. `false` means the
   * app uses no encryption, or only exempt encryption, so the binary self-answers the export-compliance
   * question and no per-upload prompt appears; `true` means it uses non-exempt encryption and needs a
   * formal {@link https://developer.apple.com/documentation/appstoreconnectapi/appencryptiondeclaration App Encryption Declaration}.
   * Absent when the app leaves the field unset — then App Store Connect re-asks the question on every
   * upload (see `core/exportCompliance.ts`). iOS only.
   */
  usesNonExemptEncryption?: boolean;
}

/**
 * A named build profile from `launch.config.ts` (e.g. `production`, `preview`).
 *
 * Holds only Launch-specific settings; app facts stay in `app.json`. A profile maps to a
 * `.env` file whose values are injected into the build and gates the artifact on size.
 */
export interface BuildProfile {
  /** Profile name as referenced by `--profile`. */
  name: string;
  /** Dotenv file to load for this profile, relative to the app dir. Defaults to `.env`. */
  envFile?: string;
  /**
   * Inline env vars for this profile, merged into the build/update/release environment. They sit
   * above the dotenv files (`.env.local`, `.env.<profile>`, `.env`) but below keychain secrets and
   * `--env` flags in the precedence ladder — see `core/env.ts` `resolveEnv`. Use for non-secret,
   * committed config that should travel with the profile; keep real secrets in `launch secret`.
   */
  env?: Record<string, string>;
  /** Enable SSL pinning for this profile (mirrors the existing build.ts toggle). Defaults to false. */
  ssl?: boolean;
  /**
   * Per-device download-size budget in megabytes. When the size report exceeds it, the build
   * soft-gates (asks for confirmation) rather than failing. Defaults to 200 (Apple's cellular line).
   */
  sizeBudgetMB?: number;
  /**
   * Android-only: default Play track for `launch build android` when `--track` is omitted. Defaults
   * to `internal` (the only safe target for a fresh account). Ignored on iOS.
   */
  track?: PlayTrack;
  /**
   * Android-only: default staged-rollout fraction (0–1) for production releases when `--rollout` is
   * omitted. Defaults to `1.0` (full rollout). Ignored on iOS.
   */
  rollout?: number;
}

/* -------------------------------------------------------------------------- */
/*  App Store Connect product catalog — the declarative input to `launch sync`. */
/*  These shapes describe the DESIRED state of an app's monetization on ASC;    */
/*  the reconciler (core/ascSync.ts) diffs them against the live account and     */
/*  applies the difference. Capabilities are intentionally absent here — they    */
/*  derive from each app's `app.json` entitlements (see AppDescriptor).          */
/* -------------------------------------------------------------------------- */

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

/**
 * How an approved iOS build reaches the public App Store — the App Store version's `releaseType`,
 * mirroring Apple's enum on the `appStoreVersions` resource. Read by `launch release`, overridable
 * per-run with `--manual` / `--scheduled <iso>`.
 * - `AFTER_APPROVAL`: go live automatically the moment Apple approves. Launch's default — the
 *   hands-off path most solo developers want.
 * - `MANUAL`: hold after approval until you press release (`launch status` shows it's pending). Use
 *   to line the go-live up with a marketing moment.
 * - `SCHEDULED`: go live at a fixed future instant, set via {@link ReleaseConfig.earliestReleaseDate}.
 */
export type ReleaseType = "AFTER_APPROVAL" | "MANUAL" | "SCHEDULED";

/**
 * iOS public-release policy, declared under {@link LaunchConfig.release}. These are the defaults
 * `launch release` applies to the App Store version it submits; every field is optional, so an absent
 * `release` block means "go live after approval, all at once" — the safe, common case. Android release
 * policy is unaffected (it rides on the Play track + `--rollout`, see {@link AndroidReleaseOptions}).
 *
 * Scope: this drives an UPDATE to an already-configured app. A brand-new app's first submission still
 * needs portal-only steps (screenshots, age rating, signed agreements) and the app record itself —
 * which Apple has no API to create — so `launch release` detects that and prints a one-time checklist.
 */
export interface ReleaseConfig {
  /** How an approved build reaches the store. Defaults to `AFTER_APPROVAL`. Overridable with `--manual`/`--scheduled`. */
  releaseType?: ReleaseType;
  /**
   * ISO-8601 instant to go live at — only meaningful with `releaseType: "SCHEDULED"` (ignored otherwise).
   * A `--scheduled <iso>` flag sets both this and the release type for one run.
   */
  earliestReleaseDate?: string;
  /**
   * Opt into Apple's 7-day phased release (a gradual percentage rollout) for an approved update.
   * Defaults to `false` — an immediate 100% release. Overridable per-run with `--phased`, and steerable
   * afterward with `launch rollout <pause|resume|complete>`. Ignored for a first version (Apple only
   * phases updates).
   */
  phasedRelease?: boolean;
  /**
   * Whether the binary contains non-exempt encryption (Apple's export-compliance question). `false` —
   * the common case for apps using only standard HTTPS/system crypto — lets Launch declare compliance
   * over the API so the build clears `WAITING_FOR_EXPORT_COMPLIANCE` without a portal trip. Set `true`
   * only if you ship proprietary/non-exempt encryption; Launch then stops and points you to the portal,
   * since genuine non-exempt encryption requires documentation Apple's API can't accept. Defaults to `false`.
   */
  usesNonExemptEncryption?: boolean;
  /**
   * Release notes ("What's New in This Version"), per App Store locale (e.g. `{ "en-US": "Bug fixes." }`)
   * or a single string applied to {@link ReleaseConfig.primaryLocale}. When absent, Launch reuses the
   * previous version's notes so a release never ships an empty "What's New". Apple stores these on the
   * version's localization, not the version itself.
   */
  releaseNotes?: string | Record<string, string>;
  /** Primary App Store locale for a bare-string {@link ReleaseConfig.releaseNotes}. Defaults to `en-US`. */
  primaryLocale?: string;
}

/**
 * Build/submit completion notifications — the EAS-`webhook` parity hook, declared under
 * {@link LaunchConfig.notify}. A local Mac build can run many minutes; this pings when it finishes.
 * Both fields are optional and independent: set a `webhookUrl`, a `command`, both, or (absent) get
 * the silent default. Fired on success AND failure; never blocks or fails the build (best-effort).
 */
export interface NotifyConfig {
  /**
   * Incoming-webhook URL posted a JSON body on completion. The payload carries both `text` (Slack)
   * and `content` (Discord) set to a human summary, plus the structured event fields, so a Slack or
   * Discord webhook renders it directly and a custom endpoint can read the typed data.
   */
  webhookUrl?: string;
  /**
   * Shell command run on completion with the event in its environment as `LAUNCH_*` vars
   * (`LAUNCH_EVENT`, `LAUNCH_STATUS`, `LAUNCH_APP`, `LAUNCH_VERSION`, `LAUNCH_BUILD_NUMBER`,
   * `LAUNCH_DESTINATION`, `LAUNCH_ERROR`). Runs under `/bin/sh -c`, like a git hook.
   */
  command?: string;
}

// ── Launch-native App Store Connect config sections ────────────────────────────────────────────────
// Each section below is reconciled to App Store Connect by its own command and can be declared either
// as a typed field on {@link LaunchConfig} (the single-config path) or, for back-compat, as its
// standalone `*.config.json` sidecar. The per-app sections (Game Center, App Clips, release
// attributes) are keyed by iOS bundle id like {@link LaunchConfig.products}; Wallet and EU
// distribution are team-level (one object, no app key). See issue #101.

/** One declared Game Center achievement: Apple's create attributes plus its default-locale localization. */
export interface AchievementConfig {
  /** Developer-chosen stable id used to match config to Apple's record (never shown to players). */
  vendorIdentifier: string;
  /** Internal name shown in App Store Connect. */
  referenceName: string;
  /** Points awarded (Apple caps the total across achievements at 1000). */
  points: number;
  /** Whether the achievement is visible to players before it's earned (default false). */
  showBeforeEarned?: boolean;
  /** Whether it can be earned more than once (default false). */
  repeatable?: boolean;
  /** Player-facing title in the localization. */
  name: string;
  /** Player-facing description shown before the achievement is earned. */
  beforeEarnedDescription: string;
  /** Player-facing description shown after it's earned. */
  afterEarnedDescription: string;
  /** Locale for the localization above (default `en-US`). */
  locale?: string;
}

/** One declared Game Center leaderboard: Apple's create attributes plus its default-locale localization name. */
export interface LeaderboardConfig {
  vendorIdentifier: string;
  referenceName: string;
  /** How scores are formatted (e.g. `INTEGER`, `ELAPSED_TIME_SECOND`). */
  defaultFormatter: LeaderboardFormatter;
  /** Whether the board keeps each player's best or most recent score. */
  submissionType: LeaderboardSubmissionType;
  /** Whether higher (`DESC`) or lower (`ASC`) scores rank first. */
  scoreSortType: LeaderboardSortType;
  /** Player-facing title in the localization. */
  name: string;
  /** Locale for the localization above (default `en-US`). */
  locale?: string;
}

/**
 * An app's declared Game Center achievements and leaderboards — the `gamecenter.config.json` document,
 * or one entry of {@link LaunchConfig.gameCenter} (keyed by iOS bundle id). Either list may be omitted.
 * Reconciled additively by `launch game-center`.
 */
export interface GameCenterConfig {
  achievements?: AchievementConfig[];
  leaderboards?: LeaderboardConfig[];
}

/** One locale of an App Clip card: the subtitle shown under the app name in that locale. */
export interface AppClipLocalizationConfig {
  subtitle: string;
}

/**
 * One App Clip's declared card metadata. Both fields are optional and reconciled independently, so a clip
 * may declare just an `action`, just `localizations`, or both.
 */
export interface AppClipConfig {
  /** The card's call-to-action button (`OPEN` / `VIEW` / `PLAY`). */
  action?: AppClipActionValue;
  /** Per-locale card subtitles, keyed by Apple locale (e.g. `en-US`). */
  localizations?: Record<string, AppClipLocalizationConfig>;
}

/**
 * An app's declared App Clips — the `appclips.config.json` document, or one entry of
 * {@link LaunchConfig.appClips} (keyed by the parent app's iOS bundle id). Each App Clip is keyed by
 * its **own** bundle id (e.g. `com.acme.app.Clip`), which is how a config entry is matched to the clip
 * the build produced. Reconciled by `launch app-clips`.
 */
export interface AppClipsConfig {
  clips: Record<string, AppClipConfig>;
}

/** One authorized EU distribution domain: the host plus a human-readable reference name. */
export interface EuDistributionDomainConfig {
  /** The domain authorized to host distribution packages (e.g. `downloads.acme.com`). */
  domain: string;
  /** A label shown in App Store Connect to identify the domain. */
  referenceName: string;
}

/**
 * The team's EU alternative-distribution domains — the `eu-distribution.config.json` document, or
 * {@link LaunchConfig.euDistribution}. Team-level (not per-app); reconciled by `launch eu-distribution`.
 */
export interface EuDistributionConfig {
  /** Domains to authorize for EU alternative distribution. */
  domains: EuDistributionDomainConfig[];
}

/** One declared Apple identifier: the reverse-DNS id plus a human-readable name shown in the portal. */
export interface WalletIdConfig {
  /** The identifier to register (e.g. `merchant.com.acme.app` or `pass.com.acme.coupon`). */
  identifier: string;
  /** A label shown in App Store Connect / the developer portal. */
  name: string;
}

/**
 * The team's Apple Pay merchant ids and Wallet pass type ids — the `wallet.config.json` document, or
 * {@link LaunchConfig.wallet}. Team-level; either family may be omitted. Registered by `launch wallet`.
 */
export interface WalletConfig {
  /** Apple Pay merchant ids to register. */
  merchantIds?: WalletIdConfig[];
  /** Wallet pass type ids to register. */
  passTypeIds?: WalletIdConfig[];
}

/** Declared primary/secondary App Store categories (`appCategories` ids such as `PRODUCTIVITY`). */
export interface ReleaseCategories {
  primary?: string;
  secondary?: string;
}

/** Declared base price: a customer price (e.g. `9.99`) in a base territory Apple equalizes from. */
export interface ReleasePricing {
  /** Base territory to anchor the price on (default `USA`). */
  baseTerritory?: string;
  /** The customer-facing price in the base territory; must match one of Apple's price-ladder rungs. */
  customerPrice: number;
}

/**
 * Declared App Review details: the contact Apple reaches and the demo account its reviewer signs in
 * with. Field names match Apple's `appStoreReviewDetails` attributes verbatim. `demoAccountPassword` is
 * never read back from Apple or logged.
 */
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
 * An app's declared App Store *release attributes* — age rating, App Store categories, base price, and
 * App Review details — the `release.config.json` document, or one entry of
 * {@link LaunchConfig.releaseAttributes} (keyed by iOS bundle id). Every section is optional and
 * reconciled independently by `launch release-config`, so a file may declare only the attribute(s) you
 * manage as code (e.g. just `pricing`). Named to avoid colliding with {@link ReleaseConfig}, which is
 * the distinct iOS *release policy* (when/how a version goes live).
 */
export interface ReleaseAttributesConfig {
  /** Age-rating answers as Apple's `name → value` map (enum strings or booleans); only changed keys are sent. */
  ageRating?: Record<string, AgeRatingValue>;
  categories?: ReleaseCategories;
  pricing?: ReleasePricing;
  reviewDetails?: ReviewDetailsConfig;
}

/**
 * Where the **sidecar-only** surfaces keep their `*.config.json` desired-state files when not at the
 * default filename. These surfaces have no typed field on {@link LaunchConfig}, so without this map a
 * non-interactive caller — chiefly `launch plan` / `launch drift`, which has no per-surface `--config`
 * flag — can only find a sidecar at its default name. Declaring a path here makes `plan` read the same
 * file the command would (the existing `resolveSidecarConfig` consumes it). Each entry is optional; omit
 * the whole map to use defaults (`availability.config.json`, `accessibility.config.json`,
 * `experiments.config.json`, `custom-pages.config.json`).
 */
export interface SurfaceConfigFiles {
  availability?: string;
  accessibility?: string;
  experiments?: string;
  customPages?: string;
}

/**
 * The capability tiers a tool can require, in ascending order of blast radius — the gate behind
 * `launch mcp`. A tool is tagged with exactly one tier; the MCP server registers only the tools whose
 * tier the user has enabled in {@link McpConfig.capabilities}, so an agent can never reach a write tool
 * the operator didn't opt into.
 * - `read` — pure introspection (plan, audit, doctor): no store or filesystem writes. The safe default.
 * - `dryRun` — rehearses a mutation and reports what it *would* do, still writing nothing.
 * - `write` — reconciles live store state (e.g. `launch sync`): visible, reversible-with-effort changes.
 * - `dangerous` — destructive or hard-to-reverse (deletions, irreversible submissions); opt-in only.
 */
export type McpCapability = "read" | "dryRun" | "write" | "dangerous";

/**
 * The `mcp` block of `launch.config.ts` — how `launch mcp` exposes Launch to AI agents. Absent means
 * least privilege: the server offers only `read`-tier tools, so wiring up an agent can never mutate a
 * store until the operator widens {@link McpConfig.capabilities} on purpose. Declared here (not inline in
 * the command) so #173's generator emits it into the config schema and `launch config validate/docs`
 * cover it for free.
 */
export interface McpConfig {
  /**
   * Which capability tiers the MCP server may expose. Each enabled tier unlocks the tools tagged at that
   * tier; omit (or `[]`) for `["read"]` — read-only. Listing a higher tier does not imply the lower ones,
   * so `["read", "write"]` is the usual "let agents read everything and run reconciles" posture.
   */
  capabilities?: McpCapability[];
}

/**
 * The fully-resolved configuration for one `launch` invocation.
 *
 * Produced by {@link loadConfig} from `launch.config.ts` plus auto-discovered apps. Names here
 * (`storage`, `credentials`, `buildEngine`) are looked up in the provider registry at runtime.
 */
export interface LaunchConfig {
  /** Build profiles keyed by name. */
  profiles: Record<string, BuildProfile>;
  /** Registered name of the credentials provider to use. Defaults to `local` (serves both platforms). */
  credentials: string;
  /** Registered name of the artifact storage provider to use. Defaults to `local`. */
  storage: string;
  /**
   * Registered name of the build engine. Carries the iOS default `fastlane` (or `eas` for the cloud
   * handoff); an Android build swaps that iOS baseline for its twin `gradle` unless overridden here.
   */
  buildEngine: string;
  /**
   * Registered name of the submitter. Carries the iOS default `app-store-connect` (or `eas`); an
   * Android build swaps that iOS baseline for its twin `google-play` unless overridden here.
   */
  submit: string;
  /** Glob roots to scan for apps. Defaults to the repo root. */
  appRoots?: string[];
  /**
   * Declarative App Store Connect product catalog, keyed by iOS bundle id. Drives `launch sync`, which
   * reconciles each app's subscriptions, in-app purchases, and pricing on App Store Connect to match
   * this. Absent for apps that sell nothing. See {@link AppProducts}.
   */
  products?: Record<string, AppProducts>;
  /** Build/submit completion notifications (webhook + shell hook). Absent = no notifications. See {@link NotifyConfig}. */
  notify?: NotifyConfig;
  /**
   * iOS public-release policy for `launch release` (release type, scheduled date, phased rollout,
   * export compliance, release notes). Absent = the safe defaults (go live after approval, all at
   * once). See {@link ReleaseConfig}.
   */
  release?: ReleaseConfig;
  /**
   * Game Center achievements & leaderboards, keyed by iOS bundle id. Drives `launch game-center`. The
   * single-config form of `gamecenter.config.json` (still accepted for back-compat). See {@link GameCenterConfig}.
   */
  gameCenter?: Record<string, GameCenterConfig>;
  /**
   * App Clip card metadata, keyed by the parent app's iOS bundle id. Drives `launch app-clips`. The
   * single-config form of `appclips.config.json` (still accepted for back-compat). See {@link AppClipsConfig}.
   */
  appClips?: Record<string, AppClipsConfig>;
  /**
   * App Store release attributes (age rating, categories, price, review details), keyed by iOS bundle id.
   * Drives `launch release-config`. The single-config form of `release.config.json` (still accepted for
   * back-compat). Distinct from {@link LaunchConfig.release} (the release *policy*). See {@link ReleaseAttributesConfig}.
   */
  releaseAttributes?: Record<string, ReleaseAttributesConfig>;
  /**
   * Team-level Apple Pay merchant ids & Wallet pass type ids. Drives `launch wallet`. The single-config
   * form of `wallet.config.json` (still accepted for back-compat). See {@link WalletConfig}.
   */
  wallet?: WalletConfig;
  /**
   * Team-level EU alternative-distribution domains (DMA). Drives `launch eu-distribution`. The
   * single-config form of `eu-distribution.config.json` (still accepted for back-compat). See {@link EuDistributionConfig}.
   */
  euDistribution?: EuDistributionConfig;
  /**
   * Optional non-default paths for the sidecar-only surfaces' `*.config.json` files (availability,
   * accessibility, experiments, custom pages). Lets `launch plan` / `launch drift` find a sidecar that
   * isn't at its default filename, since those surfaces have no typed field here. Omit to use defaults.
   * See {@link SurfaceConfigFiles}.
   */
  configFiles?: SurfaceConfigFiles;
  /** AWS EC2 Mac settings for remote (off-Mac) builds. Only needed when building via `--remote aws`. */
  aws?: AwsConfig;
  /**
   * Bucket/endpoint settings for a cloud {@link StorageProvider} (`s3` / `supabase`). Required when
   * `storage` names a cloud provider — it's where ad-hoc install links and OTA update manifests are
   * hosted. Secrets stay out: access keys resolve from env / the OS secret store, never from here.
   */
  storageConfig?: StorageConfig;
  /**
   * Where the `local` storage provider writes build binaries and raw objects (install plists, OTA
   * manifests). A relative path resolves against the project root (the `launch.config.ts` directory); a
   * leading `~/` expands to the home directory; an absolute path is used as-is. Omit to use the global
   * `~/.launch/artifacts` (the default — existing projects are unaffected). `launch init` and the no-args
   * wizard scaffold this as the in-repo `./.launch/artifacts` and add it to `.gitignore`, so build
   * binaries never get committed. Only the `local` provider observes it — cloud stores key off
   * {@link StorageConfig}. The history index stays under `~/.launch`, so build history and retention span
   * projects regardless of where the binaries land.
   */
  artifactDir?: string;
  /**
   * How many days a local build binary is kept before the artifact store auto-prunes it to reclaim disk
   * (the newest build per app+platform is always kept, so a promotable artifact never disappears). Runs
   * after each successful local build. Defaults to 30 when omitted; set to `0` to disable the automatic
   * sweep entirely (`launch builds prune` still works on demand). Only the `local` provider observes
   * this — cloud stores manage retention through their own bucket lifecycle rules.
   */
  artifactRetentionDays?: number;
  /**
   * Env var names that must NEVER be injected into a build — a hard denylist applied across every layer
   * (`.env`, `.env.<profile>`, keychain, profile `env:`, even an explicit `--env`). A matched name is
   * dropped outright, so it can't reach the build subprocess and therefore can't be baked into the shipped
   * app even by an `app.config.js` that forwards `process.env`.
   *
   * Each entry is either an exact, case-sensitive name or a `PREFIX*` wildcard: `OPENAI_*` drops every
   * name starting with `OPENAI_` (e.g. `OPENAI_API_KEY`, `OPENAI_ORG_ID`), so a whole family of backend
   * keys collapses to one line instead of being listed individually. Wildcards anchor at the START — there
   * is no tail/`*_KEY` form, by design, since that would also snag a publishable `EXPO_PUBLIC_..._KEY`.
   *
   * This is the home for *backend-only* values that sit in the app's `.env` for local tooling but must
   * never ship (e.g. `OPENAI_API_KEY`, a server-side `SENTRY_AUTH_TOKEN`). It is distinct from
   * `launch secret set`: a stored secret is still *injected* — the build needs it — it's just moved out
   * of plaintext; `envExclude` means "don't inject this at all". A name matched here is exempt from the
   * `.env.example` missing-key gate (even when no layer sets it). Omit (or `[]`) to exclude nothing.
   */
  envExclude?: string[];
  /**
   * How `launch mcp` exposes Launch to AI agents — chiefly which capability tiers it may offer. Absent =
   * least privilege (read-only tools). See {@link McpConfig}.
   */
  mcp?: McpConfig;
}

/**
 * Non-secret settings for a cloud {@link StorageProvider}. Launch writes static artifacts (install
 * plists, OTA manifests, JS bundles, IPAs/AABs) here and serves them from {@link StorageConfig.publicBaseUrl},
 * so the user owns the infra (no Launch-hosted server). Credentials are NEVER stored here — the S3
 * access key / Supabase service key resolve from env vars or the OS secret store at call time.
 */
export interface StorageConfig {
  /**
   * S3-compatible endpoint, e.g. `https://<account>.r2.cloudflarestorage.com` (Cloudflare R2),
   * a Backblaze B2 / MinIO endpoint, etc. Omit for AWS S3 (the SDK derives it from the region).
   * Unused by the `supabase` provider.
   */
  endpoint?: string;
  /** Bucket name (S3-compatible) or storage bucket id (Supabase). */
  bucket: string;
  /** Region for an S3-compatible provider. Defaults to `auto` (correct for R2) when omitted; unused by Supabase. */
  region?: string;
  /**
   * Public base URL that maps to the bucket root — used to build install links and OTA manifest URLs.
   * e.g. an R2 custom domain `https://cdn.example.com`, or a Supabase public object URL prefix
   * `https://<project>.supabase.co/storage/v1/object/public/<bucket>`. No trailing slash required.
   */
  publicBaseUrl: string;
  /** Supabase project URL (`https://<project>.supabase.co`). Required by `supabase`, unused by `s3`. */
  supabaseUrl?: string;
}

/**
 * Everything a single build needs, assembled before any work starts.
 *
 * This is the value threaded through the whole pipeline and into every provider, so a provider
 * never has to re-derive the app, profile, or environment.
 */
export interface ResolvedBuildContext {
  platform: Platform;
  app: AppDescriptor;
  profile: BuildProfile;
  /** Client-facing env vars (from the profile's `.env`) injected into the app at build time. */
  env: Record<string, string>;
  /** Whether to expand each step into a teaching block (`--explain`). */
  explain: boolean;
  /** Rehearse the flow: print every step and the exact commands/requests, make no real changes. */
  dryRun: boolean;
  /**
   * Force a from-scratch (clean) build, set from `launch build --clean`. When false (the default) the
   * build engine decides clean-vs-incremental from the build fingerprint (see `core/buildFingerprint.ts`).
   */
  forceClean: boolean;
  /** Resolved Android track + rollout. Present only for Android builds; the submitter reads it. */
  android?: AndroidReleaseOptions;
  /**
   * How this build is distributed (`store` default, or `internal` for an ad-hoc install link). Read by
   * the build engine to pick the export method (ad-hoc vs app-store / APK vs AAB) and by the pipeline
   * to choose the distribute-vs-submit tail. Absent is treated as `store`.
   */
  distribution?: Distribution;
  /**
   * Key ID of the Apple account resolved for this iOS run (from `--account`/`ASC_ACCOUNT`, the active
   * account, or the build-time picker). The `local` credentials provider loads this account's key and
   * signing assets. Absent on Android and on iOS dry-runs (which use the placeholder key).
   */
  account?: string;
}

/**
 * The App Store Connect API key — one Apple account's credential.
 *
 * Used for everything: minting JWTs, managing signing assets, and uploading builds. The `.p8`
 * private key lives in the OS secret store (namespaced per account by {@link AscKey.keyId}); this
 * shape carries its in-memory bytes plus the two non-secret identifiers Apple needs alongside it.
 * An API key belongs to exactly one Apple team, so the key *is* the account — see {@link AccountRecord}.
 */
export interface AscKey {
  /** The key's ID (e.g. `QS5924Q3MD`). Globally unique per Apple, so it doubles as the account key. */
  keyId: string;
  /** The issuer UUID for the account's API keys. */
  issuerId: string;
  /** PEM contents of the `.p8` private key. Held in memory only, never written to the repo. */
  p8: string;
}

/**
 * One imported APNs authentication key (`.p8`) in Launch's push-key vault (`~/.launch/push-keys.json`).
 *
 * An APNs auth key is how a backend sends push notifications to your app. Unlike the App Store Connect
 * key, Apple exposes NO API to create one — it's a download-once, portal-only key (Certificates, IDs &
 * Profiles → Keys), capped at 2 per account — so Launch can only *import* and safeguard a key you've
 * already downloaded, never mint one. Launch never *uses* these keys (push is a backend/runtime concern);
 * the vault exists so a download-once secret isn't lost. This record is non-secret metadata only — the
 * `.p8` PEM stays in the OS secret store under `apns-p8:<keyId>`. An APNs key is team-wide, not per-app.
 */
export interface ApnsKeyRecord {
  /** The key's ID — the 10-char value in the `AuthKey_<KEYID>.p8` filename. The vault's primary key. */
  keyId: string;
  /** Apple Team ID the key belongs to, when known (from the active account or `--team-id`). */
  teamId?: string;
  /** Human label chosen at import time (e.g. `Prod push`). Defaults to the Key ID. */
  label?: string;
  /** ISO-8601 instant the key was imported into the vault. */
  importedAt: string;
}

/**
 * One onboarded Apple account in Launch's registry (`~/.launch/accounts.json`).
 *
 * An App Store Connect API key belongs to exactly one Apple team, so each registry entry *is* an
 * account: there is no separate team/provider to choose. This record holds only non-secret metadata
 * — the `.p8` private key itself stays in the OS secret store under `asc-p8:<keyId>`. `teamId` and
 * `apps` are resolved from Apple once at add-time and cached for an instant, offline-capable picker;
 * `resolvedAt` being absent means they were never fetched (e.g. the key was added while offline).
 */
export interface AccountRecord {
  /** App Store Connect Key ID — the registry's primary key (globally unique per Apple). */
  keyId: string;
  /** Issuer UUID for this account's API keys. Non-secret; needed alongside the `.p8` to mint a JWT. */
  issuerId: string;
  /** Human label chosen at add-time, unique across accounts (e.g. `Personal`, `Acme client`). */
  label: string;
  /** Apple Team ID (the bundle-id `seedId`, e.g. `5NS9ZUMYCS`), resolved from Apple. Absent until resolved. */
  teamId?: string;
  /** Names of the apps this key can see, cached for recognizability in the picker. Absent until resolved. */
  apps?: string[];
  /** ISO-8601 instant the account was added to the registry. */
  addedAt: string;
  /** ISO-8601 instant `teamId`/`apps` were last fetched from Apple. Absent = never resolved. */
  resolvedAt?: string;
}

/**
 * The on-disk shape of `~/.launch/accounts.json`: the set of onboarded Apple accounts plus which one
 * is active. `active` is the Key ID a build uses when no `--account`/`ASC_ACCOUNT` override is given;
 * `null` means none is selected yet (a fresh install, or the active account was just removed).
 */
export interface AccountsFile {
  /** Key ID of the active account, or `null` when none is selected. */
  active: string | null;
  /** Every onboarded account, in insertion order. */
  accounts: AccountRecord[];
}

/**
 * The signing assets a release build needs, resolved (reused or freshly created) before export.
 *
 * These map one-to-one onto Xcode's manual-signing inputs: a distribution certificate (whose
 * private key is in the Keychain) plus the provisioning profile that ties it to one bundle id. An app
 * with embedded app-extension targets also carries each extension's bundle-id → profile-name pairing in
 * {@link SigningAssets.extensionProfiles}, since `xcodebuild` must be told the profile for every signed
 * bundle in the `.ipa`, not just the main app. The pipeline hands this to the build engine, which feeds
 * it straight into the export options.
 */
export interface SigningAssets {
  /** Bundle identifier these assets sign, e.g. `com.loopi.pomedero`. */
  bundleId: string;
  /** Apple Developer Team ID (e.g. `5NS9ZUMYCS`), read from the provisioning profile. */
  teamId: string;
  /** Codesign identity name to select, e.g. `Apple Distribution`. */
  certName: string;
  /** Serial number of the distribution certificate, used to detect/reuse a cached one. */
  certSerial: string;
  /** The provisioning profile's name as Apple stored it (matched in ExportOptions). */
  profileName: string;
  /** The profile's UUID — the filename Xcode looks for under `~/Library/MobileDevice`. */
  profileUuid: string;
  /** Absolute path to the installed `.mobileprovision` file. */
  profilePath: string;
  /**
   * Per-extension `bundleId → profileName` map for each embedded app-extension target, signed by the
   * same distribution certificate. Folded into the export-options `provisioningProfiles` dict alongside
   * the main bundle so `xcodebuild` signs every bundle in the `.ipa`. Absent / empty for an app with no
   * extension targets (the common case).
   */
  extensionProfiles?: Record<string, string>;
}

/**
 * Apple credentials resolved for a build.
 *
 * The secret material (`.p8`, `.p12`) lives in the macOS Keychain; this shape carries the
 * non-secret references plus the in-memory key bytes a build/submit step needs right now.
 * `signing` is absent for steps that only need the API key (e.g. submission, build-number lookup).
 */
export interface AppleCredentials {
  /** App Store Connect API key — Launch's single credential for managing creds and uploading. */
  ascKey: AscKey;
  /** Resolved distribution certificate + provisioning profile for code signing, when needed. */
  signing?: SigningAssets;
}

/**
 * The upload keystore Launch owns (or imported) to sign Android App Bundles — the Android twin of
 * {@link SigningAssets}.
 *
 * Under Play App Signing, Google holds the real *app signing key* and never reveals it; the developer
 * only ever signs uploads with this separate, recoverable *upload key*. The store/key passwords live
 * in the {@link SecretStore}, never beside the file; this shape carries the non-secret references plus
 * the in-memory passwords a `gradle`/`bundletool` step needs right now.
 */
export interface KeystoreAssets {
  /** Absolute path to the upload keystore (JKS/PKCS12), backed up under `~/.launch/credentials` (chmod 600). */
  path: string;
  /** Key alias inside the keystore, e.g. `upload`. */
  alias: string;
  /** Password unlocking the keystore file (from the {@link SecretStore}). */
  storePassword: string;
  /** Password unlocking the key entry (from the {@link SecretStore}; often equal to the store password). */
  keyPassword: string;
}

/**
 * Android credentials resolved for a build — the Android twin of {@link AppleCredentials}.
 *
 * The secret material (service-account JSON, keystore passwords) lives in the {@link SecretStore};
 * this shape carries the in-memory bytes/paths a build/submit step needs right now. `keystore` is
 * absent for steps that only need the Play API (e.g. submission, `versionCode` lookup).
 */
export interface AndroidCredentials {
  /** Play Developer API service-account key JSON — Launch's single Google credential (manage + read). */
  serviceAccountJson: string;
  /** Resolved upload keystore for signing the `.aab`, when needed. */
  keystore?: KeystoreAssets;
}

/**
 * Credentials for one build, discriminated by `platform` so a single pipeline + registry serve both
 * stores. Every provider interface ({@link CredentialsProvider}, {@link BuildEngine}, {@link Submitter})
 * speaks this union; each concrete provider narrows with `switch (creds.platform)` and rejects the
 * platform it doesn't serve. This discriminant is what lets the iOS and Android legs share the spine
 * with no `any` and no unchecked casts.
 */
export type BuildCredentials =
  | ({ platform: "ios" } & AppleCredentials)
  | ({ platform: "android" } & AndroidCredentials);

/**
 * One row in a {@link SizeReport}: a device variant's estimated store download/install size.
 *
 * On iOS these come per-device from Xcode's App Thinning Size Report. On Android there is no thinning
 * report; `bundletool get-size` yields a single worst-case download, surfaced as one representative
 * row (`installBytes` left 0 — Play doesn't expose an honest install figure).
 */
export interface SizeReportEntry {
  /** Variant name, e.g. `iPhone15,2` (iOS) or `worst-case device` (Android bundletool estimate). */
  device: string;
  /** Estimated bytes the device downloads from the store (after iOS thinning / Android splits). */
  downloadBytes: number;
  /** Estimated bytes installed on the device. 0 when the platform gives no honest install figure. */
  installBytes: number;
}

/**
 * Size analysis produced right after the build, before any upload.
 *
 * Surfacing this locally is the whole point of the size step: know the real per-device download
 * before spending a store round-trip discovering the app is too large.
 */
export interface SizeReport {
  /** Raw artifact file size on disk — the `.ipa` (iOS) or `.aab` (Android); NOT what users download. */
  artifactBytes: number;
  /** Per-device download/install estimates. Empty when no per-device report was produced. */
  entries: SizeReportEntry[];
}

/**
 * A built, signed artifact plus the metadata Launch records about it.
 *
 * Stored by a {@link StorageProvider} and used to build the run summary and the local index.
 */
export interface BuildArtifact {
  /** Absolute path to the signed `.ipa` (or `.aab`) on disk. */
  path: string;
  platform: Platform;
  appName: string;
  profile: string;
  /** App version string, e.g. `1.0.0`. */
  version: string;
  /** Unique, monotonically increasing build identifier — iOS `CFBundleVersion` or Android `versionCode`. */
  buildNumber: number;
  sizeReport: SizeReport;
  /**
   * Whether this artifact was compiled clean (from scratch) vs incrementally off warm caches. Read by
   * `launch release` to ask a second confirmation before promoting an incremental build to production —
   * the reproducibility guard, since release reuses this stored artifact rather than rebuilding.
   */
  clean: boolean;
  /** ISO-8601 creation timestamp, stamped by the caller (the pipeline). */
  createdAt: string;
  /**
   * ISO-8601 stamp set when artifact retention removed this build's binary to reclaim disk (see
   * {@link LaunchConfig.artifactRetentionDays}). The index row is kept as history — `builds list` shows it
   * as `pruned` and `builds view`/`release` explain the binary is gone — so absence means the file is still
   * on disk. The newest build per app+platform is never pruned, so a promotable artifact always survives.
   */
  prunedAt?: string;
}

/**
 * One build whose binary an artifact-retention sweep removed (or, in a dry run, would remove). A flat,
 * presentation-ready projection of the pruned {@link BuildArtifact} plus the bytes it freed — what the
 * `builds prune` preview/table renders and `--json` emits, kept stable apart from the persisted record.
 */
export interface PrunedArtifact {
  app: string;
  platform: Platform;
  version: string;
  buildNumber: number;
  /** Size of the removed binary in bytes — what this row reclaimed (or would reclaim). */
  bytes: number;
  /** The artifact's recorded path (the file is gone after a real run). */
  path: string;
}

/**
 * Options for an artifact-retention sweep ({@link StorageProvider.prune}). `now` is injected (not read
 * from the clock) so the policy is deterministic and unit-testable; `retentionDays` is the resolved
 * window. An absent `app`/`platform` matches everything; `dryRun` plans without deleting.
 */
export interface PruneOptions {
  /** Reference "now" in epoch ms — the age of each build is measured against this. */
  now: number;
  /** Builds strictly older than this many days are eligible (the newest per app+platform is always kept). */
  retentionDays: number;
  /** Limit the sweep to one app handle. */
  app?: string;
  /** Limit the sweep to one platform. */
  platform?: Platform;
  /** Plan and report what would be removed, deleting nothing. */
  dryRun?: boolean;
}

/**
 * The outcome of an artifact-retention sweep. `pruned` is empty when nothing was eligible (a no-op);
 * `freedBytes` sums the removed binaries' sizes. When `dryRun` is true, `pruned`/`freedBytes` describe
 * what *would* be removed and nothing was deleted.
 */
export interface PruneResult {
  pruned: PrunedArtifact[];
  freedBytes: number;
  dryRun: boolean;
}

/** A pointer to an artifact after a {@link StorageProvider} has stored it. */
export interface StoredArtifact {
  /** Stable identifier within the provider (e.g. a path or object key). */
  id: string;
  /** A URL or path a human can use to retrieve the artifact. */
  location: string;
}

/* -------------------------------------------------------------------------- */
/*  Provider interfaces — the "any infra, easily added" seam.                 */
/*  Implement one of these + register() to add a backend. Nothing else needs  */
/*  to change; the pipeline selects providers by name from LaunchConfig.       */
/* -------------------------------------------------------------------------- */

/**
 * Resolves and persists the credentials a build needs, for whichever platform the context names.
 *
 * The `local` implementation reads/writes the OS secret store and `~/.launch`, branching on
 * `ctx.platform` to return {@link AppleCredentials} (iOS) or {@link AndroidCredentials} (Android) as a
 * {@link BuildCredentials}. A future `team`/`s3` implementation could fetch shared, encrypted
 * credentials instead — the pipeline neither knows nor cares which backend answered.
 */
export interface CredentialsProvider {
  /** Registry name, e.g. `local`. */
  readonly name: string;
  /**
   * Resolve credentials for the given context: a cache hit returns immediately. iOS reuses-or-creates
   * the certificate + provisioning profile via the App Store Connect API; Android returns the
   * service-account key plus any cached upload keystore. The result is discriminated by `platform`.
   */
  resolve(ctx: ResolvedBuildContext): Promise<BuildCredentials>;
  /** Human-readable status of what's cached, across both platforms (used by `launch creds status`). */
  status(): Promise<string>;
}

/**
 * Compiles and signs the native project into a distributable artifact.
 *
 * `fastlane` runs `gym` → `.ipa` (iOS); `gradle` runs `bundleRelease` → `.aab` (Android). Each engine
 * narrows {@link BuildCredentials} to the platform it serves and rejects the other.
 */
export interface BuildEngine {
  /** Registry name, e.g. `fastlane` or `gradle`. */
  readonly name: string;
  /**
   * Archive, sign, export, and analyze size for the resolved build. `cleanBuilt` reports whether this
   * was a from-scratch compile (vs an incremental one reusing warm caches) so the pipeline can stamp
   * {@link BuildArtifact.clean} — which `launch release` reads to nudge before promoting an incremental.
   */
  build(
    ctx: ResolvedBuildContext,
    creds: BuildCredentials,
  ): Promise<{ artifactPath: string; sizeReport: SizeReport; cleanBuilt: boolean }>;
}

/**
 * Persists build artifacts and hands back a retrievable location.
 *
 * Shaped after the S3 object-store model (`put`/`list`/`url` for build artifacts, plus
 * `putObject`/`publicUrl` for the raw files ad-hoc install links and OTA manifests need) so cloud
 * providers (R2, S3, Supabase) are thin drop-ins. `local` writes under `~/.launch`; the cloud
 * providers upload to the user's own bucket and serve from {@link StorageConfig.publicBaseUrl}.
 */
export interface StorageProvider {
  /** Registry name, e.g. `local`, `s3`, `supabase`. */
  readonly name: string;
  /** Store a build artifact and return a pointer to it. */
  put(artifact: BuildArtifact): Promise<StoredArtifact>;
  /** List stored build artifacts, newest first. */
  list(): Promise<BuildArtifact[]>;
  /** Resolve a retrievable location (path or URL) for a stored artifact id. */
  url(id: string): Promise<string>;
  /**
   * Upload a raw object at `key` (a forward-slash path within the bucket) with the given content type,
   * returning its retrievable location. Powers ad-hoc distribution (IPA/APK + install plist + landing
   * page) and OTA updates (manifest JSON + JS bundles + assets), which store arbitrary keyed files.
   */
  putObject(key: string, body: Buffer | string, contentType: string): Promise<StoredArtifact>;
  /**
   * Read a raw object previously written with {@link putObject}, or `null` when the key is absent.
   * The read counterpart of {@link putObject}: powers the OTA update lifecycle (`updates list/view/
   * rollback`), which reads back the per-channel history index, the immutable manifest snapshots, and
   * the active rollback directive. Returns raw bytes so callers parse JSON or pass assets through as-is.
   */
  getObject(key: string): Promise<Buffer | null>;
  /**
   * The public URL an object at `key` is served from — computed without a network call so a manifest
   * can reference an asset's URL before that asset is uploaded (e.g. the install plist points at the
   * IPA's URL). For `local` this is a `file://` path (real install links need a cloud provider).
   */
  publicUrl(key: string): string;
  /**
   * Reclaim disk by deleting build binaries older than `retentionDays`, always keeping the newest per
   * app+platform (so a promotable artifact survives). **Local-only**: cloud providers leave this
   * undefined because their bucket lifecycle owns retention, and the pipeline's auto-sweep simply
   * no-ops for them. Keeps the index row (stamping {@link BuildArtifact.prunedAt}) so build history
   * survives the binary.
   */
  prune?(options: PruneOptions): Promise<PruneResult>;
}

/**
 * Uploads a built artifact to a distribution destination.
 *
 * `app-store-connect` submits to TestFlight/App Store via fastlane `pilot`/`deliver`; `google-play`
 * submits to a Play track via fastlane `supply`. Each narrows {@link BuildCredentials} to its platform
 * and maps the neutral {@link SubmitTarget} onto its store's concept (Android also reads `ctx.android`).
 */
export interface Submitter {
  /** Registry name, e.g. `app-store-connect` or `google-play`. */
  readonly name: string;
  /** Upload `artifactPath` to `target`, authenticating with `creds`. */
  submit(artifactPath: string, target: SubmitTarget, creds: BuildCredentials, ctx: ResolvedBuildContext): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*  Remote / cloud-Mac build — the off-Mac path.                                */
/*  Two extra seams on top of the four above: a SecretStore (OS-native secret   */
/*  storage that also works on Windows/Linux) and a ComputeHost (provisions the */
/*  remote Mac). The remote build then drives the SAME fastlane spine over SSH. */
/* -------------------------------------------------------------------------- */

/**
 * The operating-system family Launch is running on.
 *
 * iOS code signing is macOS-only, so a `windows`/`linux` host cannot build locally — it must drive
 * a remote Mac (AWS EC2 Mac or a reachable Mac over SSH) or hand off to Expo EAS. The no-args wizard
 * branches on this value.
 */
export type HostOs = "macos" | "windows" | "linux";

/**
 * A shell Launch can emit tab-completion for.
 *
 * The three POSIX-family shells with the install-base to matter for a developer CLI: `bash` and `zsh`
 * (the macOS/Linux defaults) plus `fish`. PowerShell is intentionally out of scope — the iOS/Android
 * toolchains Launch drives are macOS/Linux-first. Drives both `launch completion <shell>` (which prints
 * the script) and `launch completion install` (which wires it into the shell's rc file); see
 * `core/completion.ts`.
 */
export type Shell = "bash" | "zsh" | "fish";

/**
 * SSH connection parameters for reaching a remote Mac.
 *
 * Filled by a {@link ComputeHost}: `aws-ec2-mac` from a freshly-provisioned instance, `byo-ssh` from
 * a user-supplied `user@host` string. Consumed by the SSH transport helpers in `core/ssh.ts`.
 */
export interface SshTarget {
  /** Hostname or IP of the remote Mac. */
  host: string;
  /** SSH login user (EC2 Mac AMIs default to `ec2-user`). */
  user: string;
  /** SSH port. Defaults to 22. */
  port: number;
  /** Absolute path to the private key to authenticate with; omit to use the SSH agent / default key. */
  identityFile?: string;
}

/**
 * A handle to an allocated (or connected) remote Mac.
 *
 * Persisted to `~/.launch/cloud.json` so a later command can reuse the live paid-window host, show
 * accrued cost, and release it. For `byo-ssh` the AWS fields are absent — there is nothing to bill or
 * release; Launch only borrows the connection.
 */
export interface HostHandle {
  /** Registry name of the {@link ComputeHost} that owns this handle (e.g. `aws-ec2-mac`). */
  provider: string;
  /** SSH parameters to reach the host. */
  ssh: SshTarget;
  /** ISO-8601 instant the host was allocated — the 24h Apple-license billing clock starts here. */
  allocatedAt: string;
  /** EC2 instance id (`i-…`). Absent for `byo-ssh`. */
  instanceId?: string;
  /** EC2 Dedicated Host id (`h-…`) — the resource that bills until released. Absent for `byo-ssh`. */
  hostId?: string;
  /** AWS region the host lives in. Absent for `byo-ssh`. */
  region?: string;
  /** EC2 instance type (e.g. `mac2.metal`). Absent for `byo-ssh`. */
  instanceType?: string;
}

/**
 * A live host's status, for `launch cloud status` and the per-command cost banner.
 *
 * `estimatedCostUsd` is what has accrued so far under AWS's per-second billing; the real floor is
 * the 24h minimum (see `core/cost.ts`). `releasableAt` is when AWS first allows releasing the
 * Dedicated Host with no further commitment.
 */
export interface HostStatus {
  handle: HostHandle;
  /** Milliseconds since `allocatedAt`. */
  ageMs: number;
  /** Accrued cost so far in USD (informational; the 24h minimum is the real floor). */
  estimatedCostUsd: number;
  /** ISO-8601 instant the Dedicated Host can first be released (allocatedAt + 24h). */
  releasableAt: string;
}

/**
 * AWS settings for the EC2 Mac compute host, declared in `launch.config.ts` under `aws`.
 *
 * Launch stores NO AWS secrets: credentials resolve through the standard SDK chain (env → `~/.aws`
 * profiles → SSO → IMDS). `amiId` is an optional BYO golden image; omit it to let Launch bootstrap
 * one and persist its id to `~/.launch/cloud.json`.
 */
export interface AwsConfig {
  /** AWS region to allocate the Dedicated Host in (e.g. `us-east-1`). */
  region: string;
  /** Named profile in `~/.aws` to resolve via the credential chain. Omit to use the default chain. */
  profile?: string;
  /** BYO golden AMI id. Omit to bootstrap + snapshot one into your own account on first use. */
  amiId?: string;
  /** EC2 Mac instance type. Defaults to `mac2.metal` (cheapest M-series in most regions). */
  instanceType?: string;
}

/**
 * Where a remote build should run, resolved from `--remote [aws|user@host]` or the wizard.
 * - `aws`: provision an EC2 Mac via the `aws-ec2-mac` {@link ComputeHost}.
 * - `ssh`: connect to an already-reachable Mac via the `byo-ssh` {@link ComputeHost}.
 */
export type RemoteTarget = { kind: "aws" } | { kind: "ssh"; target: string };

/**
 * Request passed to {@link ComputeHost.allocate}.
 *
 * Carries everything a host backend needs to provision without depending on the logger or the
 * pipeline: AWS settings for `aws-ec2-mac`, an `user@host` string for `byo-ssh`, a consent gate for
 * the first billable action, and an optional progress sink. Reuse of a live host is handled by the
 * caller (`core/remotePipeline.ts`), so `allocate` always provisions fresh.
 */
export interface AllocateRequest {
  /** AWS settings (region/instanceType/amiId). Required by `aws-ec2-mac`, ignored by `byo-ssh`. */
  aws?: AwsConfig;
  /** `user@host[:port]` for `byo-ssh`. Ignored by `aws-ec2-mac`. */
  sshTarget?: string;
  /** Gate the first billable action; return false to abort allocation. */
  confirm(message: string): Promise<boolean>;
  /** Optional progress sink for long provisioning steps (booting, bootstrapping Xcode, snapshotting). */
  onProgress?: (message: string) => void;
}

/**
 * Generic OS-native secret storage — the cross-platform widening of the macOS-only Keychain.
 *
 * Backs the App Store Connect `.p8` and the distribution `.p12` password on whatever host Launch
 * runs on: macOS Keychain, Windows Credential Manager, or Linux libsecret. Non-Mac developers have
 * no Keychain; this seam gives them a real OS-native store. NOTE: importing a cert into a *codesign*
 * keychain (the `security import` calls) is a different concern and stays in `core/keychain.ts`.
 */
export interface SecretStore {
  /** Backend name, e.g. `macos-security` or `native-keyring`. */
  readonly name: string;
  /** Read a secret for `account`, or null if absent. */
  get(account: string): Promise<string | null>;
  /** Store (overwriting) a secret for `account`. */
  set(account: string, value: string): Promise<void>;
  /** Remove a stored secret for `account`. No-op if absent. */
  delete(account: string): Promise<void>;
}

/**
 * Provisions, connects to, and tears down a remote Mac for off-Mac iOS builds.
 *
 * `aws-ec2-mac` allocates a Dedicated Host + EC2 Mac instance (billing-aware, golden-AMI reuse);
 * `byo-ssh` simply wraps a Mac you already reach. `core/remotePipeline.ts` then drives the same
 * fastlane build/sign/submit spine over the SSH connection, so the host backend and the build logic
 * stay independent. SSH command execution lives in `core/ssh.ts`, shared by every host impl.
 */
export interface ComputeHost {
  /** Registry name, e.g. `aws-ec2-mac`. */
  readonly name: string;
  /** Provision a ready-to-SSH Mac (instance booted, toolchain present). Gated by {@link AllocateRequest.confirm}. */
  allocate(request: AllocateRequest): Promise<HostHandle>;
  /** Report a live host's age, accrued cost, and release time. Null if the handle is no longer live. */
  status(handle: HostHandle): Promise<HostStatus | null>;
  /** Release the host (AWS: terminate instance + release the Dedicated Host). No-op for `byo-ssh`. */
  teardown(handle: HostHandle): Promise<void>;
}
