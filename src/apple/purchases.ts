// Creates in-app purchases, subscriptions, and their offers on App Store Connect.

import type { AscHost } from './host.ts';
import type {
  InAppPurchaseResource,
  IntroductoryOfferCreate,
  IntroductoryOfferResource,
  LocalizationResource,
  OfferCodeCreate,
  OfferCodeResource,
  PricePointResource,
  PromotedPurchaseCreate,
  PromotedPurchaseResource,
  PromotionalOfferCreate,
  PromotionalOfferResource,
  SubscriptionGroupResource,
  SubscriptionResource,
  WinBackOfferCreate,
  WinBackOfferResource,
} from '../types/apple-catalog.ts';
import type {
  VersionedLocalizationResources,
  ProductVersion,
  LocaleCopy,
  ResourceList,
  ResourceSingle,
  PromotedPurchasePage,
} from './shared.ts';
import type { components } from '../types/apple-api-types.ts';
import {
  IN_APP_PURCHASE_VERSION_RESOURCES,
  SUBSCRIPTION_VERSION_RESOURCES,
  SUBSCRIPTION_GROUP_VERSION_RESOURCES,
  pickDraftVersion,
  pickNewestVersion,
  inlinePriceId,
  matchPricePoint,
} from './shared.ts';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, type AppleListQuery } from './list-query.ts';

export class ConnectPurchases {
  constructor(private readonly client: AscHost) {}

  /**
   * Get a list of the In-App Purchases for a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-inapppurchasesv2
   */
  async listInAppPurchases(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<InAppPurchaseResource[]> {
    const appleResources = await this.client.requestAll<{
      productId?: string;
      name?: string;
      inAppPurchaseType?: string;
      state?: string;
    }>(
      applyAppleListQuery(`/apps/${appId}/inAppPurchasesV2`, listQuery, APPLE_PAGE_LIMIT, {
        'fields[inAppPurchases]': 'productId,name,inAppPurchaseType,state',
      }),
    );

    function copyInAppPurchase(purchase: {
      id: string;
      attributes: { productId?: string; name?: string; inAppPurchaseType?: string; state?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let productId = purchase.attributes.productId;

      if (productId == null) productId = '';

      let purchaseName = purchase.attributes.name;

      if (purchaseName == null) purchaseName = '';

      let purchaseType = purchase.attributes.inAppPurchaseType;

      if (purchaseType == null) purchaseType = '';

      const inAppPurchase: InAppPurchaseResource = {
        id: purchase.id,
        productId,
        name: purchaseName,
        inAppPurchaseType: purchaseType,
      };

      if (purchase.attributes.state != null)
        Object.assign(inAppPurchase, { state: purchase.attributes.state });

      return inAppPurchase;
    }

    return appleResources.map(copyInAppPurchase);
  }

  /**
   * Create an In-App Purchase, including a consumable, non-consumable, or non-renewing
   * subscription.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v2-inapppurchases
   */
  async createInAppPurchase(
    appId: string,
    input: {
      productId: string;
      name: string;
      inAppPurchaseType: string;
    },
  ): Promise<InAppPurchaseResource> {
    const appleResources = await this.client.createResource<{
      productId?: string;
      name?: string;
      inAppPurchaseType?: string;
    }>(this.client.v2('/inAppPurchases'), {
      type: 'inAppPurchases',
      attributes: {
        productId: input.productId,
        name: input.name,
        inAppPurchaseType: input.inAppPurchaseType,
      },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    let productId = appleResources.attributes.productId;

    if (productId == null) productId = input.productId;

    let purchaseName = appleResources.attributes.name;

    if (purchaseName == null) purchaseName = input.name;

    let purchaseType = appleResources.attributes.inAppPurchaseType;

    if (purchaseType == null) purchaseType = input.inAppPurchaseType;

    return {
      id: appleResources.id,
      productId,
      name: purchaseName,
      inAppPurchaseType: purchaseType,
    };
  }

  async listInAppPurchaseLocalizations(iapId: string): Promise<LocalizationResource[]> {
    return this.listShownLocalizations(IN_APP_PURCHASE_VERSION_RESOURCES, iapId);
  }

  async createInAppPurchaseLocalization(
    iapId: string,
    copy: LocaleCopy,
  ): Promise<LocalizationResource> {
    return this.createLocalization(IN_APP_PURCHASE_VERSION_RESOURCES, iapId, copy);
  }

  /**
   * Get a list of subscription groups for a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-subscriptiongroups
   */
  async listSubscriptionGroups(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<SubscriptionGroupResource[]> {
    const appleResources = await this.client.requestAll<{
      referenceName?: string;
    }>(
      applyAppleListQuery(`/apps/${appId}/subscriptionGroups`, listQuery, APPLE_PAGE_LIMIT, {
        'fields[subscriptionGroups]': 'referenceName',
      }),
    );

    function readSubscriptionGroup(group: {
      id: string;
      attributes: { referenceName?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const referenceName = group.attributes.referenceName;

      if (referenceName == null) return [];

      return [{ id: group.id, referenceName }];
    }

    return appleResources.flatMap(readSubscriptionGroup);
  }

  /**
   * Create a subscription group for an app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptiongroups
   */
  async createSubscriptionGroup(
    appId: string,
    referenceName: string,
  ): Promise<SubscriptionGroupResource> {
    const appleResources = await this.client.createResource<{
      referenceName?: string;
    }>('/subscriptionGroups', {
      type: 'subscriptionGroups',
      attributes: { referenceName },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    let createdReferenceName = appleResources.attributes.referenceName;

    if (createdReferenceName == null) createdReferenceName = referenceName;

    return { id: appleResources.id, referenceName: createdReferenceName };
  }

  async listSubscriptionGroupLocalizations(groupId: string): Promise<LocalizationResource[]> {
    return this.listShownLocalizations(SUBSCRIPTION_GROUP_VERSION_RESOURCES, groupId);
  }

  async createSubscriptionGroupLocalization(
    groupId: string,
    copy: Omit<LocaleCopy, 'description'>,
  ): Promise<LocalizationResource> {
    return this.createLocalization(SUBSCRIPTION_GROUP_VERSION_RESOURCES, groupId, copy);
  }

  /**
   * Get a list of all auto-renewable subscriptions in a subscription group.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongroups-_id_-subscriptions
   */
  async listSubscriptions(
    groupId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<SubscriptionResource[]> {
    const appleResources = await this.client.requestAll<{
      productId?: string;
      name?: string;
      subscriptionPeriod?: string;
      state?: string;
    }>(
      applyAppleListQuery(
        `/subscriptionGroups/${groupId}/subscriptions`,
        listQuery,
        APPLE_PAGE_LIMIT,
        {
          'fields[subscriptions]': 'productId,name,subscriptionPeriod,state',
        },
      ),
    );

    function copySubscription(subscription: {
      id: string;
      attributes: {
        productId?: string;
        name?: string;
        subscriptionPeriod?: string;
        state?: string;
      };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let productId = subscription.attributes.productId;

      if (productId == null) productId = '';

      let subscriptionName = subscription.attributes.name;

      if (subscriptionName == null) subscriptionName = '';

      const subscriptionResource: SubscriptionResource = {
        id: subscription.id,
        productId,
        name: subscriptionName,
      };

      if (subscription.attributes.subscriptionPeriod != null)
        Object.assign(subscriptionResource, {
          subscriptionPeriod: subscription.attributes.subscriptionPeriod,
        });

      if (subscription.attributes.state != null)
        Object.assign(subscriptionResource, { state: subscription.attributes.state });

      return subscriptionResource;
    }

    return appleResources.map(copySubscription);
  }

  /**
   * Create an auto-renewable subscription for your app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptions
   */
  async createSubscription(
    groupId: string,
    input: {
      productId: string;
      name: string;
      subscriptionPeriod: string;
      groupLevel: number;
    },
  ): Promise<SubscriptionResource> {
    const appleResources = await this.client.createResource<{
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

    if (productId == null) productId = input.productId;

    let subscriptionName = appleResources.attributes.name;

    if (subscriptionName == null) subscriptionName = input.name;

    return { id: appleResources.id, productId, name: subscriptionName };
  }

  async listSubscriptionLocalizations(subscriptionId: string): Promise<LocalizationResource[]> {
    return this.listShownLocalizations(SUBSCRIPTION_VERSION_RESOURCES, subscriptionId);
  }

  async createSubscriptionLocalization(
    subscriptionId: string,
    copy: LocaleCopy,
  ): Promise<LocalizationResource> {
    return this.createLocalization(SUBSCRIPTION_VERSION_RESOURCES, subscriptionId, copy);
  }

  /**
   * Get a list of prices for an auto-renewable subscription, by territory.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-prices
   */
  async subscriptionHasPrice(subscriptionId: string): Promise<boolean> {
    const { data: appleResources } = await this.client.request<ResourceList<unknown>>(
      'GET',
      `/subscriptions/${subscriptionId}/prices?limit=1`,
    );

    return appleResources.length > 0;
  }

  /**
   * Get a list of price points for an auto-renewable subscription by territory.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-pricepoints
   */
  async findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
    listQuery: AppleListQuery | null = null,
  ): Promise<PricePointResource | null> {
    const uRIComponent = encodeURIComponent(territory);
    const points = await this.client.requestAll<{
      customerPrice?: string;
      territory?: string;
    }>(
      applyAppleListQuery(
        `/subscriptions/${subscriptionId}/pricePoints?filter[territory]=${uRIComponent}`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    return matchPricePoint(points, territory, customerPrice);
  }

  /**
   * Schedule a subscription price change for a specific territory.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionprices
   */
  async createSubscriptionPrice(subscriptionId: string, pricePointId: string): Promise<void> {
    await this.client.createResource('/subscriptionPrices', {
      type: 'subscriptionPrices',
      attributes: { preserveCurrentPrice: false },
      relationships: {
        subscription: { data: { type: 'subscriptions', id: subscriptionId } },
        subscriptionPricePoint: { data: { type: 'subscriptionPricePoints', id: pricePointId } },
      },
    });
  }

  /**
   * Get a list of subscription offer codes for a specific auto-renewable subscription.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-offercodes
   */
  async listSubscriptionOfferCodes(
    subscriptionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<OfferCodeResource[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
      active?: boolean;
    }>(
      applyAppleListQuery(
        `/subscriptions/${subscriptionId}/offerCodes`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    function copyOfferCode(offerCode: {
      id: string;
      attributes: { name?: string; active?: boolean };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let offerName = offerCode.attributes.name;

      if (offerName == null) offerName = '';

      let active = offerCode.attributes.active;

      if (active == null) active = false;

      return { id: offerCode.id, name: offerName, active };
    }

    return appleResources.map(copyOfferCode);
  }

  /**
   * Create a subscription offer that provides offer codes for an auto-renewable subscription.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionoffercodes
   */
  async createSubscriptionOfferCode(input: OfferCodeCreate): Promise<OfferCodeResource> {
    function writeOfferCodePriceLink(
      _: { readonly territory: string; readonly pricePointId: string },
      index: number,
    ) {
      return {
        type: 'subscriptionOfferCodePrices',
        id: inlinePriceId(index),
      } as const;
    }

    function writeOfferCodePrice(
      price: { readonly territory: string; readonly pricePointId: string },
      index: number,
    ) {
      return {
        type: 'subscriptionOfferCodePrices',
        id: inlinePriceId(index),
        relationships: {
          territory: { data: { type: 'territories', id: price.territory } },
          subscriptionPricePoint: {
            data: { type: 'subscriptionPricePoints', id: price.pricePointId },
          },
        },
      } as const;
    }

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
            data: input.prices.map(writeOfferCodePriceLink),
          },
        },
      },
      included: input.prices.map(writeOfferCodePrice),
    };
    const { data: appleResources } = await this.client.request<
      ResourceSingle<{
        name?: string;
        active?: boolean;
      }>
    >('POST', '/subscriptionOfferCodes', requestDocument);
    let offerName = appleResources.attributes.name;

    if (offerName == null) offerName = input.name;

    let active = appleResources.attributes.active;

    if (active == null) active = true;

    return { id: appleResources.id, name: offerName, active };
  }

  /**
   * Deactivate a subscription offer that has offer codes for an auto-renewable subscription.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptionoffercodes-_id_
   */
  async deactivateOfferCode(offerCodeId: string): Promise<void> {
    const requestDocument: components['schemas']['SubscriptionOfferCodeUpdateRequest'] = {
      data: { type: 'subscriptionOfferCodes', id: offerCodeId, attributes: { active: false } },
    };

    await this.client.request<unknown>(
      'PATCH',
      `/subscriptionOfferCodes/${offerCodeId}`,
      requestDocument,
    );
  }

  /**
   * Create one-time use codes for an auto-renewable subscription offer.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionoffercodeonetimeusecodes
   */
  async createOfferCodeOneTimeUseBatch(
    offerCodeId: string,
    numberOfCodes: number,
    expirationDate: string,
  ): Promise<void> {
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

    await this.client.request<unknown>(
      'POST',
      '/subscriptionOfferCodeOneTimeUseCodes',
      requestDocument,
    );
  }

  /**
   * Create custom offer codes for an auto-renewable subscription offer.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionoffercodecustomcodes
   */
  async createOfferCodeCustomCode(
    offerCodeId: string,
    customCode: string,
    numberOfCodes: number,
    expirationDate?: string,
  ): Promise<void> {
    const customCodeAttributes = { customCode, numberOfCodes };

    if (expirationDate != null) Object.assign(customCodeAttributes, { expirationDate });

    const requestDocument: components['schemas']['SubscriptionOfferCodeCustomCodeCreateRequest'] = {
      data: {
        type: 'subscriptionOfferCodeCustomCodes',
        attributes: customCodeAttributes,
        relationships: { offerCode: { data: { type: 'subscriptionOfferCodes', id: offerCodeId } } },
      },
    };

    await this.client.request<unknown>(
      'POST',
      '/subscriptionOfferCodeCustomCodes',
      requestDocument,
    );
  }

  /**
   * Get a list of promotional offers for a specific auto-renewable subscription.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-promotionaloffers
   */
  async listPromotionalOffers(
    subscriptionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<PromotionalOfferResource[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
      offerCode?: string;
    }>(
      applyAppleListQuery(
        `/subscriptions/${subscriptionId}/promotionalOffers`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    function copyPromotionalOffer(offer: {
      id: string;
      attributes: { name?: string; offerCode?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let offerName = offer.attributes.name;

      if (offerName == null) offerName = '';

      let offerCode = offer.attributes.offerCode;

      if (offerCode == null) offerCode = '';

      return { id: offer.id, name: offerName, offerCode };
    }

    return appleResources.map(copyPromotionalOffer);
  }

  /**
   * Create a promotional offer for an auto-renewable subscription.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionpromotionaloffers
   */
  async createPromotionalOffer(input: PromotionalOfferCreate): Promise<PromotionalOfferResource> {
    function writePromotionalPriceLink(
      _: { readonly territory: string; readonly pricePointId: string },
      index: number,
    ) {
      return {
        type: 'subscriptionPromotionalOfferPrices',
        id: inlinePriceId(index),
      } as const;
    }

    function writePromotionalPrice(
      price: { readonly territory: string; readonly pricePointId: string },
      index: number,
    ) {
      return {
        type: 'subscriptionPromotionalOfferPrices',
        id: inlinePriceId(index),
        relationships: {
          territory: { data: { type: 'territories', id: price.territory } },
          subscriptionPricePoint: {
            data: { type: 'subscriptionPricePoints', id: price.pricePointId },
          },
        },
      } as const;
    }

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
            data: input.prices.map(writePromotionalPriceLink),
          },
        },
      },
      included: input.prices.map(writePromotionalPrice),
    };
    const { data: appleResources } = await this.client.request<
      ResourceSingle<{
        name?: string;
        offerCode?: string;
      }>
    >('POST', '/subscriptionPromotionalOffers', requestDocument);
    let offerName = appleResources.attributes.name;

    if (offerName == null) offerName = input.name;

    let offerCode = appleResources.attributes.offerCode;

    if (offerCode == null) offerCode = input.offerCode;

    return { id: appleResources.id, name: offerName, offerCode };
  }

  /**
   * Get a list of introductory offers for a specific auto-renewable subscription.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-introductoryoffers
   */
  async listIntroductoryOffers(
    subscriptionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<IntroductoryOfferResource[]> {
    const { data: appleResources } = await this.client.request<{
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
    }>(
      'GET',
      applyAppleListQuery(
        `/subscriptions/${subscriptionId}/introductoryOffers`,
        listQuery,
        APPLE_PAGE_LIMIT,
        { include: 'territory' },
      ),
    );

    function copyIntroductoryOffer(offer: {
      id: string;
      relationships?: { territory?: { data?: { id: string } | null } };
    }) {
      let territoryId: string | null = null;
      const returnedTerritoryId = offer.relationships?.territory?.data?.id;

      if (returnedTerritoryId != null) territoryId = returnedTerritoryId;

      return { id: offer.id, territory: territoryId };
    }

    return appleResources.map(copyIntroductoryOffer);
  }

  /**
   * Create an introductory offer for an auto-renewable subscription.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionintroductoryoffers
   */
  async createIntroductoryOffer(input: IntroductoryOfferCreate): Promise<void> {
    const introductoryOfferAttributes = {
      duration: input.duration,
      offerMode: input.offerMode,
      numberOfPeriods: input.numberOfPeriods,
    };

    if (input.startDate != null)
      Object.assign(introductoryOfferAttributes, { startDate: input.startDate });

    if (input.endDate != null)
      Object.assign(introductoryOfferAttributes, { endDate: input.endDate });

    const introductoryOfferRelationships = {
      subscription: { data: { type: 'subscriptions' as const, id: input.subscriptionId } },
    };

    if (input.territory != null)
      Object.assign(introductoryOfferRelationships, {
        territory: { data: { type: 'territories', id: input.territory } },
      });

    if (input.price != null)
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

    await this.client.request<unknown>('POST', '/subscriptionIntroductoryOffers', requestDocument);
  }

  /**
   * List Win-Back Offers.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-winbackoffers
   */
  async listWinBackOffers(
    subscriptionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<WinBackOfferResource[]> {
    const appleResources = await this.client.requestAll<{
      offerId?: string;
    }>(
      applyAppleListQuery(
        `/subscriptions/${subscriptionId}/winBackOffers`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    function copyWinBackOffer(offer: {
      id: string;
      attributes: { offerId?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let offerId = offer.attributes.offerId;

      if (offerId == null) offerId = '';

      return { id: offer.id, offerId };
    }

    return appleResources.map(copyWinBackOffer);
  }

  /**
   * Create a win-back offer for a specific subscription.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-winbackoffers
   */
  async createWinBackOffer(input: WinBackOfferCreate): Promise<void> {
    const winBackAttributes = {
      referenceName: input.referenceName,
      offerId: input.offerId,
      duration: input.duration,
      offerMode: input.offerMode,
      periodCount: input.numberOfPeriods,
      customerEligibilityPaidSubscriptionDurationInMonths: input.eligiblePaidMonths,
      customerEligibilityTimeSinceLastSubscribedInMonths: {
        minimum: input.monthsSinceLastSubscribed.min,
        maximum: input.monthsSinceLastSubscribed.max,
      },
      startDate: input.startDate,
      priority: input.priority,
    };

    if (input.waitBetweenOffersMonths != null)
      Object.assign(winBackAttributes, {
        customerEligibilityWaitBetweenOffersInMonths: input.waitBetweenOffersMonths,
      });

    if (input.endDate != null) Object.assign(winBackAttributes, { endDate: input.endDate });

    if (input.promotionIntent != null)
      Object.assign(winBackAttributes, { promotionIntent: input.promotionIntent });

    function writeWinBackPriceLink(
      _: { readonly territory: string; readonly pricePointId: string },
      index: number,
    ) {
      return {
        type: 'winBackOfferPrices',
        id: inlinePriceId(index),
      } as const;
    }

    function writeWinBackPrice(
      price: { readonly territory: string; readonly pricePointId: string },
      index: number,
    ) {
      return {
        type: 'winBackOfferPrices',
        id: inlinePriceId(index),
        relationships: {
          territory: { data: { type: 'territories', id: price.territory } },
          subscriptionPricePoint: {
            data: { type: 'subscriptionPricePoints', id: price.pricePointId },
          },
        },
      } as const;
    }

    const requestDocument: components['schemas']['WinBackOfferCreateRequest'] = {
      data: {
        type: 'winBackOffers',
        attributes: winBackAttributes,
        relationships: {
          subscription: { data: { type: 'subscriptions', id: input.subscriptionId } },
          prices: {
            data: input.prices.map(writeWinBackPriceLink),
          },
        },
      },
      included: input.prices.map(writeWinBackPrice),
    };

    await this.client.request<unknown>('POST', '/winBackOffers', requestDocument);
  }

  /**
   * Get a list of promoted In-App Purchases, including promoted auto-renewable subscriptions, for
   * an app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-promotedpurchases
   */
  async listPromotedPurchases(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<PromotedPurchaseResource[]> {
    const all: PromotedPurchaseResource[] = [];
    let next: string | undefined = applyAppleListQuery(
      `/apps/${appId}/promotedPurchases`,
      listQuery,
      APPLE_PAGE_LIMIT,
    );

    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page’s `next` link comes from the prior response, so the reads are inherently sequential
      const page: PromotedPurchasePage = await this.client.request<PromotedPurchasePage>(
        'GET',
        next,
      );

      for (const promotedPurchase of page.data) {
        let inAppPurchaseId: string | null = null;
        const returnedInAppPurchaseId = promotedPurchase.relationships?.inAppPurchaseV2?.data?.id;

        if (returnedInAppPurchaseId != null) inAppPurchaseId = returnedInAppPurchaseId;

        let subscriptionId: string | null = null;
        const returnedSubscriptionId = promotedPurchase.relationships?.subscription?.data?.id;

        if (returnedSubscriptionId != null) subscriptionId = returnedSubscriptionId;

        let enabled = promotedPurchase.attributes?.enabled;

        if (enabled == null) enabled = false;

        let visibleForAllUsers = promotedPurchase.attributes?.visibleForAllUsers;

        if (visibleForAllUsers == null) visibleForAllUsers = false;

        all.push({
          id: promotedPurchase.id,
          inAppPurchaseId,
          subscriptionId,
          enabled,
          visibleForAllUsers,
        });
      }

      next = page.links?.next;
    }

    return all;
  }

  /**
   * Add an existing In-App Purchase or auto-renewable subscription to the promoted In-App Purchases
   * on an app listing in the App Store.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-promotedpurchases
   */
  async createPromotedPurchase(input: PromotedPurchaseCreate): Promise<PromotedPurchaseResource> {
    const promotedPurchaseRelationships = {
      app: { data: { type: 'apps' as const, id: input.appId } },
    };

    if (input.inAppPurchaseId != null)
      Object.assign(promotedPurchaseRelationships, {
        inAppPurchaseV2: { data: { type: 'inAppPurchases', id: input.inAppPurchaseId } },
      });

    if (input.subscriptionId != null)
      Object.assign(promotedPurchaseRelationships, {
        subscription: { data: { type: 'subscriptions', id: input.subscriptionId } },
      });

    const requestDocument: components['schemas']['PromotedPurchaseCreateRequest'] = {
      data: {
        type: 'promotedPurchases',
        attributes: { visibleForAllUsers: input.visibleForAllUsers, enabled: input.enabled },
        relationships: promotedPurchaseRelationships,
      },
    };
    const { data: appleResources } = await this.client.request<
      ResourceSingle<{
        enabled?: boolean;
        visibleForAllUsers?: boolean;
      }>
    >('POST', '/promotedPurchases', requestDocument);
    let inAppPurchaseId: string | null = null;

    if (input.inAppPurchaseId != null) inAppPurchaseId = input.inAppPurchaseId;

    let subscriptionId: string | null = null;

    if (input.subscriptionId != null) subscriptionId = input.subscriptionId;

    let enabled = appleResources.attributes.enabled;

    if (enabled == null) enabled = input.enabled;

    let visibleForAllUsers = appleResources.attributes.visibleForAllUsers;

    if (visibleForAllUsers == null) visibleForAllUsers = input.visibleForAllUsers;

    return { id: appleResources.id, inAppPurchaseId, subscriptionId, enabled, visibleForAllUsers };
  }

  /**
   * Update the order of promoted purchases.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-apps-_id_-relationships-promotedpurchases
   */
  async reorderPromotedPurchases(appId: string, orderedIds: readonly string[]): Promise<void> {
    function writePromotedPurchaseLink(id: string) {
      return { type: 'promotedPurchases', id } as const;
    }

    const requestDocument: components['schemas']['AppPromotedPurchasesLinkagesRequest'] = {
      data: orderedIds.map(writePromotedPurchaseLink),
    };

    await this.client.request<unknown>(
      'PATCH',
      `/apps/${appId}/relationships/promotedPurchases`,
      requestDocument,
    );
  }

  /**
   * Get a list of the scheduled prices for an In-App Purchase.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-iappriceschedule
   */
  async inAppPurchaseHasPrice(iapId: string): Promise<boolean> {
    // No schedule yet reads as a 404 on some accounts - {@link getOptional} maps that to "unpriced".
    const schedule = await this.client.getOptional(() =>
      // Same v2 relationship path as the localizations read - the bare /v1 inAppPurchasesV2/{id} form 404s.
      this.client.request<{
        data: {
          id: string;
        } | null;
      }>('GET', this.client.v2(`/inAppPurchases/${iapId}/iapPriceSchedule`)),
    );

    return schedule?.data != null;
  }

  /**
   * Get a list of possible price points for an In-App Purchase.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-pricepoints
   */
  async findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    customerPrice: number,
    listQuery: AppleListQuery | null = null,
  ): Promise<PricePointResource | null> {
    const uRIComponent = encodeURIComponent(territory);
    const points = await this.client.requestAll<{
      customerPrice?: string;
      territory?: string;
    }>(
      this.client.v2(
        applyAppleListQuery(
          `/inAppPurchases/${iapId}/pricePoints?filter[territory]=${uRIComponent}`,
          listQuery,
          APPLE_PAGE_LIMIT,
        ),
      ),
    );

    return matchPricePoint(points, territory, customerPrice);
  }

  /**
   * Create a scheduled price change for an In-App Purchase.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchasepriceschedules
   */
  async createInAppPurchasePriceSchedule(
    iapId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Promise<void> {
    // Apple's JSON:API inline creation requires the temp id wrapped as ${local-id} (a bare string 409s
    // "invalid format"); the same const feeds both the relationship and the included price so they match.
    const priceRef = '${launch-base-price}';

    await this.client.request<unknown>('POST', '/inAppPurchasePriceSchedules', {
      data: {
        type: 'inAppPurchasePriceSchedules',
        relationships: {
          inAppPurchase: { data: { type: 'inAppPurchases', id: iapId } },
          baseTerritory: { data: { type: 'territories', id: baseTerritory } },
          manualPrices: { data: [{ type: 'inAppPurchasePrices', id: priceRef }] },
        },
      },
      included: [
        {
          type: 'inAppPurchasePrices',
          id: priceRef,
          attributes: { startDate: null },
          relationships: {
            inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } },
            inAppPurchasePricePoint: {
              data: { type: 'inAppPurchasePricePoints', id: pricePointId },
            },
          },
        },
      ],
    });
  }

  private async localizationsFrom(path: string): Promise<LocalizationResource[]> {
    const appleResources = await this.client.requestAll<{
      locale?: string;
      name?: string;
      description?: string | null;
    }>(path);

    function readProductLocalization(localization: {
      id: string;
      attributes: { locale?: string; name?: string; description?: string | null };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const locale = localization.attributes.locale;

      if (locale == null) return [];

      const localizationName = localization.attributes.name;

      if (localizationName == null) return [];

      const localizedProduct: LocalizationResource = {
        id: localization.id,
        locale,
        name: localizationName,
      };

      if (typeof localization.attributes.description == 'string')
        Object.assign(localizedProduct, { description: localization.attributes.description });

      return [localizedProduct];
    }

    return appleResources.flatMap(readProductLocalization);
  }

  private async listProductVersions(
    resources: VersionedLocalizationResources,
    parentId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ProductVersion[]> {
    return this.client.requestAll<{ state?: string; version?: number }>(
      applyAppleListQuery(`${resources.versionsUrl(parentId)}`, listQuery, APPLE_PAGE_LIMIT),
    );
  }

  private async localizationsOnVersion(
    resources: VersionedLocalizationResources,
    versionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<LocalizationResource[]> {
    return this.localizationsFrom(
      applyAppleListQuery(
        `/${resources.versionType}/${versionId}/localizations`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );
  }

  private async findOrCreateDraftVersionId(
    resources: VersionedLocalizationResources,
    parentId: string,
  ): Promise<string> {
    const versions = await this.listProductVersions(resources, parentId);
    const draftVersion = pickDraftVersion(versions);

    const hasDraftVersion = draftVersion != null;

    if (hasDraftVersion) return draftVersion.id;

    const createdVersion = await this.client.createResource(`/${resources.versionType}`, {
      type: resources.versionType,
      relationships: {
        [resources.parentRelationship]: { data: { type: resources.parentType, id: parentId } },
      },
    });

    return createdVersion.id;
  }

  private async listShownLocalizations(
    resources: VersionedLocalizationResources,
    parentId: string,
  ): Promise<LocalizationResource[]> {
    const versions = await this.listProductVersions(resources, parentId);
    const draftVersion = pickDraftVersion(versions);
    const newestVersion = pickNewestVersion(versions);
    const versionToRead = draftVersion ?? newestVersion;

    const hasNoVersion = versionToRead == null;

    if (hasNoVersion) return [];

    return this.localizationsOnVersion(resources, versionToRead.id);
  }

  private async postLocalization(
    resources: VersionedLocalizationResources,
    versionId: string,
    copy: LocaleCopy,
  ): Promise<LocalizationResource> {
    const description = copy.description;
    let descriptionField: { description?: string } = {};

    if (description != null) {
      descriptionField = { description };
    }
    const localizationAttributes = { locale: copy.locale, name: copy.name, ...descriptionField };
    const appleResources = await this.client.createResource<{
      locale?: string;
      name?: string;
      description?: string | null;
    }>(this.client.v2(`/${resources.localizationType}`), {
      type: resources.localizationType,
      attributes: localizationAttributes,
      relationships: {
        version: { data: { type: resources.versionType, id: versionId } },
      },
    });

    const savedLocale = appleResources.attributes.locale ?? copy.locale;
    const savedName = appleResources.attributes.name ?? copy.name;
    const localizedProduct: LocalizationResource = {
      id: appleResources.id,
      locale: savedLocale,
      name: savedName,
    };

    const hasSavedDescription = typeof appleResources.attributes.description == 'string';

    if (hasSavedDescription)
      Object.assign(localizedProduct, { description: appleResources.attributes.description });

    return localizedProduct;
  }

  private async createLocalization(
    resources: VersionedLocalizationResources,
    parentId: string,
    copy: LocaleCopy,
  ): Promise<LocalizationResource> {
    const draftVersionId = await this.findOrCreateDraftVersionId(resources, parentId);
    return this.postLocalization(resources, draftVersionId, copy);
  }
}
