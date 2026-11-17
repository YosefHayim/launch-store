// Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions
import type { androidpublisher_v3 } from '@googleapis/androidpublisher';
import type {
  BasePlan,
  OfferPhaseRegionalConfig,
  RegionalBasePlanConfig,
  RegionalSubscriptionOfferConfig,
  SubscriptionListing,
  SubscriptionOfferPhase,
  SubscriptionOfferResource,
  SubscriptionResource,
} from '@/core/types/googlePlay.js';
import type { MutableDeep } from '@/core/types/mutable.js';
import {
  collectGeneratedPages,
  mutableGoogleRequest,
  normalizeMoney,
  type PlayRequests,
} from '@/play-console-api/api-client.js';

/**
 * Region snapshot the subscriptions monetization API pins prices against - a required query parameter on
 * every subscription/offer write. `2022/02` is Google's current published version; bump it here if Google
 * retires it (the API rejects an unsupported value with an actionable message).
 */
const REGIONS_VERSION = '2022/02';

const offerTagsFromGoogle = (
  googleTags: androidpublisher_v3.Schema$OfferTag[] | null | undefined,
):
  | {
      tag: string;
    }[]
  | undefined => {
  if (!Array.isArray(googleTags)) return;
  const offerTags: {
    tag: string;
  }[] = [];
  for (const googleTag of googleTags) {
    if (typeof googleTag.tag === 'string') offerTags.push({ tag: googleTag.tag });
  }
  return offerTags;
};

const readBasePlan = (
  googlePlan: androidpublisher_v3.Schema$BasePlan,
): MutableDeep<BasePlan> | undefined => {
  if (typeof googlePlan.basePlanId !== 'string') return;
  const basePlan: MutableDeep<BasePlan> = { basePlanId: googlePlan.basePlanId };
  if (typeof googlePlan.state === 'string') basePlan.state = googlePlan.state;
  const billingPeriod = googlePlan.autoRenewingBasePlanType?.billingPeriodDuration;
  if (typeof billingPeriod === 'string') {
    basePlan.autoRenewingBasePlanType = { billingPeriodDuration: billingPeriod };
  }
  if (Array.isArray(googlePlan.regionalConfigs)) {
    const regionalConfigs: MutableDeep<RegionalBasePlanConfig>[] = [];
    for (const googleRegion of googlePlan.regionalConfigs) {
      if (typeof googleRegion.regionCode !== 'string') continue;
      const regionalConfig: MutableDeep<RegionalBasePlanConfig> = {
        regionCode: googleRegion.regionCode,
      };
      if (typeof googleRegion.newSubscriberAvailability === 'boolean') {
        regionalConfig.newSubscriberAvailability = googleRegion.newSubscriberAvailability;
      }
      if (googleRegion.price !== undefined) {
        regionalConfig.price = normalizeMoney(googleRegion.price);
      }
      regionalConfigs.push(regionalConfig);
    }
    basePlan.regionalConfigs = regionalConfigs;
  }
  const offerTags = offerTagsFromGoogle(googlePlan.offerTags);
  if (offerTags !== undefined) basePlan.offerTags = offerTags;
  return basePlan;
};

const readSubscription = (
  googleSubscription: androidpublisher_v3.Schema$Subscription,
): SubscriptionResource | undefined => {
  if (typeof googleSubscription.productId !== 'string') return;
  const subscription: MutableDeep<SubscriptionResource> = {
    productId: googleSubscription.productId,
  };
  if (typeof googleSubscription.packageName === 'string') {
    subscription.packageName = googleSubscription.packageName;
  }
  if (Array.isArray(googleSubscription.basePlans)) {
    const basePlans: MutableDeep<BasePlan>[] = [];
    for (const googlePlan of googleSubscription.basePlans) {
      const basePlan = readBasePlan(googlePlan);
      if (basePlan !== undefined) basePlans.push(basePlan);
    }
    subscription.basePlans = basePlans;
  }
  if (Array.isArray(googleSubscription.listings)) {
    const listings: MutableDeep<SubscriptionListing>[] = [];
    for (const googleListing of googleSubscription.listings) {
      if (typeof googleListing.languageCode !== 'string') continue;
      if (typeof googleListing.title !== 'string') continue;
      if (typeof googleListing.description !== 'string') continue;
      const listing: MutableDeep<SubscriptionListing> = {
        languageCode: googleListing.languageCode,
        title: googleListing.title,
        description: googleListing.description,
      };
      if (Array.isArray(googleListing.benefits)) listing.benefits = googleListing.benefits;
      listings.push(listing);
    }
    subscription.listings = listings;
  }
  return subscription;
};

const readSubscriptionOffer = (
  googleOffer: androidpublisher_v3.Schema$SubscriptionOffer,
): SubscriptionOfferResource | undefined => {
  if (typeof googleOffer.offerId !== 'string') return;
  const offer: MutableDeep<SubscriptionOfferResource> = {
    offerId: googleOffer.offerId,
    phases: [],
    regionalConfigs: [],
  };
  if (typeof googleOffer.packageName === 'string') offer.packageName = googleOffer.packageName;
  if (typeof googleOffer.productId === 'string') offer.productId = googleOffer.productId;
  if (typeof googleOffer.basePlanId === 'string') offer.basePlanId = googleOffer.basePlanId;
  if (typeof googleOffer.state === 'string') offer.state = googleOffer.state;
  if (Array.isArray(googleOffer.regionalConfigs)) {
    for (const googleRegion of googleOffer.regionalConfigs) {
      if (typeof googleRegion.regionCode !== 'string') continue;
      const regionalConfig: MutableDeep<RegionalSubscriptionOfferConfig> = {
        regionCode: googleRegion.regionCode,
      };
      if (typeof googleRegion.newSubscriberAvailability === 'boolean') {
        regionalConfig.newSubscriberAvailability = googleRegion.newSubscriberAvailability;
      }
      offer.regionalConfigs.push(regionalConfig);
    }
  }
  if (Array.isArray(googleOffer.phases)) {
    for (const googlePhase of googleOffer.phases) {
      if (typeof googlePhase.recurrenceCount !== 'number') continue;
      const phase: MutableDeep<SubscriptionOfferPhase> = {
        recurrenceCount: googlePhase.recurrenceCount,
        regionalConfigs: [],
      };
      if (typeof googlePhase.duration === 'string') phase.duration = googlePhase.duration;
      if (Array.isArray(googlePhase.regionalConfigs)) {
        for (const googleRegion of googlePhase.regionalConfigs) {
          if (typeof googleRegion.regionCode !== 'string') continue;
          const regionalConfig: MutableDeep<OfferPhaseRegionalConfig> = {
            regionCode: googleRegion.regionCode,
          };
          if (googleRegion.price !== undefined) {
            regionalConfig.price = normalizeMoney(googleRegion.price);
          }
          if (googleRegion.free !== undefined) regionalConfig.free = {};
          phase.regionalConfigs.push(regionalConfig);
        }
      }
      offer.phases.push(phase);
    }
  }
  const offerTags = offerTagsFromGoogle(googleOffer.offerTags);
  if (offerTags !== undefined) offer.offerTags = offerTags;
  return offer;
};

export const makeSubscriptionsApi = (play: PlayRequests) => {
  /** List the app's subscription products (`monetization.subscriptions`), paging in full. */
  const listSubscriptions = (packageName: string): Promise<SubscriptionResource[]> =>
    collectGeneratedPages(
      (pageToken) => {
        const listParameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$List =
          { packageName };
        if (pageToken !== undefined) listParameters.pageToken = pageToken;
        return play.send('list subscriptions', () =>
          play.publisher.monetization.subscriptions.list(listParameters),
        );
      },
      (subscriptionPage) => {
        const subscriptions: SubscriptionResource[] = [];
        if (!Array.isArray(subscriptionPage.subscriptions)) return subscriptions;
        for (const googleSubscription of subscriptionPage.subscriptions) {
          const subscription = readSubscription(googleSubscription);
          if (subscription !== undefined) subscriptions.push(subscription);
        }
        return subscriptions;
      },
      (subscriptionPage) => subscriptionPage.nextPageToken,
    );

  /**
   * Create a subscription with its base plans (which Play creates in DRAFT - activate them separately).
   * `regionsVersion.version` is required; the product id is sent in the query and request document.
   */
  const createSubscription = async (
    packageName: string,
    subscription: SubscriptionResource,
  ): Promise<void> => {
    await play.send('create subscription', () =>
      play.publisher.monetization.subscriptions.create({
        packageName,
        productId: subscription.productId,
        'regionsVersion.version': REGIONS_VERSION,
        requestBody: mutableGoogleRequest<androidpublisher_v3.Schema$Subscription>({
          ...subscription,
          packageName,
        }),
      }),
    );
  };

  /**
   * Patch a subscription's masked fields (PATCH with an `updateMask` - Play requires field-level updates).
   * The masked fields are replaced by `subscription`, so the reconciler sends a merged document
   * (e.g. existing listings + the changed ones) to stay additive.
   */
  const patchSubscription = async (
    packageName: string,
    subscription: SubscriptionResource,
    updateMask: string,
  ): Promise<void> => {
    await play.send('patch subscription', () =>
      play.publisher.monetization.subscriptions.patch({
        packageName,
        productId: subscription.productId,
        updateMask,
        'regionsVersion.version': REGIONS_VERSION,
        requestBody: mutableGoogleRequest<androidpublisher_v3.Schema$Subscription>({
          ...subscription,
          packageName,
        }),
      }),
    );
  };

  /** Activate a base plan (DRAFT -> ACTIVE), making it purchasable. Idempotent on an already-active plan. */
  const activateBasePlan = async (
    packageName: string,
    productId: string,
    basePlanId: string,
  ): Promise<void> => {
    await play.send('activate base plan', () =>
      play.publisher.monetization.subscriptions.basePlans.activate({
        packageName,
        productId,
        basePlanId,
        requestBody: { packageName, productId, basePlanId },
      }),
    );
  };

  /** List the offers on one base plan, paging in full. */
  const listSubscriptionOffers = (
    packageName: string,
    productId: string,
    basePlanId: string,
  ): Promise<SubscriptionOfferResource[]> =>
    collectGeneratedPages(
      (pageToken) => {
        const listParameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$List =
          { packageName, productId, basePlanId };
        if (pageToken !== undefined) listParameters.pageToken = pageToken;
        return play.send('list subscription offers', () =>
          play.publisher.monetization.subscriptions.basePlans.offers.list(listParameters),
        );
      },
      (offerPage) => {
        const offers: SubscriptionOfferResource[] = [];
        if (!Array.isArray(offerPage.subscriptionOffers)) return offers;
        for (const googleOffer of offerPage.subscriptionOffers) {
          const offer = readSubscriptionOffer(googleOffer);
          if (offer !== undefined) offers.push(offer);
        }
        return offers;
      },
      (offerPage) => offerPage.nextPageToken,
    );

  /** Create a subscription offer (in DRAFT - activate it separately). `regionsVersion.version` is required. */
  const createSubscriptionOffer = async (
    packageName: string,
    offer: SubscriptionOfferResource,
  ): Promise<void> => {
    let productId = '';
    let basePlanId = '';
    if (offer.productId !== undefined) productId = offer.productId;
    if (offer.basePlanId !== undefined) basePlanId = offer.basePlanId;
    await play.send('create subscription offer', () =>
      play.publisher.monetization.subscriptions.basePlans.offers.create({
        packageName,
        productId,
        basePlanId,
        offerId: offer.offerId,
        'regionsVersion.version': REGIONS_VERSION,
        requestBody: mutableGoogleRequest<androidpublisher_v3.Schema$SubscriptionOffer>({
          ...offer,
          packageName,
        }),
      }),
    );
  };

  /** Activate a subscription offer (DRAFT -> ACTIVE), making it available. */
  const activateSubscriptionOffer = async (
    packageName: string,
    productId: string,
    basePlanId: string,
    offerId: string,
  ): Promise<void> => {
    await play.send('activate subscription offer', () =>
      play.publisher.monetization.subscriptions.basePlans.offers.activate({
        packageName,
        productId,
        basePlanId,
        offerId,
        requestBody: { packageName, productId, basePlanId, offerId },
      }),
    );
  };

  return {
    listSubscriptions,
    createSubscription,
    patchSubscription,
    activateBasePlan,
    listSubscriptionOffers,
    createSubscriptionOffer,
    activateSubscriptionOffer,
  };
};
