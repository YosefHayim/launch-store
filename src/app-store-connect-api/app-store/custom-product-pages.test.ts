import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeResponse, makeKey } from '@/app-store-connect-api/test-helpers.js';
import {
  type AppStoreConnectApi,
  makeAppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
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
describe('AppStoreConnectClient - listing localizations', () => {
  it('omits null promotional text, product description and What to Test copy', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'cpl1', attributes: { locale: 'en-US', promotionalText: null } }],
          }),
        ),
      )
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
            data: [{ id: 'loc1', attributes: { locale: 'en-US', name: 'Pro', description: null } }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'bbl1', attributes: { locale: 'en-US', whatsNew: null } }],
          }),
        ),
      );
    expect(await client.listCustomProductPageLocalizations('cppv1')).toEqual([
      { id: 'cpl1', locale: 'en-US' },
    ]);
    expect(await client.listInAppPurchaseLocalizations('iap1')).toEqual([
      { id: 'loc1', locale: 'en-US', name: 'Pro' },
    ]);
    expect(await client.listBetaBuildLocalizations('b1')).toEqual([
      { id: 'bbl1', locale: 'en-US' },
    ]);
  });
});
