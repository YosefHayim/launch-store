// Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/monetization/convertRegionPrices
import type { androidpublisher_v3 } from '@googleapis/androidpublisher';
import type { MutableDeep } from '@/core/types/mutable.js';
import type {
  ConvertedPrices,
  ConvertedRegionPrice,
  PlayMoneyUnits,
} from '@/core/types/playPricing.js';
import { normalizeMoney, type PlayRequests } from '@/play-console-api/api-client.js';

export const makeConvertRegionPricesApi = (play: PlayRequests) => {
  /**
   * Convert a single base price into Google's recommended local price for every Play market.
   * Advisory and read-only. Regions come back sorted by code; `otherRegions` carries the USD/EUR fallback.
   */
  const convertRegionPrices = async (
    packageName: string,
    price: PlayMoneyUnits,
    productTaxCategoryCode?: string,
  ): Promise<ConvertedPrices> => {
    const priceRequest: androidpublisher_v3.Schema$ConvertRegionPricesRequest = { price };
    if (productTaxCategoryCode !== undefined) {
      priceRequest.productTaxCategoryCode = productTaxCategoryCode;
    }
    const priceConversion = await play.send('convert region prices', () =>
      play.publisher.monetization.convertRegionPrices({
        packageName,
        requestBody: priceRequest,
      }),
    );
    const regions: ConvertedRegionPrice[] = [];
    const regionPrices = priceConversion.convertedRegionPrices;
    if (regionPrices !== null && regionPrices !== undefined) {
      for (const googlePrice of Object.values(regionPrices)) {
        if (typeof googlePrice.regionCode !== 'string') continue;
        regions.push({
          regionCode: googlePrice.regionCode,
          price: normalizeMoney(googlePrice.price),
        });
      }
    }
    regions.sort((leftPrice, rightPrice) =>
      leftPrice.regionCode.localeCompare(rightPrice.regionCode),
    );
    const convertedPrices: MutableDeep<ConvertedPrices> = { regions };
    const fallbackPrice = priceConversion.convertedOtherRegionsPrice;
    if (fallbackPrice !== undefined) {
      convertedPrices.otherRegions = {
        usdPrice: normalizeMoney(fallbackPrice.usdPrice),
        eurPrice: normalizeMoney(fallbackPrice.eurPrice),
      };
    }
    return convertedPrices;
  };

  return { convertRegionPrices };
};
