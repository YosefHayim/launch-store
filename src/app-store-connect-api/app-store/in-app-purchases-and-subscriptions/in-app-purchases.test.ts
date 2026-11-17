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
describe('In-app purchases API', () => {
  it('creates an in-app purchase against the /v2 endpoint with the app relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: {
            id: 'iap1',
            attributes: {
              productId: 'com.x.coins',
              name: 'Coins',
              inAppPurchaseType: 'CONSUMABLE',
            },
          },
        }),
      ),
    );
    const created = await client.createInAppPurchase('app1', {
      productId: 'com.x.coins',
      name: 'Coins',
      inAppPurchaseType: 'CONSUMABLE',
    });
    expect(created).toMatchObject({
      id: 'iap1',
      productId: 'com.x.coins',
      inAppPurchaseType: 'CONSUMABLE',
    });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(String(url)).toBe('https://api.appstoreconnect.apple.com/v2/inAppPurchases');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'inAppPurchases',
        attributes: { productId: 'com.x.coins', name: 'Coins', inAppPurchaseType: 'CONSUMABLE' },
        relationships: { app: { data: { type: 'apps', id: 'app1' } } },
      },
    });
  });
  it('builds an IAP price schedule with a base territory and a temp-id included price', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'sched1', attributes: {} } })),
    );
    await client.createInAppPurchasePriceSchedule('iap1', 'USA', 'pp9');
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'type'])).toBe('inAppPurchasePriceSchedules');
    expect(
      documentValueAt(requestDocument, ['data', 'relationships', 'baseTerritory', 'data']),
    ).toEqual({
      type: 'territories',
      id: 'USA',
    });
    const tempId = documentValueAt(requestDocument, [
      'data',
      'relationships',
      'manualPrices',
      'data',
      0,
      'id',
    ]);
    // Apple's JSON:API inline creation rejects a bare id (409 "invalid format") - it must be ${local-id}-wrapped.
    expect(tempId).toBe('${launch-base-price}');
    expect(documentValueAt(requestDocument, ['included', 0])).toMatchObject({
      type: 'inAppPurchasePrices',
      id: tempId,
      relationships: {
        inAppPurchasePricePoint: { data: { type: 'inAppPurchasePricePoints', id: 'pp9' } },
      },
    });
  });
  it('reports an unpriced in-app purchase when the price-schedule relationship is empty/404', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    expect(await client.inAppPurchaseHasPrice('iap1')).toBe(false);
    // Must hit the /v2/inAppPurchases/{id}/... relationship path - the bare /v1 inAppPurchasesV2/{id} form 404s for real.
    expect(String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0])).toBe(
      'https://api.appstoreconnect.apple.com/v2/inAppPurchases/iap1/iapPriceSchedule',
    );
  });
  it('reads IAP localizations from the draft version, not the deprecated parent collection', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'iapv1', attributes: { state: 'PREPARE_FOR_SUBMISSION', version: 1 } }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              {
                id: 'loc1',
                attributes: { locale: 'en-US', name: 'Lifetime', description: 'Forever access' },
              },
            ],
          }),
        ),
      );
    const locs = await client.listInAppPurchaseLocalizations('iap1');
    expect(locs).toEqual([
      { id: 'loc1', locale: 'en-US', name: 'Lifetime', description: 'Forever access' },
    ]);
    expect(String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0])).toBe(
      'https://api.appstoreconnect.apple.com/v2/inAppPurchases/iap1/versions?limit=200',
    );
    expect(String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0])).toBe(
      'https://api.appstoreconnect.apple.com/v1/inAppPurchaseVersions/iapv1/localizations?limit=200',
    );
  });
  it('lists no IAP localizations and makes no localization read when the product has no version at all', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.listInAppPurchaseLocalizations('iap1')).toEqual([]);
    expect(fetchMock.mock.calls).toHaveLength(1);
  });
  it('lists the newest approved version when the product has no draft, so an approved product is not shown empty', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              { id: 'iapv1', attributes: { state: 'APPROVED', version: 1 } },
              { id: 'iapv2', attributes: { state: 'APPROVED', version: 2 } },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'loc2', attributes: { locale: 'en-US', name: 'Lifetime' } }],
          }),
        ),
      );
    expect(await client.listInAppPurchaseLocalizations('iap1')).toEqual([
      { id: 'loc2', locale: 'en-US', name: 'Lifetime' },
    ]);
    expect(String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0])).toBe(
      'https://api.appstoreconnect.apple.com/v1/inAppPurchaseVersions/iapv2/localizations?limit=200',
    );
  });
});
