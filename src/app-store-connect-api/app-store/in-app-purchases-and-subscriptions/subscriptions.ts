import type { components } from '@apple/generated/schema.js';
import type {
  IntroductoryOfferCreate,
  IntroductoryOfferResource,
  LocalizationResource,
  OfferCodeCreate,
  OfferCodeResource,
  PricePointResource,
  PromotionalOfferCreate,
  PromotionalOfferResource,
  ReviewScreenshotResource,
  SubscriptionGroupResource,
  SubscriptionResource,
} from '@core/types/appleCatalog.js';
import {
  APP_STORE_CONNECT_BASE_URL,
  type AppStoreConnectRequests,
  type LocaleCopy,
  type ResourceList,
  type ResourceSingle,
  putAssetFile,
  readTransportFile,
} from '@/app-store-connect-api/api-client.js';
import { matchPricePoint } from '@/app-store-connect-api/app-store/pricing-and-availability.js';
import {
  type VersionedLocalizationResources,
  makeVersionedLocalizations,
} from './in-app-purchases.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/auto-renewable-subscriptions
/** Lowercase-hex MD5 of an asset's bytes - the `sourceFileChecksum` Apple verifies at commit time. */
// Apple 409s an inline-created included resource (ENTITY_ERROR.INCLUDED.INVALID_ID) unless its id is
// a local id written as ${local-id}; the relationship references the same string.
export const inlinePriceId = (index: number): string => `\${price-${index}}`;
const SUBSCRIPTION_VERSION_RESOURCES: VersionedLocalizationResources = {
  versionsUrl: (parentId) => `${APP_STORE_CONNECT_BASE_URL}/subscriptions/${parentId}/versions`,
  versionType: 'subscriptionVersions',
  parentRelationship: 'subscription',
  parentType: 'subscriptions',
  localizationType: 'subscriptionLocalizations',
};
const SUBSCRIPTION_GROUP_VERSION_RESOURCES: VersionedLocalizationResources = {
  versionsUrl: (parentId) =>
    `${APP_STORE_CONNECT_BASE_URL}/subscriptionGroups/${parentId}/versions`,
  versionType: 'subscriptionGroupVersions',
  parentRelationship: 'subscriptionGroup',
  parentType: 'subscriptionGroups',
  localizationType: 'subscriptionGroupLocalizations',
};
export const makeSubscriptionsApi = (api: AppStoreConnectRequests) => {
  /** List an app's subscription groups. */
  const { listShownLocalizations, createLocalization } = makeVersionedLocalizations(api);
  const listSubscriptionGroups = async (appId: string): Promise<SubscriptionGroupResource[]> => {
    const appleResources = await api.requestAll<{
      referenceName?: string;
    }>(`/apps/${appId}/subscriptionGroups?limit=200&fields[subscriptionGroups]=referenceName`);
    return appleResources.flatMap((group) => {
      const referenceName = group.attributes.referenceName;
      if (referenceName === undefined) return [];
      return [{ id: group.id, referenceName }];
    });
  };
  /** Create a subscription group on an app. */
  const createSubscriptionGroup = async (
    appId: string,
    referenceName: string,
  ): Promise<SubscriptionGroupResource> => {
    const appleResources = await api.createResource<{
      referenceName?: string;
    }>('/subscriptionGroups', {
      type: 'subscriptionGroups',
      attributes: { referenceName },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    let createdReferenceName = appleResources.attributes.referenceName;
    if (createdReferenceName === undefined) createdReferenceName = referenceName;
    return { id: appleResources.id, referenceName: createdReferenceName };
  };
  /** List the display-name localizations a subscription group shows: its draft's, else its newest version's. */
  const listSubscriptionGroupLocalizations = async (
    groupId: string,
  ): Promise<LocalizationResource[]> => {
    return listShownLocalizations(SUBSCRIPTION_GROUP_VERSION_RESOURCES, groupId);
  };
  /** Create one locale's display name for a subscription group (groups carry a name only). */
  const createSubscriptionGroupLocalization = async (
    groupId: string,
    copy: Omit<LocaleCopy, 'description'>,
  ): Promise<LocalizationResource> => {
    return createLocalization(SUBSCRIPTION_GROUP_VERSION_RESOURCES, groupId, copy);
  };
  /** List the subscriptions in a group. */
  const listSubscriptions = async (groupId: string): Promise<SubscriptionResource[]> => {
    const appleResources = await api.requestAll<{
      productId?: string;
      name?: string;
      subscriptionPeriod?: string;
      state?: string;
    }>(
      `/subscriptionGroups/${groupId}/subscriptions?limit=200&fields[subscriptions]=productId,name,subscriptionPeriod,state`,
    );
    return appleResources.map((subscription) => {
      let productId = subscription.attributes.productId;
      if (productId === undefined) productId = '';
      let subscriptionName = subscription.attributes.name;
      if (subscriptionName === undefined) subscriptionName = '';
      const subscriptionResource: SubscriptionResource = {
        id: subscription.id,
        productId,
        name: subscriptionName,
      };
      if (subscription.attributes.subscriptionPeriod !== undefined)
        Object.assign(subscriptionResource, {
          subscriptionPeriod: subscription.attributes.subscriptionPeriod,
        });
      if (subscription.attributes.state !== undefined)
        Object.assign(subscriptionResource, { state: subscription.attributes.state });
      return subscriptionResource;
    });
  };
  /** Create an auto-renewable subscription in a group. */
  const createSubscription = async (
    groupId: string,
    input: {
      productId: string;
      name: string;
      subscriptionPeriod: string;
      groupLevel: number;
    },
  ): Promise<SubscriptionResource> => {
    const appleResources = await api.createResource<{
      productId?: string;
      name?: string;
    }>('/subscriptions', {
      type: 'subscriptions',
      attributes: {
        productId: input.productId,
        name: input.name,
        subscriptionPeriod: input.subscriptionPeriod,
        groupLevel: input.groupLevel,
      },
      relationships: { group: { data: { type: 'subscriptionGroups', id: groupId } } },
    });
    let productId = appleResources.attributes.productId;
    if (productId === undefined) productId = input.productId;
    let subscriptionName = appleResources.attributes.name;
    if (subscriptionName === undefined) subscriptionName = input.name;
    return { id: appleResources.id, productId, name: subscriptionName };
  };
  /** List the display-copy localizations a subscription shows: its draft's, else its newest version's. */
  const listSubscriptionLocalizations = async (
    subscriptionId: string,
  ): Promise<LocalizationResource[]> => {
    return listShownLocalizations(SUBSCRIPTION_VERSION_RESOURCES, subscriptionId);
  };
  /** Create one locale's display copy for a subscription on its draft version. */
  const createSubscriptionLocalization = async (
    subscriptionId: string,
    copy: LocaleCopy,
  ): Promise<LocalizationResource> => {
    return createLocalization(SUBSCRIPTION_VERSION_RESOURCES, subscriptionId, copy);
  };
  /** Whether a subscription already has at least one price set (so the reconciler skips re-pricing it). */
  const subscriptionHasPrice = async (subscriptionId: string): Promise<boolean> => {
    const { data: appleResources } = await api.request<ResourceList<unknown>>(
      'GET',
      `/subscriptions/${subscriptionId}/prices?limit=1`,
    );
    return appleResources.length > 0;
  };
  /** Find the subscription price point in `territory` whose customer price equals `customerPrice`, or null. */
  const findSubscriptionPricePoint = async (
    subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> => {
    const points = await api.requestAll<{
      customerPrice?: string;
      territory?: string;
    }>(
      `/subscriptions/${subscriptionId}/pricePoints?filter[territory]=${encodeURIComponent(territory)}&limit=8000`,
    );
    return matchPricePoint(points, territory, customerPrice);
  };
  /** Set a subscription's price by linking it to a resolved price point (effective immediately). */
  const createSubscriptionPrice = async (
    subscriptionId: string,
    pricePointId: string,
  ): Promise<void> => {
    await api.createResource('/subscriptionPrices', {
      type: 'subscriptionPrices',
      attributes: { preserveCurrentPrice: false },
      relationships: {
        subscription: { data: { type: 'subscriptions', id: subscriptionId } },
        subscriptionPricePoint: { data: { type: 'subscriptionPricePoints', id: pricePointId } },
      },
    });
  };
  /** List a subscription's offer-code campaigns (the reconciler's `name`-keyed idempotency set). */
  const listSubscriptionOfferCodes = async (
    subscriptionId: string,
  ): Promise<OfferCodeResource[]> => {
    const appleResources = await api.requestAll<{
      name?: string;
      active?: boolean;
    }>(`/subscriptions/${subscriptionId}/offerCodes?limit=200`);
    return appleResources.map((offerCode) => {
      let offerName = offerCode.attributes.name;
      if (offerName === undefined) offerName = '';
      let active = offerCode.attributes.active;
      if (active === undefined) active = false;
      return { id: offerCode.id, name: offerName, active };
    });
  };
  /** Create an offer-code campaign with its per-territory prices (temp-id + `included` inline pattern). */
  const createSubscriptionOfferCode = async (
    input: OfferCodeCreate,
  ): Promise<OfferCodeResource> => {
    const requestDocument: components['schemas']['SubscriptionOfferCodeCreateRequest'] = {
      data: {
        type: 'subscriptionOfferCodes',
        attributes: {
          name: input.name,
          customerEligibilities: [...input.customerEligibilities],
          offerEligibility: input.offerEligibility,
          duration: input.duration,
          offerMode: input.offerMode,
          numberOfPeriods: input.numberOfPeriods,
        },
        relationships: {
          subscription: { data: { type: 'subscriptions', id: input.subscriptionId } },
          prices: {
            data: input.prices.map((_, index) => ({
              type: 'subscriptionOfferCodePrices',
              id: inlinePriceId(index),
            })),
          },
        },
      },
      included: input.prices.map((price, index) => ({
        type: 'subscriptionOfferCodePrices',
        id: inlinePriceId(index),
        relationships: {
          territory: { data: { type: 'territories', id: price.territory } },
          subscriptionPricePoint: {
            data: { type: 'subscriptionPricePoints', id: price.pricePointId },
          },
        },
      })),
    };
    const { data: appleResources } = await api.request<
      ResourceSingle<{
        name?: string;
        active?: boolean;
      }>
    >('POST', '/subscriptionOfferCodes', requestDocument);
    let offerName = appleResources.attributes.name;
    if (offerName === undefined) offerName = input.name;
    let active = appleResources.attributes.active;
    if (active === undefined) active = true;
    return { id: appleResources.id, name: offerName, active };
  };
  /** Deactivate an offer-code campaign (Apple only lets you toggle `active`, never edit the terms). */
  const deactivateOfferCode = async (offerCodeId: string): Promise<void> => {
    const requestDocument: components['schemas']['SubscriptionOfferCodeUpdateRequest'] = {
      data: { type: 'subscriptionOfferCodes', id: offerCodeId, attributes: { active: false } },
    };
    await api.request<unknown>('PATCH', `/subscriptionOfferCodes/${offerCodeId}`, requestDocument);
  };
  /** Generate a batch of one-time-use codes under an offer-code campaign. */
  const createOfferCodeOneTimeUseBatch = async (
    offerCodeId: string,
    numberOfCodes: number,
    expirationDate: string,
  ): Promise<void> => {
    const requestDocument: components['schemas']['SubscriptionOfferCodeOneTimeUseCodeCreateRequest'] =
      {
        data: {
          type: 'subscriptionOfferCodeOneTimeUseCodes',
          attributes: { numberOfCodes, expirationDate },
          relationships: {
            offerCode: { data: { type: 'subscriptionOfferCodes', id: offerCodeId } },
          },
        },
      };
    await api.request<unknown>('POST', '/subscriptionOfferCodeOneTimeUseCodes', requestDocument);
  };
  /** Create a custom (shareable) code under an offer-code campaign, redeemable `numberOfCodes` times. */
  const createOfferCodeCustomCode = async (
    offerCodeId: string,
    customCode: string,
    numberOfCodes: number,
    expirationDate?: string,
  ): Promise<void> => {
    const customCodeAttributes = { customCode, numberOfCodes };
    if (expirationDate !== undefined) Object.assign(customCodeAttributes, { expirationDate });
    const requestDocument: components['schemas']['SubscriptionOfferCodeCustomCodeCreateRequest'] = {
      data: {
        type: 'subscriptionOfferCodeCustomCodes',
        attributes: customCodeAttributes,
        relationships: { offerCode: { data: { type: 'subscriptionOfferCodes', id: offerCodeId } } },
      },
    };
    await api.request<unknown>('POST', '/subscriptionOfferCodeCustomCodes', requestDocument);
  };
  /** List a subscription's promotional offers (keyed by the StoreKit-facing `offerCode`). */
  const listPromotionalOffers = async (
    subscriptionId: string,
  ): Promise<PromotionalOfferResource[]> => {
    const appleResources = await api.requestAll<{
      name?: string;
      offerCode?: string;
    }>(`/subscriptions/${subscriptionId}/promotionalOffers?limit=200`);
    return appleResources.map((offer) => {
      let offerName = offer.attributes.name;
      if (offerName === undefined) offerName = '';
      let offerCode = offer.attributes.offerCode;
      if (offerCode === undefined) offerCode = '';
      return { id: offer.id, name: offerName, offerCode };
    });
  };
  /** Create a promotional offer with its per-territory prices. */
  const createPromotionalOffer = async (
    input: PromotionalOfferCreate,
  ): Promise<PromotionalOfferResource> => {
    const requestDocument: components['schemas']['SubscriptionPromotionalOfferCreateRequest'] = {
      data: {
        type: 'subscriptionPromotionalOffers',
        attributes: {
          duration: input.duration,
          name: input.name,
          numberOfPeriods: input.numberOfPeriods,
          offerCode: input.offerCode,
          offerMode: input.offerMode,
        },
        relationships: {
          subscription: { data: { type: 'subscriptions', id: input.subscriptionId } },
          prices: {
            data: input.prices.map((_, index) => ({
              type: 'subscriptionPromotionalOfferPrices',
              id: inlinePriceId(index),
            })),
          },
        },
      },
      included: input.prices.map((price, index) => ({
        type: 'subscriptionPromotionalOfferPrices',
        id: inlinePriceId(index),
        relationships: {
          territory: { data: { type: 'territories', id: price.territory } },
          subscriptionPricePoint: {
            data: { type: 'subscriptionPricePoints', id: price.pricePointId },
          },
        },
      })),
    };
    const { data: appleResources } = await api.request<
      ResourceSingle<{
        name?: string;
        offerCode?: string;
      }>
    >('POST', '/subscriptionPromotionalOffers', requestDocument);
    let offerName = appleResources.attributes.name;
    if (offerName === undefined) offerName = input.name;
    let offerCode = appleResources.attributes.offerCode;
    if (offerCode === undefined) offerCode = input.offerCode;
    return { id: appleResources.id, name: offerName, offerCode };
  };
  /** List a subscription's introductory offers, keyed by territory (null = an all-territories offer). */
  const listIntroductoryOffers = async (
    subscriptionId: string,
  ): Promise<IntroductoryOfferResource[]> => {
    const { data: appleResources } = await api.request<{
      data: {
        id: string;
        relationships?: {
          territory?: {
            data?: {
              id: string;
            } | null;
          };
        };
      }[];
    }>('GET', `/subscriptions/${subscriptionId}/introductoryOffers?include=territory&limit=200`);
    return appleResources.map((offer) => {
      let territoryId: string | null = null;
      const returnedTerritoryId = offer.relationships?.territory?.data?.id;
      if (returnedTerritoryId !== undefined) territoryId = returnedTerritoryId;
      return { id: offer.id, territory: territoryId };
    });
  };
  /** Create an introductory offer for one territory (or all territories when `territory`/`price` are null). */
  const createIntroductoryOffer = async (input: IntroductoryOfferCreate): Promise<void> => {
    const introductoryOfferAttributes = {
      duration: input.duration,
      offerMode: input.offerMode,
      numberOfPeriods: input.numberOfPeriods,
    };
    if (input.startDate !== undefined)
      Object.assign(introductoryOfferAttributes, { startDate: input.startDate });
    if (input.endDate !== undefined)
      Object.assign(introductoryOfferAttributes, { endDate: input.endDate });
    const introductoryOfferRelationships = {
      subscription: { data: { type: 'subscriptions' as const, id: input.subscriptionId } },
    };
    if (input.territory !== null)
      Object.assign(introductoryOfferRelationships, {
        territory: { data: { type: 'territories', id: input.territory } },
      });
    if (input.price !== null)
      Object.assign(introductoryOfferRelationships, {
        subscriptionPricePoint: {
          data: { type: 'subscriptionPricePoints', id: input.price.pricePointId },
        },
      });
    const requestDocument: components['schemas']['SubscriptionIntroductoryOfferCreateRequest'] = {
      data: {
        type: 'subscriptionIntroductoryOffers',
        attributes: introductoryOfferAttributes,
        relationships: introductoryOfferRelationships,
      },
    };
    await api.request<unknown>('POST', '/subscriptionIntroductoryOffers', requestDocument);
  };
  /** The subscription's current App Review screenshot, or null when it has none. */
  const getSubscriptionReviewScreenshot = async (
    subscriptionId: string,
  ): Promise<ReviewScreenshotResource | null> => {
    const { data: appleResources } = await api.request<{
      data: {
        id: string;
        attributes: {
          sourceFileChecksum?: string;
          assetDeliveryState?: {
            state?: string;
          };
        };
      } | null;
    }>(
      'GET',
      `/subscriptions/${subscriptionId}/appStoreReviewScreenshot?fields[subscriptionAppStoreReviewScreenshots]=sourceFileChecksum,assetDeliveryState`,
    );
    if (!appleResources) return null;
    const reviewScreenshot: ReviewScreenshotResource = { id: appleResources.id };
    if (appleResources.attributes.sourceFileChecksum !== undefined)
      Object.assign(reviewScreenshot, {
        sourceFileChecksum: appleResources.attributes.sourceFileChecksum,
      });
    if (appleResources.attributes.assetDeliveryState?.state !== undefined)
      Object.assign(reviewScreenshot, {
        assetDeliveryState: appleResources.attributes.assetDeliveryState.state,
      });
    return reviewScreenshot;
  };
  /** Upload a subscription's App Review screenshot via the reserve->PUT->commit flow. */
  const uploadSubscriptionReviewScreenshot = async (
    subscriptionId: string,
    fileName: string,
    filePath: string,
  ): Promise<void> => {
    const bytes = await readTransportFile(filePath);
    const { id, operations } = await api.reserveAsset(
      'subscriptionAppStoreReviewScreenshots',
      { relationship: 'subscription', type: 'subscriptions', id: subscriptionId },
      fileName,
      bytes.byteLength,
    );
    await putAssetFile(operations, filePath, bytes.byteLength);
    await api.commitAsset('subscriptionAppStoreReviewScreenshots', id, bytes);
  };
  return {
    listSubscriptionGroups,
    createSubscriptionGroup,
    listSubscriptionGroupLocalizations,
    createSubscriptionGroupLocalization,
    listSubscriptions,
    createSubscription,
    listSubscriptionLocalizations,
    createSubscriptionLocalization,
    subscriptionHasPrice,
    findSubscriptionPricePoint,
    createSubscriptionPrice,
    listSubscriptionOfferCodes,
    createSubscriptionOfferCode,
    deactivateOfferCode,
    createOfferCodeOneTimeUseBatch,
    createOfferCodeCustomCode,
    listPromotionalOffers,
    createPromotionalOffer,
    listIntroductoryOffers,
    createIntroductoryOffer,
    getSubscriptionReviewScreenshot,
    uploadSubscriptionReviewScreenshot,
  };
};
