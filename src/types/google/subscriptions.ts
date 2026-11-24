// Google Play subscription, base plan, and offer resources.

import type { PlayMoneyUnits } from './monetization.ts';

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

type AutoRenewingBasePlanType = Readonly<{ billingPeriodDuration: string }>;

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
