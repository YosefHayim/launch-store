import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  insertInAppProduct,
  listInAppProducts,
  makeTestApi,
  updateInAppProduct,
} from './test-helpers.js';
let client: ReturnType<typeof makeTestApi>;
beforeEach(() => {
  vi.clearAllMocks();
  client = makeTestApi();
});
describe('in-app products', () => {
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
    expect(await client.listInAppProducts('com.example.app')).toEqual([
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
  it('writes in-app products through the generated client', async () => {
    insertInAppProduct.mockResolvedValue({ data: {} });
    updateInAppProduct.mockResolvedValue({ data: {} });

    await client.insertInAppProduct('com.example.app', { sku: 'coins', status: 'active' });
    await client.updateInAppProduct('com.example.app', { sku: 'coins', status: 'active' });

    expect(insertInAppProduct).toHaveBeenCalled();
    expect(updateInAppProduct.mock.calls[0]?.[0].sku).toBe('coins');
  });
});
