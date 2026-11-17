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
describe('Win-back offers API', () => {
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
  it('creates a win-back offer with ${local-id} inline price ids', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'win-back-1', attributes: {} } })),
    );
    await client.createWinBackOffer({
      subscriptionId: 'sub-1',
      offerId: 'win_back',
      referenceName: 'Win back',
      duration: 'ONE_MONTH',
      offerMode: 'PAY_AS_YOU_GO',
      numberOfPeriods: 1,
      eligiblePaidMonths: 2,
      monthsSinceLastSubscribed: { min: 1, max: 6 },
      startDate: '2026-11-01',
      priority: 'NORMAL',
      prices: OFFER_PRICES,
    });
    expectInlinePriceIds(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1]);
  });
});
