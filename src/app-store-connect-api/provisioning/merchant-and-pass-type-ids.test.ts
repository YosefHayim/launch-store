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
describe('MerchantAndPassTypeIds API', () => {
  it('lists merchant ids with their identifier + name', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'm1', attributes: { identifier: 'merchant.com.acme.app', name: 'Acme Pay' } },
            { id: 'm2', attributes: { identifier: 'merchant.com.acme.b2b' } },
          ],
        }),
      ),
    );
    const merchantIds = await client.listMerchantIds();
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/merchantIds?limit=200',
    );
    expect(merchantIds).toEqual([
      { id: 'm1', identifier: 'merchant.com.acme.app', name: 'Acme Pay' },
      { id: 'm2', identifier: 'merchant.com.acme.b2b' },
    ]);
  });
  it('registers a merchant id with name + identifier', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'm-new', attributes: {} } })),
    );
    await client.createMerchantId('merchant.com.acme.app', 'Acme Pay');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('POST');
    expect(url).toContain('/merchantIds');
    const requestDocument = readRequestDocument(init);
    expect(documentValueAt(requestDocument, ['data'])).toEqual({
      type: 'merchantIds',
      attributes: { name: 'Acme Pay', identifier: 'merchant.com.acme.app' },
    });
  });
  it('registers a pass type id with name + identifier', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'p-new', attributes: {} } })),
    );
    await client.createPassTypeId('pass.com.acme.coupon', 'Acme Coupon');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/passTypeIds');
    const requestDocument = readRequestDocument(init);
    expect(documentValueAt(requestDocument, ['data'])).toEqual({
      type: 'passTypeIds',
      attributes: { name: 'Acme Coupon', identifier: 'pass.com.acme.coupon' },
    });
  });
});
