import { type Mock, vi } from 'vitest';
import { makePlayConsoleApi } from './play-console-api.js';
import { parseServiceAccount, type GooglePlayTransport } from './api-client.js';

export const makeServiceAccountJson = (): string => {
  return JSON.stringify({
    type: 'service_account',
    client_email: 'launch@proj.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    private_key_id: 'kid-123',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
};
export const insertEdit: Mock = vi.fn();
export const commitEdit: Mock = vi.fn();
export const deleteEdit: Mock = vi.fn();
export const listBundles: Mock = vi.fn();
export const uploadBundle: Mock = vi.fn();
export const getTrack: Mock = vi.fn();
export const listTracks: Mock = vi.fn();
export const updateTrack: Mock = vi.fn();
export const getTesters: Mock = vi.fn();
export const updateTesters: Mock = vi.fn();
export const getCountryAvailability: Mock = vi.fn();
export const listListings: Mock = vi.fn();
export const patchListing: Mock = vi.fn();
export const listInAppProducts: Mock = vi.fn();
export const insertInAppProduct: Mock = vi.fn();
export const updateInAppProduct: Mock = vi.fn();
export const convertRegionPrices: Mock = vi.fn();
export const listSubscriptions: Mock = vi.fn();
export const createSubscription: Mock = vi.fn();
export const patchSubscription: Mock = vi.fn();
export const activateBasePlan: Mock = vi.fn();
export const listOffers: Mock = vi.fn();
export const createOffer: Mock = vi.fn();
export const activateOffer: Mock = vi.fn();
export const listReviews: Mock = vi.fn();
export const getReview: Mock = vi.fn();
export const replyToReview: Mock = vi.fn();
const generatedPublisherFake = (): GooglePlayTransport => {
  return {
    edits: {
      insert: insertEdit,
      commit: commitEdit,
      delete: deleteEdit,
      bundles: { list: listBundles, upload: uploadBundle },
      tracks: {
        get: getTrack,
        list: listTracks,
        update: updateTrack,
      },
      testers: { get: getTesters, update: updateTesters },
      countryavailability: { get: getCountryAvailability },
      listings: { list: listListings, patch: patchListing },
    },
    inappproducts: {
      list: listInAppProducts,
      insert: insertInAppProduct,
      update: updateInAppProduct,
    },
    monetization: {
      convertRegionPrices,
      subscriptions: {
        list: listSubscriptions,
        create: createSubscription,
        patch: patchSubscription,
        basePlans: {
          activate: activateBasePlan,
          offers: {
            list: listOffers,
            create: createOffer,
            activate: activateOffer,
          },
        },
      },
    },
    reviews: {
      list: listReviews,
      get: getReview,
      reply: replyToReview,
    },
  };
};
export const openReadEdit = (): void => {
  insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
  deleteEdit.mockResolvedValue({ data: undefined });
};

export const makeTestApi = () =>
  makePlayConsoleApi(parseServiceAccount(makeServiceAccountJson()), generatedPublisherFake());

export const rejectionOf = async (attempt: Promise<unknown>): Promise<unknown> => {
  try {
    await attempt;
  } catch (failure) {
    return failure;
  }
  throw new Error('Expected the call to reject, but it resolved.');
};
