// App Store Connect subscription groups, subscriptions, and offers.

import type {
  OfferCustomerEligibility,
  OfferDuration,
  OfferEligibility,
  OfferMode,
} from '../catalog.ts';

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

/** A subscription's App Review screenshot (`subscriptionAppStoreReviewScreenshots`) */
export type ReviewScreenshotResource = Readonly<{
  id: string;
  sourceFileChecksum?: string;
  assetDeliveryState?: string;
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
