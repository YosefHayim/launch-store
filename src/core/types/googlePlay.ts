import type { PlayMoneyUnits } from './playPricing.js';

export type PlayRelease = Readonly<{
  name?: string;
  versionCodes?: readonly string[];
  status?: string;
  userFraction?: number;
  releaseNotes?: Readonly<{ language: string; text: string }>[];
}>;
export type PlayTrackInfo = Readonly<{ track: string; releases: readonly PlayRelease[] }>;
export type PlayCountryAvailability = Readonly<{
  restOfWorld?: boolean;
  countries: Readonly<{ countryCode: string }>[];
}>;
export type PlayMoney = Readonly<{ priceMicros?: string; currency?: string }>;
export type InAppProductResource = Readonly<{
  sku: string;
  status?: string;
  purchaseType?: string;
  defaultLanguage?: string;
  defaultPrice?: PlayMoney;
  prices?: Record<string, PlayMoney>;
  listings?: Record<string, Readonly<{ title?: string; description?: string }>>;
}>;
export type SubscriptionListing = Readonly<{
  languageCode: string;
  title: string;
  description: string;
  benefits?: readonly string[];
}>;
export type RegionalBasePlanConfig = Readonly<{
  regionCode: string;
  newSubscriberAvailability?: boolean;
  price?: PlayMoneyUnits;
}>;
export type AutoRenewingBasePlanType = Readonly<{ billingPeriodDuration: string }>;
export type BasePlan = Readonly<{
  basePlanId: string;
  state?: string;
  autoRenewingBasePlanType?: AutoRenewingBasePlanType;
  regionalConfigs?: readonly RegionalBasePlanConfig[];
  offerTags?: Readonly<{ tag: string }>[];
}>;
export type SubscriptionResource = Readonly<{
  packageName?: string;
  productId: string;
  basePlans?: readonly BasePlan[];
  listings?: readonly SubscriptionListing[];
}>;
export type RegionalSubscriptionOfferConfig = Readonly<{
  regionCode: string;
  newSubscriberAvailability?: boolean;
}>;
export type OfferPhaseRegionalConfig = Readonly<{
  regionCode: string;
  price?: PlayMoneyUnits;
  free?: Record<string, never>;
}>;
export type SubscriptionOfferPhase = Readonly<{
  recurrenceCount: number;
  duration?: string;
  regionalConfigs: readonly OfferPhaseRegionalConfig[];
}>;
export type SubscriptionOfferResource = Readonly<{
  packageName?: string;
  productId?: string;
  basePlanId?: string;
  offerId: string;
  state?: string;
  phases: readonly SubscriptionOfferPhase[];
  regionalConfigs: readonly RegionalSubscriptionOfferConfig[];
  offerTags?: Readonly<{ tag: string }>[];
}>;
export type PlayReview = Readonly<{
  reviewId: string;
  authorName?: string;
  rating: number;
  text?: string;
  reviewerLanguage?: string;
  device?: string;
  appVersionName?: string;
  lastModified?: string;
  answered: boolean;
  developerReply?: string;
}>;
export type PlayReplyResult = Readonly<{ replyText: string; lastEdited?: string }>;
