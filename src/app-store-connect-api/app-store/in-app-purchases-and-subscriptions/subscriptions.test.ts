import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppStoreConnectApi,
  type AppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
import {
  documentValueAt,
  fakeResponse,
  makeKey,
  readRequestDocument,
} from '@/app-store-connect-api/test-helpers.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
const fetchMock = vi.fn();
let client: AppStoreConnectApi;
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  client = makeAppStoreConnectApi(makeKey());
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('Subscriptions API', () => {
  const OFFER_PRICES = [
    { territory: 'ISR', pricePointId: 'pp-isr' },
    { territory: 'USA', pricePointId: 'pp-usa' },
  ];
  const expectInlinePriceIds = (requestInit: RequestInit) => {
    const requestDocument = readRequestDocument(requestInit);
    for (const [index, localId] of ['${price-0}', '${price-1}'].entries()) {
      expect(
        documentValueAt(requestDocument, ['data', 'relationships', 'prices', 'data', index, 'id']),
      ).toBe(localId);
      expect(documentValueAt(requestDocument, ['included', index, 'id'])).toBe(localId);
    }
  };
  it('creates a subscription with its billing period and group relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'sub1', attributes: { productId: 'com.x.pro', name: 'Pro' } },
        }),
      ),
    );
    await client.createSubscription('group1', {
      productId: 'com.x.pro',
      name: 'Pro Monthly',
      subscriptionPeriod: 'ONE_MONTH',
      groupLevel: 1,
    });
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'type'])).toBe('subscriptions');
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).toMatchObject({
      subscriptionPeriod: 'ONE_MONTH',
      groupLevel: 1,
    });
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'group', 'data'])).toEqual({
      type: 'subscriptionGroups',
      id: 'group1',
    });
  });
  it('writes a subscription localization onto the existing draft version', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'sv1', attributes: { state: 'PREPARE_FOR_SUBMISSION', version: 1 } }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          201,
          JSON.stringify({ data: { id: 'loc1', attributes: { locale: 'en-US', name: 'Pro' } } }),
        ),
      );
    await client.createSubscriptionLocalization('sub1', {
      locale: 'en-US',
      name: 'Pro',
      description: 'All features',
    });
    const [draftLookupUrl] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const [localizationUrl, localizationInit] = expectArrayElement(
      fetchMock.mock.calls,
      1,
      'mock call',
    );
    expect(String(draftLookupUrl)).toBe(
      'https://api.appstoreconnect.apple.com/v1/subscriptions/sub1/versions?limit=200',
    );
    expect(String(localizationUrl)).toBe(
      'https://api.appstoreconnect.apple.com/v2/subscriptionLocalizations',
    );
    expect(fetchMock.mock.calls).toHaveLength(2);
    expect(readRequestDocument(localizationInit)).toMatchObject({
      data: {
        type: 'subscriptionLocalizations',
        attributes: { locale: 'en-US', name: 'Pro', description: 'All features' },
        relationships: { version: { data: { type: 'subscriptionVersions', id: 'sv1' } } },
      },
    });
  });
  it('creates the subscription draft version first when the subscription has none', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })))
      .mockResolvedValueOnce(fakeResponse(201, JSON.stringify({ data: { id: 'sv2' } })))
      .mockResolvedValueOnce(
        fakeResponse(
          201,
          JSON.stringify({ data: { id: 'loc1', attributes: { locale: 'en-US', name: 'Pro' } } }),
        ),
      );
    await client.createSubscriptionLocalization('sub1', {
      locale: 'en-US',
      name: 'Pro',
    });
    const [versionCreateUrl, versionCreateInit] = expectArrayElement(
      fetchMock.mock.calls,
      1,
      'mock call',
    );
    const [, localizationInit] = expectArrayElement(fetchMock.mock.calls, 2, 'mock call');
    expect(String(versionCreateUrl)).toBe(
      'https://api.appstoreconnect.apple.com/v1/subscriptionVersions',
    );
    expect(readRequestDocument(versionCreateInit)).toEqual({
      data: {
        type: 'subscriptionVersions',
        relationships: { subscription: { data: { type: 'subscriptions', id: 'sub1' } } },
      },
    });
    expect(
      documentValueAt(readRequestDocument(localizationInit), ['data', 'relationships']),
    ).toEqual({ version: { data: { type: 'subscriptionVersions', id: 'sv2' } } });
  });
  it('omits description on a group localization (groups carry a name only)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'gv1', attributes: { state: 'PREPARE_FOR_SUBMISSION', version: 1 } }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          201,
          JSON.stringify({
            data: { id: 'gl1', attributes: { locale: 'en-US', name: 'Pro Tiers' } },
          }),
        ),
      );
    await client.createSubscriptionGroupLocalization('group1', {
      locale: 'en-US',
      name: 'Pro Tiers',
    });
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).toEqual({
      locale: 'en-US',
      name: 'Pro Tiers',
    });
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'version', 'data'])).toEqual({
      type: 'subscriptionGroupVersions',
      id: 'gv1',
    });
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).not.toHaveProperty(
      'description',
    );
  });
  it('resolves a subscription price point by exact customer price', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'pp1', attributes: { customerPrice: '4.99', territory: 'USA' } },
            { id: 'pp2', attributes: { customerPrice: '9.99', territory: 'USA' } },
          ],
        }),
      ),
    );
    const point = await client.findSubscriptionPricePoint('sub1', 'USA', 9.99);
    expect(point).toEqual({ id: 'pp2', customerPrice: '9.99', territory: 'USA' });
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/subscriptions/sub1/pricePoints?filter[territory]=USA',
    );
  });
  it('returns null when no price point matches the requested amount', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [{ id: 'pp1', attributes: { customerPrice: '4.99', territory: 'USA' } }],
        }),
      ),
    );
    expect(await client.findSubscriptionPricePoint('sub1', 'USA', 9.99)).toBeNull();
  });
  it('sets a subscription price by linking the resolved price point', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'spr1', attributes: {} } })),
    );
    await client.createSubscriptionPrice('sub1', 'pp2');
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'type'])).toBe('subscriptionPrices');
    expect(documentValueAt(requestDocument, ['data', 'relationships'])).toMatchObject({
      subscription: { data: { type: 'subscriptions', id: 'sub1' } },
      subscriptionPricePoint: { data: { type: 'subscriptionPricePoints', id: 'pp2' } },
    });
  });
  it('reads a subscription fixture from its draft version into the rows the sync diff compares', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'sv1', attributes: { state: 'PREPARE_FOR_SUBMISSION', version: 1 } }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              {
                id: 'sl1',
                attributes: { locale: 'en-US', name: 'Pro', description: 'All features' },
              },
              { id: 'sl2', attributes: { locale: 'he', name: 'מקצועי', description: null } },
            ],
          }),
        ),
      );
    expect(await client.listSubscriptionLocalizations('sub1')).toEqual([
      { id: 'sl1', locale: 'en-US', name: 'Pro', description: 'All features' },
      { id: 'sl2', locale: 'he', name: 'מקצועי' },
    ]);
    expect(String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0])).toBe(
      'https://api.appstoreconnect.apple.com/v1/subscriptionVersions/sv1/localizations?limit=200',
    );
  });
  it('creates an offer-code campaign with ${local-id} inline price ids', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'offer-1', attributes: {} } })),
    );
    await client.createSubscriptionOfferCode({
      subscriptionId: 'sub-1',
      name: 'retention-half-price',
      customerEligibilities: ['EXISTING'],
      offerEligibility: 'REPLACE_INTRO_OFFERS',
      duration: 'ONE_MONTH',
      offerMode: 'PAY_AS_YOU_GO',
      numberOfPeriods: 3,
      prices: OFFER_PRICES,
    });
    expectInlinePriceIds(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1]);
  });
  it('creates a promotional offer with ${local-id} inline price ids', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'promo-1', attributes: {} } })),
    );
    await client.createPromotionalOffer({
      subscriptionId: 'sub-1',
      name: 'Come back',
      offerCode: 'come_back',
      duration: 'ONE_MONTH',
      offerMode: 'PAY_AS_YOU_GO',
      numberOfPeriods: 1,
      prices: OFFER_PRICES,
    });
    expectInlinePriceIds(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1]);
  });
});
