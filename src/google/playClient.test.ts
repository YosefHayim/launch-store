import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describePlayErrors,
  GooglePlayClient,
  nonEmptyPageToken,
  parseServiceAccount,
  serviceAccountJwtOptions,
  type GooglePlayTransport,
} from './playClient.js';
/** Minimal valid service-account JSON for adapter construction. */
const makeServiceAccountJson = (): string => {
  return JSON.stringify({
    type: 'service_account',
    client_email: 'launch@proj.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    private_key_id: 'kid-123',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
};
const insertEdit = vi.fn();
const commitEdit = vi.fn();
const deleteEdit = vi.fn();
const listBundles = vi.fn();
const getTrack = vi.fn();
const listTracks = vi.fn();
const updateTrack = vi.fn();
const getTesters = vi.fn();
const updateTesters = vi.fn();
const getCountryAvailability = vi.fn();
const listInAppProducts = vi.fn();
const insertInAppProduct = vi.fn();
const updateInAppProduct = vi.fn();
const convertRegionPrices = vi.fn();
const listSubscriptions = vi.fn();
const createSubscription = vi.fn();
const patchSubscription = vi.fn();
const activateBasePlan = vi.fn();
const listOffers = vi.fn();
const createOffer = vi.fn();
const activateOffer = vi.fn();
const listReviews = vi.fn();
const getReview = vi.fn();
const replyToReview = vi.fn();
/** Build the generated-client slice exercised by this adapter test. */
const generatedPublisherFake = (): GooglePlayTransport => {
  return {
    edits: {
      insert: insertEdit,
      commit: commitEdit,
      delete: deleteEdit,
      bundles: { list: listBundles },
      tracks: {
        get: getTrack,
        list: listTracks,
        update: updateTrack,
      },
      testers: { get: getTesters, update: updateTesters },
      countryavailability: { get: getCountryAvailability },
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
const openReadEdit = (): void => {
  insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
  deleteEdit.mockResolvedValue({ data: undefined });
};
let client: GooglePlayClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new GooglePlayClient(
    Effect.runSync(parseServiceAccount(makeServiceAccountJson())),
    generatedPublisherFake(),
  );
});
describe('parseServiceAccount', () => {
  it('extracts the fields Launch needs from a valid key', () => {
    const account = Effect.runSync(parseServiceAccount(makeServiceAccountJson()));
    expect(account.clientEmail).toBe('launch@proj.iam.gserviceaccount.com');
    expect(account.privateKey).toContain('PRIVATE KEY');
    expect(account.tokenUri).toBe('https://oauth2.googleapis.com/token');
    expect(account.privateKeyId).toBe('kid-123');
    expect(client.serviceAccountEmail).toBe('launch@proj.iam.gserviceaccount.com');
  });
  it('defaults the token endpoint when absent', () => {
    const account = Effect.runSync(
      parseServiceAccount(
        JSON.stringify({
          client_email: 'a@b.iam',
          private_key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
        }),
      ),
    );
    expect(account.tokenUri).toBe('https://oauth2.googleapis.com/token');
  });
  it('rejects non-JSON and the wrong key kind with actionable text', async () => {
    await expect(Effect.runPromise(parseServiceAccount('not json'))).rejects.toMatchObject({
      message: expect.stringMatching(/not valid JSON/),
    });
    await expect(
      Effect.runPromise(parseServiceAccount(JSON.stringify({ type: 'authorized_user' }))),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/client_email.*private_key/),
    });
  });
});
describe('serviceAccountJwtOptions / nonEmptyPageToken', () => {
  it('copies the key id when present and drops empty page tokens', () => {
    const account = Effect.runSync(parseServiceAccount(makeServiceAccountJson()));
    expect(serviceAccountJwtOptions(account, ['scope-a'])).toEqual({
      email: 'launch@proj.iam.gserviceaccount.com',
      key: account.privateKey,
      keyId: 'kid-123',
      scopes: ['scope-a'],
    });
    expect(nonEmptyPageToken(undefined)).toBeUndefined();
    expect(nonEmptyPageToken('')).toBeUndefined();
    expect(nonEmptyPageToken('next')).toBe('next');
  });
});
describe('describePlayErrors', () => {
  it("extracts Google's error message", () => {
    expect(
      describePlayErrors(JSON.stringify({ error: { message: 'The app was not found.' } })),
    ).toBe('The app was not found.');
  });
  it('flags a sensitive-permission rejection with the fix', () => {
    const errorText = JSON.stringify({
      error: { message: 'Your app uses a sensitive permission.' },
    });
    expect(describePlayErrors(errorText)).toMatch(/Permissions Declaration/);
    const genericPermissionErrorText = JSON.stringify({
      error: { message: 'The caller does not have permission' },
    });
    expect(describePlayErrors(genericPermissionErrorText)).toBe(
      'The caller does not have permission',
    );
  });
  it('falls back across string error, description, raw text, then empty placeholder', () => {
    expect(describePlayErrors(JSON.stringify({ error: 'quota exceeded' }))).toBe('quota exceeded');
    expect(describePlayErrors(JSON.stringify({ error_description: 'invalid_grant' }))).toBe(
      'invalid_grant',
    );
    expect(describePlayErrors('plain failure')).toBe('plain failure');
    expect(describePlayErrors('')).toBe('no response body');
  });
});
describe('GooglePlayClient generated reads', () => {
  it('returns the highest uploaded version code and abandons the read edit', async () => {
    openReadEdit();
    listBundles.mockResolvedValue({
      data: { bundles: [{ versionCode: 3 }, { versionCode: 7 }] },
    });
    expect(await Effect.runPromise(client.getLatestVersionCode('com.example.hello'))).toBe(7);
    expect(insertEdit).toHaveBeenCalledWith({ packageName: 'com.example.hello' });
    expect(listBundles).toHaveBeenCalledWith({
      packageName: 'com.example.hello',
      editId: 'edit1',
    });
    expect(deleteEdit).toHaveBeenCalledWith({
      packageName: 'com.example.hello',
      editId: 'edit1',
    });
  });
  it('reports zero when no bundles have been uploaded', async () => {
    openReadEdit();
    listBundles.mockResolvedValue({ data: {} });
    expect(await Effect.runPromise(client.getLatestVersionCode('com.example.fresh'))).toBe(0);
  });
  it('raises PlayAppNotFoundError when edit creation reports a missing app', async () => {
    insertEdit.mockRejectedValue(
      Object.assign(new Error('Application not found.'), { status: 404 }),
    );
    const appLookupFailure = await Effect.runPromise(
      Effect.flip(client.assertAppExists('com.example.missing')),
    );
    expect(appLookupFailure).toMatchObject({ _tag: 'PlayAppNotFoundError' });
  });
  it('normalizes track releases and tester groups inside a throwaway edit', async () => {
    openReadEdit();
    getTrack.mockResolvedValue({
      data: {
        releases: [
          {
            name: '1.2.0',
            versionCodes: ['12'],
            status: 'inProgress',
            userFraction: 0.1,
            releaseNotes: [{ language: 'en-US', text: 'fixes' }],
          },
        ],
      },
    });
    getTesters.mockResolvedValue({ data: { googleGroups: ['qa@example.com'] } });
    getCountryAvailability.mockResolvedValue({
      data: {
        countries: [{ countryCode: 'US' }, { countryCode: 1 }],
        restOfWorld: true,
      },
    });
    expect(await Effect.runPromise(client.getTrackReleases('com.example.app', 'beta'))).toEqual([
      {
        name: '1.2.0',
        versionCodes: ['12'],
        status: 'inProgress',
        userFraction: 0.1,
        releaseNotes: [{ language: 'en-US', text: 'fixes' }],
      },
    ]);
    expect(await Effect.runPromise(client.getTesters('com.example.app', 'beta'))).toEqual([
      'qa@example.com',
    ]);
    expect(
      await Effect.runPromise(client.getCountryAvailability('com.example.app', 'production')),
    ).toEqual({
      countries: [{ countryCode: 'US' }],
      restOfWorld: true,
    });
  });
  it('lists every track with normalized releases', async () => {
    openReadEdit();
    listTracks.mockResolvedValue({
      data: {
        tracks: [
          { track: 'internal', releases: [{ name: '1.0.0', status: 'completed' }] },
          { track: 12 },
          { track: 'production', releases: null },
        ],
      },
    });
    expect(await Effect.runPromise(client.listTracks('com.example.app'))).toEqual([
      {
        track: 'internal',
        releases: [{ name: '1.0.0', status: 'completed' }],
      },
      { track: 'production', releases: [] },
    ]);
  });
});
describe('GooglePlayClient.withEdit', () => {
  it('opens an edit, applies the write, then commits', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    commitEdit.mockResolvedValue({ data: {} });
    const appliedEditId = await Effect.runPromise(
      client.withEdit('com.example.app', (editId) => Effect.succeed(editId)),
    );
    expect(appliedEditId).toBe('edit1');
    expect(commitEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
    expect(deleteEdit).not.toHaveBeenCalled();
  });
  it('abandons the edit when the write fails', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    deleteEdit.mockResolvedValue({ data: undefined });
    await expect(
      Effect.runPromise(client.withEdit('com.example.app', () => Effect.fail(new Error('boom')))),
    ).rejects.toThrow('boom');
    expect(commitEdit).not.toHaveBeenCalled();
    expect(deleteEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
  });
  it('commits setTrackReleases and setTesters inside one edit each', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    commitEdit.mockResolvedValue({ data: {} });
    updateTrack.mockResolvedValue({ data: {} });
    updateTesters.mockResolvedValue({ data: {} });
    await Effect.runPromise(
      client.setTrackReleases('com.example.app', 'production', [
        { name: '2.0.0', versionCodes: ['20'], status: 'completed' },
      ]),
    );
    await Effect.runPromise(client.setTesters('com.example.app', 'internal', ['group@x.com']));
    expect(updateTrack).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      editId: 'edit1',
      track: 'production',
      requestBody: {
        track: 'production',
        releases: [{ name: '2.0.0', versionCodes: ['20'], status: 'completed' }],
      },
    });
    expect(updateTesters).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      editId: 'edit1',
      track: 'internal',
      requestBody: { googleGroups: ['group@x.com'] },
    });
    expect(commitEdit).toHaveBeenCalledTimes(2);
  });
});
describe('GooglePlayClient.convertRegionPrices', () => {
  it('normalizes generated prices into sorted regions and fallback money', async () => {
    convertRegionPrices.mockResolvedValue({
      data: {
        convertedRegionPrices: {
          US: {
            regionCode: 'US',
            price: { currencyCode: 'USD', units: '4', nanos: 990000000 },
          },
          DE: {
            regionCode: 'DE',
            price: { currencyCode: 'EUR', units: '4', nanos: 490000000 },
          },
          JP: { regionCode: 'JP', price: { currencyCode: 'JPY', units: '600', nanos: 0 } },
        },
        convertedOtherRegionsPrice: {
          usdPrice: { currencyCode: 'USD', units: '4', nanos: 990000000 },
          eurPrice: { currencyCode: 'EUR', units: '4', nanos: 490000000 },
        },
      },
    });
    const convertedPrices = await Effect.runPromise(
      client.convertRegionPrices('com.example.app', {
        currencyCode: 'USD',
        units: '4',
        nanos: 990000000,
      }),
    );
    expect(convertRegionPrices).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      requestBody: {
        price: { currencyCode: 'USD', units: '4', nanos: 990000000 },
      },
    });
    expect(convertedPrices.regions.map((regionPrice) => regionPrice.regionCode)).toEqual([
      'DE',
      'JP',
      'US',
    ]);
    expect(convertedPrices.regions[2]).toEqual({
      regionCode: 'US',
      price: { currencyCode: 'USD', units: '4', nanos: 990000000 },
    });
    expect(convertedPrices.otherRegions?.usdPrice.units).toBe('4');
    expect(convertedPrices.otherRegions?.eurPrice.currencyCode).toBe('EUR');
  });
  it('drops missing region codes, fills missing money fields, and omits absent fallback', async () => {
    convertRegionPrices.mockResolvedValue({
      data: {
        convertedRegionPrices: {
          GB: { regionCode: 'GB', price: { currencyCode: 'GBP' } },
          missing: { price: { currencyCode: 'USD', units: '1', nanos: 0 } },
        },
      },
    });
    const convertedPrices = await Effect.runPromise(
      client.convertRegionPrices('com.example.app', {
        currencyCode: 'USD',
        units: '1',
        nanos: 0,
      }),
    );
    expect(convertedPrices.regions).toEqual([
      { regionCode: 'GB', price: { currencyCode: 'GBP', units: '0', nanos: 0 } },
    ]);
    expect(convertedPrices.otherRegions).toBeUndefined();
  });
  it('passes the optional product tax category to the generated request', async () => {
    convertRegionPrices.mockResolvedValue({ data: { convertedRegionPrices: {} } });
    await Effect.runPromise(
      client.convertRegionPrices(
        'com.example.app',
        { currencyCode: 'USD', units: '4', nanos: 0 },
        'TAX_CATEGORY',
      ),
    );
    expect(convertRegionPrices).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      requestBody: {
        price: { currencyCode: 'USD', units: '4', nanos: 0 },
        productTaxCategoryCode: 'TAX_CATEGORY',
      },
    });
  });
});
describe('GooglePlayClient catalog + reviews', () => {
  it('pages in-app products and normalizes money/listings', async () => {
    listInAppProducts
      .mockResolvedValueOnce({
        data: {
          inappproduct: [
            {
              sku: 'coins',
              status: 'active',
              purchaseType: 'managedUser',
              defaultLanguage: 'en-US',
              defaultPrice: { priceMicros: '1990000', currency: 'USD' },
              prices: { US: { priceMicros: '1990000', currency: 'USD' } },
              listings: {
                'en-US': { title: 'Coins', description: 'Pack' },
              },
            },
            { status: 'active' },
          ],
          tokenPagination: { nextPageToken: 'page-2' },
        },
      })
      .mockResolvedValueOnce({
        data: {
          inappproduct: [{ sku: 'gems', status: 'active' }],
        },
      });
    expect(await Effect.runPromise(client.listInAppProducts('com.example.app'))).toEqual([
      {
        sku: 'coins',
        status: 'active',
        purchaseType: 'managedUser',
        defaultLanguage: 'en-US',
        defaultPrice: { priceMicros: '1990000', currency: 'USD' },
        prices: { US: { priceMicros: '1990000', currency: 'USD' } },
        listings: { 'en-US': { title: 'Coins', description: 'Pack' } },
      },
      { sku: 'gems', status: 'active' },
    ]);
    expect(listInAppProducts).toHaveBeenCalledTimes(2);
    expect(listInAppProducts.mock.calls[1]?.[0].token).toBe('page-2');
  });
  it('writes in-app products and subscriptions through the generated client', async () => {
    insertInAppProduct.mockResolvedValue({ data: {} });
    updateInAppProduct.mockResolvedValue({ data: {} });
    createSubscription.mockResolvedValue({ data: {} });
    patchSubscription.mockResolvedValue({ data: {} });
    activateBasePlan.mockResolvedValue({ data: {} });
    createOffer.mockResolvedValue({ data: {} });
    activateOffer.mockResolvedValue({ data: {} });
    await Effect.runPromise(
      client.insertInAppProduct('com.example.app', { sku: 'coins', status: 'active' }),
    );
    await Effect.runPromise(
      client.updateInAppProduct('com.example.app', { sku: 'coins', status: 'active' }),
    );
    await Effect.runPromise(
      client.createSubscription('com.example.app', {
        productId: 'pro',
        listings: [{ languageCode: 'en-US', title: 'Pro', description: 'All features' }],
      }),
    );
    await Effect.runPromise(
      client.patchSubscription(
        'com.example.app',
        {
          productId: 'pro',
          listings: [{ languageCode: 'en-US', title: 'Pro', description: 'All' }],
        },
        'listings',
      ),
    );
    await Effect.runPromise(client.activateBasePlan('com.example.app', 'pro', 'p1m'));
    await Effect.runPromise(
      client.createSubscriptionOffer('com.example.app', {
        offerId: 'trial',
        productId: 'pro',
        basePlanId: 'p1m',
        phases: [],
        regionalConfigs: [],
      }),
    );
    await Effect.runPromise(
      client.activateSubscriptionOffer('com.example.app', 'pro', 'p1m', 'trial'),
    );
    expect(insertInAppProduct).toHaveBeenCalled();
    expect(updateInAppProduct.mock.calls[0]?.[0].sku).toBe('coins');
    expect(createSubscription.mock.calls[0]?.[0].productId).toBe('pro');
    expect(patchSubscription.mock.calls[0]?.[0].updateMask).toBe('listings');
    expect(activateBasePlan).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      productId: 'pro',
      basePlanId: 'p1m',
      requestBody: { packageName: 'com.example.app', productId: 'pro', basePlanId: 'p1m' },
    });
    expect(createOffer.mock.calls[0]?.[0].offerId).toBe('trial');
    expect(activateOffer.mock.calls[0]?.[0].offerId).toBe('trial');
  });
  it('pages subscriptions and offers, dropping incomplete generated documents', async () => {
    listSubscriptions
      .mockResolvedValueOnce({
        data: {
          subscriptions: [
            {
              productId: 'pro',
              packageName: 'com.example.app',
              basePlans: [
                {
                  basePlanId: 'p1m',
                  state: 'ACTIVE',
                  autoRenewingBasePlanType: { billingPeriodDuration: 'P1M' },
                  regionalConfigs: [
                    {
                      regionCode: 'US',
                      newSubscriberAvailability: true,
                      price: { currencyCode: 'USD', units: '9', nanos: 990000000 },
                    },
                  ],
                  offerTags: [{ tag: 'default' }, {}],
                },
              ],
              listings: [
                {
                  languageCode: 'en-US',
                  title: 'Pro',
                  description: 'All features',
                  benefits: ['No ads'],
                },
              ],
            },
            { packageName: 'com.example.app' },
          ],
          nextPageToken: 'subs-2',
        },
      })
      .mockResolvedValueOnce({ data: { subscriptions: [] } });
    listOffers.mockResolvedValue({
      data: {
        subscriptionOffers: [
          {
            offerId: 'trial',
            productId: 'pro',
            basePlanId: 'p1m',
            state: 'ACTIVE',
            regionalConfigs: [{ regionCode: 'US', newSubscriberAvailability: true }],
            phases: [
              {
                recurrenceCount: 1,
                duration: 'P1W',
                regionalConfigs: [{ regionCode: 'US', free: {} }],
              },
            ],
            offerTags: [{ tag: 'welcome' }],
          },
          { productId: 'pro' },
        ],
      },
    });
    expect(await Effect.runPromise(client.listSubscriptions('com.example.app'))).toEqual([
      {
        productId: 'pro',
        packageName: 'com.example.app',
        basePlans: [
          {
            basePlanId: 'p1m',
            state: 'ACTIVE',
            autoRenewingBasePlanType: { billingPeriodDuration: 'P1M' },
            regionalConfigs: [
              {
                regionCode: 'US',
                newSubscriberAvailability: true,
                price: { currencyCode: 'USD', units: '9', nanos: 990000000 },
              },
            ],
            offerTags: [{ tag: 'default' }],
          },
        ],
        listings: [
          {
            languageCode: 'en-US',
            title: 'Pro',
            description: 'All features',
            benefits: ['No ads'],
          },
        ],
      },
    ]);
    expect(listSubscriptions.mock.calls[1]?.[0].pageToken).toBe('subs-2');
    expect(
      await Effect.runPromise(client.listSubscriptionOffers('com.example.app', 'pro', 'p1m')),
    ).toEqual([
      {
        offerId: 'trial',
        productId: 'pro',
        basePlanId: 'p1m',
        state: 'ACTIVE',
        regionalConfigs: [{ regionCode: 'US', newSubscriberAvailability: true }],
        phases: [
          {
            recurrenceCount: 1,
            duration: 'P1W',
            regionalConfigs: [{ regionCode: 'US', free: {} }],
          },
        ],
        offerTags: [{ tag: 'welcome' }],
      },
    ]);
  });
  it('lists, gets, and replies to reviews with flattened fields', async () => {
    listReviews.mockResolvedValue({
      data: {
        reviews: [
          {
            reviewId: 'r1',
            authorName: 'Alex',
            comments: [
              {
                userComment: {
                  text: 'Great app',
                  starRating: 5,
                  reviewerLanguage: 'en',
                  device: 'Pixel',
                  appVersionName: '1.2.0',
                  lastModified: { seconds: '1710000000' },
                },
              },
              { developerComment: { text: 'Thanks!' } },
            ],
          },
          { authorName: 'no-id' },
        ],
      },
    });
    getReview
      .mockResolvedValueOnce({
        data: {
          reviewId: 'r1',
          comments: [{ userComment: { text: 'Great app', starRating: 5 } }],
        },
      })
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { status: 404 }));
    replyToReview.mockResolvedValue({
      data: {
        result: {
          replyText: 'Thanks for the review!',
          lastEdited: { seconds: '1710000100' },
        },
      },
    });
    const reviews = await Effect.runPromise(
      client.listReviews('com.example.app', { translationLanguage: 'en' }),
    );
    expect(reviews).toEqual([
      {
        reviewId: 'r1',
        authorName: 'Alex',
        rating: 5,
        text: 'Great app',
        reviewerLanguage: 'en',
        device: 'Pixel',
        appVersionName: '1.2.0',
        lastModified: new Date(1710000000 * 1000).toISOString(),
        answered: true,
        developerReply: 'Thanks!',
      },
    ]);
    expect(listReviews.mock.calls[0]?.[0].translationLanguage).toBe('en');
    expect(await Effect.runPromise(client.getReview('com.example.app', 'r1'))).toMatchObject({
      reviewId: 'r1',
      rating: 5,
      answered: false,
    });
    expect(await Effect.runPromise(client.getReview('com.example.app', 'missing'))).toBeNull();
    expect(
      await Effect.runPromise(client.replyToReview('com.example.app', 'r1', 'Thanks!')),
    ).toEqual({
      replyText: 'Thanks for the review!',
      lastEdited: new Date(1710000100 * 1000).toISOString(),
    });
  });
  it('tags generated failures with status and operation text', async () => {
    listInAppProducts.mockRejectedValue(
      Object.assign(new Error(JSON.stringify({ error: { message: 'rate limited' } })), {
        status: 429,
      }),
    );
    const listFailure = await Effect.runPromise(
      Effect.flip(client.listInAppProducts('com.example.app')),
    );
    expect(listFailure).toMatchObject({
      _tag: 'GooglePlayApiError',
      operation: 'list in-app products',
      statusCode: 429,
      message: expect.stringMatching(/rate limited/),
    });
  });
});
