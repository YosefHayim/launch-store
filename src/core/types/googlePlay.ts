import type { PlayMoneyUnits } from './playPricing.js';

export type PlayRelease = {
  name?: string;
  versionCodes?: string[];
  status?: string;
  userFraction?: number;
  releaseNotes?: { language: string; text: string }[];
};
export type PlayTrackInfo = { track: string; releases: PlayRelease[] };
export type PlayCountryAvailability = {
  restOfWorld?: boolean;
  countries: { countryCode: string }[];
};
export type PlayMoney = { priceMicros?: string; currency?: string };
export type InAppProductResource = {
  sku: string;
  status?: string;
  purchaseType?: string;
  defaultLanguage?: string;
  defaultPrice?: PlayMoney;
  prices?: Record<string, PlayMoney>;
  listings?: Record<string, { title?: string; description?: string }>;
};
export type SubscriptionListing = {
  languageCode: string;
  title: string;
  description: string;
  benefits?: string[];
};
export type RegionalBasePlanConfig = {
  regionCode: string;
  newSubscriberAvailability?: boolean;
  price?: PlayMoneyUnits;
};
export type AutoRenewingBasePlanType = { billingPeriodDuration: string };
export type BasePlan = {
  basePlanId: string;
  state?: string;
  autoRenewingBasePlanType?: AutoRenewingBasePlanType;
  regionalConfigs?: RegionalBasePlanConfig[];
  offerTags?: { tag: string }[];
};
export type SubscriptionResource = {
  packageName?: string;
  productId: string;
  basePlans?: BasePlan[];
  listings?: SubscriptionListing[];
};
export type RegionalSubscriptionOfferConfig = {
  regionCode: string;
  newSubscriberAvailability?: boolean;
};
export type OfferPhaseRegionalConfig = {
  regionCode: string;
  price?: PlayMoneyUnits;
  free?: Record<string, never>;
};
export type SubscriptionOfferPhase = {
  recurrenceCount: number;
  duration?: string;
  regionalConfigs: OfferPhaseRegionalConfig[];
};
export type SubscriptionOfferResource = {
  packageName?: string;
  productId?: string;
  basePlanId?: string;
  offerId: string;
  state?: string;
  phases: SubscriptionOfferPhase[];
  regionalConfigs: RegionalSubscriptionOfferConfig[];
  offerTags?: { tag: string }[];
};
export type PlayReview = {
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
};
export type PlayReplyResult = { replyText: string; lastEdited?: string };
