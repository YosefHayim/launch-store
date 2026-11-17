import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertRegionPrices, makeTestApi } from '@/play-console-api/test-helpers.js';
let client: ReturnType<typeof makeTestApi>;
beforeEach(() => {
  vi.clearAllMocks();
  client = makeTestApi();
});
describe('convert region prices', () => {
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
    const convertedPrices = await client.convertRegionPrices('com.example.app', {
      currencyCode: 'USD',
      units: '4',
      nanos: 990000000,
    });
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
    const convertedPrices = await client.convertRegionPrices('com.example.app', {
      currencyCode: 'USD',
      units: '1',
      nanos: 0,
    });
    expect(convertedPrices.regions).toEqual([
      { regionCode: 'GB', price: { currencyCode: 'GBP', units: '0', nanos: 0 } },
    ]);
    expect(convertedPrices.otherRegions).toBeUndefined();
  });
  it('passes the optional product tax category to the generated request', async () => {
    convertRegionPrices.mockResolvedValue({ data: { convertedRegionPrices: {} } });
    await client.convertRegionPrices(
      'com.example.app',
      { currencyCode: 'USD', units: '4', nanos: 0 },
      'TAX_CATEGORY',
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
