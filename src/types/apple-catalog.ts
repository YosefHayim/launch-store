import type { components } from '../apple-api-types.ts';

import type {
  OfferCustomerEligibility,
  OfferDuration,
  OfferEligibility,
  OfferMode,
} from './catalog.ts';
/** A registered Bundle ID resource (an App ID in the Developer portal). */
export type BundleIdResource = Readonly<{
  id: string;
  identifier: string;
  seedId?: string | undefined;
}>;
/** A signing certificate resource, with the bytes needed to package a `.p12`. */
export type CertificateResource = Readonly<{
  id: string;
  serialNumber: string;
  certificateContent: string;
  expirationDate?: string | undefined;
}>;
/** A device registered in the Developer portal, eligible to receive ad-hoc builds. */
export type DeviceResource = Readonly<{
  id: string;
  udid: string;
  name: string;
  status?: string | undefined;
}>;
/** A provisioning profile resource, with the bytes needed to install it locally. */
export type ProfileResource = Readonly<{
  id: string;
  name: string;
  uuid: string;
  profileContent: string;
}>;
/** One configured key on a capability's `settings` - Apple's per-capability toggle list (e.g. */
export type CapabilitySetting = Readonly<{
  key: string;
  options?: Readonly<{
    key: string;
  }>[];
}>;
/** A capability enabled on a bundle id (App ID), e.g. `PUSH_NOTIFICATIONS`. */
export type BundleIdCapabilityResource = Readonly<{
  id: string;
  capabilityType: string;
  settings?: readonly CapabilitySetting[];
}>;
/** An in-app purchase (the `inAppPurchasesV2` resource) on an app. */
export type InAppPurchaseResource = Readonly<{
  id: string;
  productId: string;
  name: string;
  inAppPurchaseType: string;
  state?: string;
}>;
/** One **sandbox tester** (`sandboxTesters`) */
export type SandboxTesterResource = Readonly<{
  id: string;
  acAccountName: string;
  firstName?: string;
  lastName?: string;
  territory?: string;
  applePayCompatible?: boolean;
  interruptPurchases?: boolean;
  subscriptionRenewalRate?: string;
}>;
/** A subscription group - the container for mutually-exclusive subscription levels. */
export type SubscriptionGroupResource = Readonly<{
  id: string;
  referenceName: string;
}>;
/** One auto-renewable subscription within a group. */
export type SubscriptionResource = Readonly<{
  id: string;
  productId: string;
  name: string;
  subscriptionPeriod?: string;
  state?: string;
}>;
/** One locale's stored copy for a product, group, or subscription. */
export type LocalizationResource = Readonly<{
  id: string;
  locale: string;
  name: string;
  description?: string;
}>;
/** A price point - one rung of Apple's fixed price ladder for a product in a territory. */
export type PricePointResource = Readonly<{
  id: string;
  customerPrice: string;
  territory: string;
}>;
/** An existing App Encryption Declaration on an app */
export type EncryptionDeclarationResource = Readonly<{
  id: string;
  state: string;
}>;
/** One locale's stored App Store listing copy */
export type ListingLocalization = Readonly<{
  id: string;
  locale: string;
  fields: Record<string, string>;
}>;
/** One App Store screenshot **set** */
export type ScreenshotSetResource = Readonly<{
  id: string;
  screenshotDisplayType: string;
}>;
/** One uploaded App Store screenshot. */
export type ScreenshotResource = Readonly<{
  id: string;
  fileName: string;
  sourceFileChecksum?: string;
  assetDeliveryState?: string;
}>;
/** A subscription's App Review screenshot (`subscriptionAppStoreReviewScreenshots`) */
export type ReviewScreenshotResource = Readonly<{
  id: string;
  sourceFileChecksum?: string;
  assetDeliveryState?: string;
}>;
/** One App Store app-preview-video **set** */
export type PreviewSetResource = Readonly<{
  id: string;
  previewType: string;
}>;
/** One uploaded App Store app preview video. */
export type PreviewResource = Readonly<{
  id: string;
  fileName: string;
  sourceFileChecksum?: string;
  assetDeliveryState?: string;
}>;
/** A TestFlight beta group - a named tester bucket that belongs to exactly one app. */
export type BetaGroupResource = Readonly<{
  id: string;
  name: string;
  isInternal?: boolean;
  publicLink?: string;
}>;
/** A TestFlight tester. */
export type BetaTesterResource = Readonly<{
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  state?: string;
}>;
/** Common attributes shared by Apple's two beta-feedback submission resources */
export type BetaFeedbackSubmissionResource = Readonly<{
  id: string;
  createdDate?: string;
  comment?: string;
  email?: string;
  deviceModel?: string;
  osVersion?: string;
  buildVersion?: string;
}>;
/** A TestFlight crash-feedback submission (`betaFeedbackCrashSubmissions`) - the device/OS context plus the tester's comment. */
export type BetaFeedbackCrashSubmissionResource = BetaFeedbackSubmissionResource;
/** A TestFlight screenshot-feedback submission (`betaFeedbackScreenshotSubmissions`) */
export type BetaFeedbackScreenshotSubmissionResource = BetaFeedbackSubmissionResource &
  Readonly<{
    screenshots: Readonly<{
      url: string;
      width?: number;
      height?: number;
    }>[];
  }>;
/** Server-side narrowing for the beta-feedback readers */
export type BetaFeedbackQuery = Readonly<{
  buildId?: string;
}>;
/** One customer review of an app. */
export type CustomerReviewResource = Readonly<{
  id: string;
  rating: number;
  title?: string | undefined;
  body?: string | undefined;
  reviewerNickname?: string | undefined;
  territory?: string | undefined;
  createdDate?: string | undefined;
  answered: boolean;
}>;
/** A developer's response to a customer review - the editable, moderated reply shown under the review. */
export type CustomerReviewResponseResource = Readonly<{
  id: string;
  responseBody: string;
  state?: string | undefined;
  lastModifiedDate?: string | undefined;
}>;
/** One App Store Connect **team member** (`users`) */
export type UserResource = Readonly<{
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  roles: readonly string[];
}>;
/** One **pending** team invitation (`userInvitations`) - an invited member who hasn't accepted. */
export type UserInvitationResource = Readonly<{
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles: readonly string[];
  expirationDate?: string;
}>;
/** The attributes required to invite a new team member */
export type NewUserInvitation = Readonly<{
  email: string;
  firstName: string;
  lastName: string;
  roles: readonly string[];
  allAppsVisible: boolean;
  provisioningAllowed: boolean;
}>;
/** An analytics report request - the subscription that makes reports available for an app. */
export type AnalyticsReportRequestResource = Readonly<{
  id: string;
  accessType: string;
  stoppedDueToInactivity?: boolean | undefined;
}>;
/** One report available within a request (e.g. "App Store Installations"), grouped by category. */
export type AnalyticsReportResource = Readonly<{
  id: string;
  name: string;
  category?: string | undefined;
}>;
/** One time-period instance of a report - a single day/week/month of generated data. */
export type AnalyticsReportInstanceResource = Readonly<{
  id: string;
  granularity: string;
  processingDate?: string | undefined;
}>;
/** One downloadable segment of a report instance */
export type AnalyticsReportSegmentResource = Readonly<{
  id: string;
  url: string;
  checksum?: string | undefined;
  sizeInBytes?: number | undefined;
}>;
/** One **in-app event** (`appEvents`) */
export type AppEventResource = Readonly<{
  id: string;
  referenceName: string;
  badge?: string;
  eventState?: string;
  primaryLocale?: string;
  deepLink?: string;
  priority?: string;
  purpose?: string;
}>;
/** One locale's copy for an in-app event (`appEventLocalizations`) - name + short/long descriptions. */
export type AppEventLocalizationResource = Readonly<{
  id: string;
  locale: string;
  name?: string;
  shortDescription?: string;
  longDescription?: string;
}>;
/** Attributes to create an in-app event, passed to `POST /v1/appEvents` (alongside the app relationship). */
export type NewAppEvent = Readonly<{
  referenceName: string;
  badge?: string;
  primaryLocale?: string;
  deepLink?: string;
  priority?: string;
  purpose?: string;
}>;
/** The editable copy fields of an in-app event localization (create or update). */
export type AppEventLocalizationInput = Readonly<{
  name?: string;
  shortDescription?: string;
  longDescription?: string;
}>;
/** Parameters for a Sales & Trends report download */
export type SalesReportQuery = Readonly<{
  vendorNumber: string;
  frequency: string;
  reportType: string;
  reportSubType: string;
  reportDate: string;
  version?: string | undefined;
}>;
/** Parameters for a Finance report download - Apple's `filter[...]` query for `/v1/financeReports`. */
export type FinanceReportQuery = Readonly<{
  vendorNumber: string;
  reportDate: string;
  regionCode: string;
  reportType?: string | undefined;
}>;
/* -------------------------------------------------------------------------- */
/*  App Store release-lifecycle resources - consumed by core/app-store-release.ts  */
/*  (the version -> build -> review -> rollout state machine). Untouched by the      */
/*  build/sign path and the `launch-store sync` catalog reconciler.                     */
/* -------------------------------------------------------------------------- */
/** A build (one uploaded binary) on App Store Connect, with the fields the release flow reads. */
export type BuildResource = Readonly<{
  id: string;
  version: string;
  processingState: string;
  uploadedDate?: string;
  expired: boolean;
  marketingVersion?: string;
}>;
/** One reason App Store Connect gave about a build upload (an error such as `90062`, or a warning). */
export type BuildUploadProblem = Readonly<{ code: string; description: string }>;
/** Where an IPA delivery stands */
export type BuildUploadStatus = Readonly<{
  state: string;
  fileState: string;
  errors: readonly BuildUploadProblem[];
}>;
/** One locale's TestFlight "What to Test" note for a build (`betaBuildLocalizations`). */
export type BetaBuildLocalizationResource = Readonly<{
  id: string;
  locale: string;
  whatsNew?: string;
}>;
/** Apple's Beta App Review verdict for a build's submission. */
export type BetaReviewState = components['schemas']['BetaReviewState'];
/** A build's Beta App Review submission (`betaAppReviewSubmissions`) */
export type BetaAppReviewSubmissionResource = Readonly<{
  id: string;
  state?: BetaReviewState;
}>;
/** An App Store version - the per-release container carrying lifecycle state, release type */
export type AppStoreVersionResource = Readonly<{
  id: string;
  versionString: string;
  appStoreState: string;
  releaseType?: string;
  /** Id of the build attached to this version; absent when no build is attached. */
  attachedBuildId?: string;
  attachedBuildNumber?: string;
  attachedBuildProcessingState?: string;
}>;
/** One locale's editable version copy. Launch only ever writes `whatsNew` (the release notes). */
export type AppStoreVersionLocalizationResource = Readonly<{
  id: string;
  locale: string;
  whatsNew?: string;
}>;
/** A version's phased-release schedule (Apple's 7-day staged rollout), present only once one exists. */
export type PhasedReleaseResource = Readonly<{
  id: string;
  phasedReleaseState: string;
  currentDayNumber?: number;
}>;
/** An App Store review submission */
export type ReviewSubmissionResource = Readonly<{
  id: string;
  state: string;
}>;
/** One territory's resolved offer price */
export type ResolvedOfferPrice = Readonly<{
  territory: string;
  pricePointId: string;
}>;
/** An offer-code campaign on a subscription, as listed for idempotent reconcile. `name` is the key. */
export type OfferCodeResource = Readonly<{
  id: string;
  name: string;
  active: boolean;
}>;
/** A promotional offer on a subscription. `offerCode` (the StoreKit-facing id) is the reconciler's key. */
export type PromotionalOfferResource = Readonly<{
  id: string;
  name: string;
  offerCode: string;
}>;
/** An introductory offer on a subscription. */
export type IntroductoryOfferResource = Readonly<{
  id: string;
  territory: string | null;
}>;
/** A win-back offer on a subscription, keyed by its stable `offerId`. */
export type WinBackOfferResource = Readonly<{
  id: string;
  offerId: string;
}>;
/** A promoted purchase on an app's product page. */
export type PromotedPurchaseResource = Readonly<{
  id: string;
  inAppPurchaseId: string | null;
  subscriptionId: string | null;
  enabled: boolean;
  visibleForAllUsers: boolean;
}>;
/** Create input for an offer-code campaign - prices already resolved to {@link ResolvedOfferPrice}s. */
export type OfferCodeCreate = Readonly<{
  subscriptionId: string;
  name: string;
  customerEligibilities: readonly OfferCustomerEligibility[];
  offerEligibility: OfferEligibility;
  duration: OfferDuration;
  offerMode: OfferMode;
  numberOfPeriods: number;
  prices: readonly ResolvedOfferPrice[];
}>;
/** Create input for a promotional offer - `offerCode` is the StoreKit-facing id; prices pre-resolved. */
export type PromotionalOfferCreate = Readonly<{
  subscriptionId: string;
  name: string;
  offerCode: string;
  duration: OfferDuration;
  offerMode: OfferMode;
  numberOfPeriods: number;
  prices: readonly ResolvedOfferPrice[];
}>;
/** Create input for an introductory offer - at most one per territory (null = all territories). */
export type IntroductoryOfferCreate = Readonly<{
  subscriptionId: string;
  duration: OfferDuration;
  offerMode: OfferMode;
  numberOfPeriods: number;
  price: ResolvedOfferPrice | null;
  territory: string | null;
  startDate?: string;
  endDate?: string;
}>;
/** Create input for a win-back offer - carries Apple's lapsed-customer eligibility windows. */
export type WinBackOfferCreate = Readonly<{
  subscriptionId: string;
  offerId: string;
  referenceName: string;
  duration: OfferDuration;
  offerMode: OfferMode;
  numberOfPeriods: number;
  eligiblePaidMonths: number;
  monthsSinceLastSubscribed: Readonly<{
    min: number;
    max: number;
  }>;
  waitBetweenOffersMonths?: number;
  startDate: string;
  endDate?: string;
  priority: 'HIGH' | 'NORMAL';
  promotionIntent?: 'NOT_PROMOTED' | 'USE_AUTO_GENERATED_ASSETS';
  prices: readonly ResolvedOfferPrice[];
}>;
/** A promoted product to register - exactly one of the two ids is set (resolved from a config `productId`). */
export type PromotedPurchaseCreate = Readonly<{
  appId: string;
  inAppPurchaseId?: string;
  subscriptionId?: string;
  visibleForAllUsers: boolean;
  enabled: boolean;
}>;
/** An app's App Info record */
export type AppInfoResource = Readonly<{
  id: string;
  state?: string;
  primaryCategoryId?: string;
  secondaryCategoryId?: string;
}>;
/** One age-rating answer: a content-descriptor enum string (`NONE` / `INFREQUENT` / `FREQUENT`) or a boolean flag. */
export type AgeRatingValue = string | boolean;
/** Effect `Schema.filter` verdict for age-rating answers: `true`, or a message naming what to use instead of a deprecated name or value. */
export function deprecatedAgeRatingVerdict(
  answers: Readonly<Record<string, AgeRatingValue>>,
): true | string {
  for (const [attributeName, answer] of Object.entries(answers)) {
    const attributeAdvice = {
      kidsAgeBand: 'Apple deprecated it in App Store Connect API 4.2; remove it',
      ageRatingOverride: 'use ageRatingOverrideV2',
    }[attributeName];
    if (attributeAdvice != null) {
      return `ageRating.${attributeName} is deprecated: ${attributeAdvice}.`;
    }
    const replacementAnswer = {
      INFREQUENT_OR_MILD: 'INFREQUENT',
      FREQUENT_OR_INTENSE: 'FREQUENT',
    }[String(answer)];
    if (replacementAnswer != null) {
      return `ageRating.${attributeName} uses deprecated value ${String(answer)}: use ${replacementAnswer}.`;
    }
  }
  return true;
}
/** An app's age-rating declaration. */
export type AgeRatingDeclarationResource = Readonly<{
  id: string;
  attributes: Record<string, AgeRatingValue>;
}>;
/** The device families an accessibility declaration can target. */
export type DeviceFamily = components['schemas']['DeviceFamily'];

/** The accessibility-support flags an accessibility declaration carries */
export type AccessibilitySupport = Readonly<{
  supportsAudioDescriptions?: boolean;
  supportsCaptions?: boolean;
  supportsDarkInterface?: boolean;
  supportsDifferentiateWithoutColorAlone?: boolean;
  supportsLargerText?: boolean;
  supportsReducedMotion?: boolean;
  supportsSufficientContrast?: boolean;
  supportsVoiceControl?: boolean;
  supportsVoiceover?: boolean;
}>;
/** The nine `AccessibilitySupport` keys, used to diff a declaration against config and to build requests. */
export const ACCESSIBILITY_SUPPORT_KEYS: readonly (keyof AccessibilitySupport)[] = [
  'supportsAudioDescriptions',
  'supportsCaptions',
  'supportsDarkInterface',
  'supportsDifferentiateWithoutColorAlone',
  'supportsLargerText',
  'supportsReducedMotion',
  'supportsSufficientContrast',
  'supportsVoiceControl',
  'supportsVoiceover',
];
/** One app's accessibility declaration for a single {@link DeviceFamily}. */
export type AccessibilityDeclarationResource = Readonly<{
  id: string;
  deviceFamily: DeviceFamily;
  state: 'DRAFT' | 'PUBLISHED' | 'REPLACED';
  support: AccessibilitySupport;
}>;
/** An app's store availability (Apple's v2 model) */
export type AppAvailabilityResource = Readonly<{
  id: string;
  availableInNewTerritories: boolean;
  availableTerritories: readonly string[];
}>;
/** A custom product page - an alternate App Store listing (marketing variant), matched by its `name`. */
export type CustomProductPageResource = Readonly<{
  id: string;
  name: string;
}>;
/** One version of a custom product page; its localizations hang off it. `state` decides whether it's editable. */
export type CustomProductPageVersionResource = Readonly<{
  id: string;
  state: string;
}>;
/** One locale's custom-product-page copy. Launch writes the `promotionalText`; screenshots are out of scope. */
export type CustomProductPageLocalizationResource = Readonly<{
  id: string;
  locale: string;
  promotionalText?: string;
}>;
/** A product-page A/B experiment (Apple's v2 model), matched by its `name`. */
export type VersionExperimentResource = Readonly<{
  id: string;
  name: string;
  state: string;
  trafficProportion?: number;
  startDate?: string;
}>;
/** One treatment (variant arm) of a version experiment, matched by its `name`. */
export type ExperimentTreatmentResource = Readonly<{
  id: string;
  name: string;
}>;
/** One locale of an experiment treatment; it holds that locale's treatment screenshot sets. */
export type ExperimentTreatmentLocalizationResource = Readonly<{
  id: string;
  locale: string;
}>;
/** An app version's App Review details */
export type AppStoreReviewDetailResource = Readonly<{
  id: string;
  attributes: Record<string, string | boolean>;
}>;
/** The App Clip card's call-to-action button - Apple's `AppClipAction` enum. */
export const APP_CLIP_ACTIONS = [
  'OPEN',
  'VIEW',
  'PLAY',
] as const satisfies readonly components['schemas']['AppClipAction'][];
/** The App Clip card's call-to-action button. */
export type AppClipActionValue = components['schemas']['AppClipAction'];
/** An app's App Clip - the install-free slice launched from a link / NFC / App Clip Code. */
export type AppClipResource = Readonly<{
  id: string;
  bundleId?: string;
}>;
/** One default App Clip experience */
export type AppClipDefaultExperienceResource = Readonly<{
  id: string;
  action?: string;
  versionId?: string;
}>;
/** One locale of an App Clip's default experience - the card subtitle shown to users in that locale. */
export type AppClipLocalizationResource = Readonly<{
  id: string;
  locale: string;
  subtitle?: string;
}>;
/** One alternative-distribution domain */
export type AlternativeDistributionDomainResource = Readonly<{
  id: string;
  domain?: string;
  referenceName?: string;
}>;
/** The team's alternative-distribution **public** key */
export type AlternativeDistributionKeyResource = Readonly<{
  id: string;
  publicKey?: string;
}>;
/** An Apple Pay **merchant id** (e.g. */
export type MerchantIdResource = Readonly<{
  id: string;
  identifier?: string;
  name?: string;
}>;
/** A Wallet **pass type id** (e.g. */
export type PassTypeIdResource = Readonly<{
  id: string;
  identifier?: string;
  name?: string;
}>;
/** Apple's leaderboard score formatters */
export const LEADERBOARD_FORMATTERS = [
  'INTEGER',
  'DECIMAL_POINT_1_PLACE',
  'DECIMAL_POINT_2_PLACE',
  'DECIMAL_POINT_3_PLACE',
  'ELAPSED_TIME_CENTISECOND',
  'ELAPSED_TIME_MINUTE',
  'ELAPSED_TIME_SECOND',
  'MONEY_POUND_DECIMAL',
  'MONEY_POUND',
  'MONEY_DOLLAR_DECIMAL',
  'MONEY_DOLLAR',
  'MONEY_EURO_DECIMAL',
  'MONEY_EURO',
  'MONEY_FRANC_DECIMAL',
  'MONEY_FRANC',
  'MONEY_KRONER_DECIMAL',
  'MONEY_KRONER',
  'MONEY_YEN',
] as const satisfies readonly components['schemas']['GameCenterLeaderboardFormatter'][];
/** One of Apple's leaderboard score formatters. */
export type LeaderboardFormatter = components['schemas']['GameCenterLeaderboardFormatter'];
/** How a leaderboard score is aggregated and sorted */
export const LEADERBOARD_SUBMISSION_TYPES = ['BEST_SCORE', 'MOST_RECENT_SCORE'] as const;
type LeaderboardSubmissionType = (typeof LEADERBOARD_SUBMISSION_TYPES)[number];
export const LEADERBOARD_SORT_TYPES = ['ASC', 'DESC'] as const;
type LeaderboardSortType = (typeof LEADERBOARD_SORT_TYPES)[number];
/** An app's Game Center configuration container (read-only attributes; created to enable Game Center). */
export type GameCenterDetailResource = Readonly<{
  id: string;
}>;
/** A Game Center achievement, identified for config matching by its developer-chosen `vendorIdentifier`. */
export type GameCenterAchievementResource = Readonly<{
  id: string;
  vendorIdentifier?: string;
}>;
/** A Game Center leaderboard, identified for config matching by its developer-chosen `vendorIdentifier`. */
export type GameCenterLeaderboardResource = Readonly<{
  id: string;
  vendorIdentifier?: string;
}>;
/** Attributes for creating a Game Center achievement (mirrors Apple's `GameCenterAchievementV2CreateRequest`). */
export type GameCenterAchievementCreate = Readonly<{
  referenceName: string;
  vendorIdentifier: string;
  points: number;
  showBeforeEarned: boolean;
  repeatable: boolean;
}>;
/** Attributes for creating a Game Center leaderboard (mirrors Apple's `GameCenterLeaderboardV2CreateRequest`). */
export type GameCenterLeaderboardCreate = Readonly<{
  referenceName: string;
  vendorIdentifier: string;
  defaultFormatter: LeaderboardFormatter;
  submissionType: LeaderboardSubmissionType;
  scoreSortType: LeaderboardSortType;
}>;
