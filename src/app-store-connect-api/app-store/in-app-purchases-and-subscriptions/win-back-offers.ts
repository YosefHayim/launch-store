import type { components } from '@apple/generated/schema.js';
import type { WinBackOfferCreate, WinBackOfferResource } from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';
import { inlinePriceId } from './subscriptions.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/win-back-offers
export const makeWinBackOffersApi = (api: AppStoreConnectRequests) => {
  /** List a subscription's win-back offers, keyed by the stable `offerId`. */
  const listWinBackOffers = async (subscriptionId: string): Promise<WinBackOfferResource[]> => {
    const appleResources = await api.requestAll<{
      offerId?: string;
    }>(`/subscriptions/${subscriptionId}/winBackOffers?limit=200`);
    return appleResources.map((offer) => {
      let offerId = offer.attributes.offerId;
      if (offerId === undefined) offerId = '';
      return { id: offer.id, offerId };
    });
  };
  /** Create a win-back offer with its lapsed-customer eligibility windows and per-territory prices. */
  const createWinBackOffer = async (input: WinBackOfferCreate): Promise<void> => {
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
    await api.request<unknown>('POST', '/winBackOffers', requestDocument);
  };
  return {
    listWinBackOffers,
    createWinBackOffer,
  };
};
