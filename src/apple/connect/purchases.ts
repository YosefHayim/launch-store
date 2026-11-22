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
} from '../../types/appleCatalog.ts';
import type {
  VersionedLocalizationResources,
  ProductVersion,
  LocaleCopy,
  ResourceList,
  ResourceSingle,
  PromotedPurchasePage,
} from './shared.ts';
import type { components } from '../../apple-api-types.ts';
import {
  IN_APP_PURCHASE_VERSION_RESOURCES,
  SUBSCRIPTION_VERSION_RESOURCES,
  SUBSCRIPTION_GROUP_VERSION_RESOURCES,
  pickDraftVersion,
  pickNewestVersion,
  inlinePriceId,
  matchPricePoint,
} from './shared.ts';

export class ConnectPurchases {
  constructor(private readonly client: AscHost) {}

  async listInAppPurchases(appId: string): Promise<InAppPurchaseResource[]> {
    const appleResources = await this.client.requestAll<{
      productId?: string;
      name?: string;
      inAppPurchaseType?: string;
      state?: string;
    }>(
      `/apps/${appId}/inAppPurchasesV2?limit=200&fields[inAppPurchases]=productId,name,inAppPurchaseType,state`,
    );
    return appleResources.map((purchase) => {
      let productId = purchase.attributes.productId;
      if (productId === undefined) productId = '';
      let purchaseName = purchase.attributes.name;
      if (purchaseName === undefined) purchaseName = '';
      let purchaseType = purchase.attributes.inAppPurchaseType;
      if (purchaseType === undefined) purchaseType = '';
      const inAppPurchase: InAppPurchaseResource = {
        id: purchase.id,
        productId,
        name: purchaseName,
        inAppPurchaseType: purchaseType,
      };
      if (purchase.attributes.state !== undefined)
        Object.assign(inAppPurchase, { state: purchase.attributes.state });
      return inAppPurchase;
    });
  }

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
    if (productId === undefined) productId = input.productId;
    let purchaseName = appleResources.attributes.name;
    if (purchaseName === undefined) purchaseName = input.name;
    let purchaseType = appleResources.attributes.inAppPurchaseType;
    if (purchaseType === undefined) purchaseType = input.inAppPurchaseType;
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

  async listSubscriptionGroups(appId: string): Promise<SubscriptionGroupResource[]> {
    const appleResources = await this.client.requestAll<{
      referenceName?: string;
    }>(`/apps/${appId}/subscriptionGroups?limit=200&fields[subscriptionGroups]=referenceName`);
    return appleResources.flatMap((group) => {
      const referenceName = group.attributes.referenceName;
      if (referenceName === undefined) return [];
      return [{ id: group.id, referenceName }];
    });
  }

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
    if (createdReferenceName === undefined) createdReferenceName = referenceName;
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

  async listSubscriptions(groupId: string): Promise<SubscriptionResource[]> {
    const appleResources = await this.client.requestAll<{
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
  }

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
    if (productId === undefined) productId = input.productId;
    let subscriptionName = appleResources.attributes.name;
    if (subscriptionName === undefined) subscriptionName = input.name;
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

  async subscriptionHasPrice(subscriptionId: string): Promise<boolean> {
    const { data: appleResources } = await this.client.request<ResourceList<unknown>>(
      'GET',
      `/subscriptions/${subscriptionId}/prices?limit=1`,
    );
    return appleResources.length > 0;
  }

  async findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    const points = await this.client.requestAll<{
      customerPrice?: string;
      territory?: string;
    }>(
      `/subscriptions/${subscriptionId}/pricePoints?filter[territory]=${encodeURIComponent(territory)}&limit=8000`,
    );
    return matchPricePoint(points, territory, customerPrice);
  }

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

  async listSubscriptionOfferCodes(subscriptionId: string): Promise<OfferCodeResource[]> {
    const appleResources = await this.client.requestAll<{
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
  }

  async createSubscriptionOfferCode(input: OfferCodeCreate): Promise<OfferCodeResource> {
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
    const { data: appleResources } = await this.client.request<
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
  }

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

  async createOfferCodeCustomCode(
    offerCodeId: string,
    customCode: string,
    numberOfCodes: number,
    expirationDate?: string,
  ): Promise<void> {
    const customCodeAttributes = { customCode, numberOfCodes };
    if (expirationDate !== undefined) Object.assign(customCodeAttributes, { expirationDate });
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

  async listPromotionalOffers(subscriptionId: string): Promise<PromotionalOfferResource[]> {
    const appleResources = await this.client.requestAll<{
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
  }

  async createPromotionalOffer(input: PromotionalOfferCreate): Promise<PromotionalOfferResource> {
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
    const { data: appleResources } = await this.client.request<
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
  }

  async listIntroductoryOffers(subscriptionId: string): Promise<IntroductoryOfferResource[]> {
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
    }>('GET', `/subscriptions/${subscriptionId}/introductoryOffers?include=territory&limit=200`);
    return appleResources.map((offer) => {
      let territoryId: string | null = null;
      const returnedTerritoryId = offer.relationships?.territory?.data?.id;
      if (returnedTerritoryId !== undefined) territoryId = returnedTerritoryId;
      return { id: offer.id, territory: territoryId };
    });
  }

  async createIntroductoryOffer(input: IntroductoryOfferCreate): Promise<void> {
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
    await this.client.request<unknown>('POST', '/subscriptionIntroductoryOffers', requestDocument);
  }

  async listWinBackOffers(subscriptionId: string): Promise<WinBackOfferResource[]> {
    const appleResources = await this.client.requestAll<{
      offerId?: string;
    }>(`/subscriptions/${subscriptionId}/winBackOffers?limit=200`);
    return appleResources.map((offer) => {
      let offerId = offer.attributes.offerId;
      if (offerId === undefined) offerId = '';
      return { id: offer.id, offerId };
    });
  }

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
    if (input.waitBetweenOffersMonths !== undefined)
      Object.assign(winBackAttributes, {
        customerEligibilityWaitBetweenOffersInMonths: input.waitBetweenOffersMonths,
      });
    if (input.endDate !== undefined) Object.assign(winBackAttributes, { endDate: input.endDate });
    if (input.promotionIntent !== undefined)
      Object.assign(winBackAttributes, { promotionIntent: input.promotionIntent });
    const requestDocument: components['schemas']['WinBackOfferCreateRequest'] = {
      data: {
        type: 'winBackOffers',
        attributes: winBackAttributes,
        relationships: {
          subscription: { data: { type: 'subscriptions', id: input.subscriptionId } },
          prices: {
            data: input.prices.map((_, index) => ({
              type: 'winBackOfferPrices',
              id: inlinePriceId(index),
            })),
          },
        },
      },
      included: input.prices.map((price, index) => ({
        type: 'winBackOfferPrices',
        id: inlinePriceId(index),
        relationships: {
          territory: { data: { type: 'territories', id: price.territory } },
          subscriptionPricePoint: {
            data: { type: 'subscriptionPricePoints', id: price.pricePointId },
          },
        },
      })),
    };
    await this.client.request<unknown>('POST', '/winBackOffers', requestDocument);
  }

  async listPromotedPurchases(appId: string): Promise<PromotedPurchaseResource[]> {
    const all: PromotedPurchaseResource[] = [];
    let next: string | undefined = `/apps/${appId}/promotedPurchases?limit=200`;
    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page’s `next` link comes from the prior response, so the reads are inherently sequential
      const page: PromotedPurchasePage = await this.client.request<PromotedPurchasePage>(
        'GET',
        next,
      );
      for (const promotedPurchase of page.data) {
        let inAppPurchaseId: string | null = null;
        const returnedInAppPurchaseId = promotedPurchase.relationships?.inAppPurchaseV2?.data?.id;
        if (returnedInAppPurchaseId !== undefined) inAppPurchaseId = returnedInAppPurchaseId;
        let subscriptionId: string | null = null;
        const returnedSubscriptionId = promotedPurchase.relationships?.subscription?.data?.id;
        if (returnedSubscriptionId !== undefined) subscriptionId = returnedSubscriptionId;
        let enabled = promotedPurchase.attributes?.enabled;
        if (enabled === undefined) enabled = false;
        let visibleForAllUsers = promotedPurchase.attributes?.visibleForAllUsers;
        if (visibleForAllUsers === undefined) visibleForAllUsers = false;
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

  async createPromotedPurchase(input: PromotedPurchaseCreate): Promise<PromotedPurchaseResource> {
    const promotedPurchaseRelationships = {
      app: { data: { type: 'apps' as const, id: input.appId } },
    };
    if (input.inAppPurchaseId !== undefined)
      Object.assign(promotedPurchaseRelationships, {
        inAppPurchaseV2: { data: { type: 'inAppPurchases', id: input.inAppPurchaseId } },
      });
    if (input.subscriptionId !== undefined)
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
    if (input.inAppPurchaseId !== undefined) inAppPurchaseId = input.inAppPurchaseId;
    let subscriptionId: string | null = null;
    if (input.subscriptionId !== undefined) subscriptionId = input.subscriptionId;
    let enabled = appleResources.attributes.enabled;
    if (enabled === undefined) enabled = input.enabled;
    let visibleForAllUsers = appleResources.attributes.visibleForAllUsers;
    if (visibleForAllUsers === undefined) visibleForAllUsers = input.visibleForAllUsers;
    return { id: appleResources.id, inAppPurchaseId, subscriptionId, enabled, visibleForAllUsers };
  }

  async reorderPromotedPurchases(appId: string, orderedIds: readonly string[]): Promise<void> {
    const requestDocument: components['schemas']['AppPromotedPurchasesLinkagesRequest'] = {
      data: orderedIds.map((id) => ({ type: 'promotedPurchases', id })),
    };
    await this.client.request<unknown>(
      'PATCH',
      `/apps/${appId}/relationships/promotedPurchases`,
      requestDocument,
    );
  }

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

  async findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    const points = await this.client.requestAll<{
      customerPrice?: string;
      territory?: string;
    }>(
      this.client.v2(
        `/inAppPurchases/${iapId}/pricePoints?filter[territory]=${encodeURIComponent(territory)}&limit=8000`,
      ),
    );
    return matchPricePoint(points, territory, customerPrice);
  }

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
    return appleResources.flatMap((localization) => {
      const locale = localization.attributes.locale;
      if (locale === undefined) return [];
      const localizationName = localization.attributes.name;
      if (localizationName === undefined) return [];
      const localizedProduct: LocalizationResource = {
        id: localization.id,
        locale,
        name: localizationName,
      };
      if (typeof localization.attributes.description === 'string')
        Object.assign(localizedProduct, { description: localization.attributes.description });
      return [localizedProduct];
    });
  }

  private async listProductVersions(
    resources: VersionedLocalizationResources,
    parentId: string,
  ): Promise<ProductVersion[]> {
    return this.client.requestAll<{ state?: string; version?: number }>(
      `${resources.versionsUrl(parentId)}?limit=200`,
    );
  }

  private async localizationsOnVersion(
    resources: VersionedLocalizationResources,
    versionId: string,
  ): Promise<LocalizationResource[]> {
    return this.localizationsFrom(`/${resources.versionType}/${versionId}/localizations?limit=200`);
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
    const hasNoDescription = copy.description == null;
    const descriptionField = hasNoDescription ? {} : { description: copy.description };
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

    const hasSavedDescription = typeof appleResources.attributes.description === 'string';
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
