// Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts
import type { androidpublisher_v3 } from '@googleapis/androidpublisher';
import type { InAppProductResource, PlayMoney } from '@/core/types/googlePlay.js';
import type { MutableDeep } from '@/core/types/mutable.js';
import { collectGeneratedPages, type PlayRequests } from './api-client.js';

const readProductMoney = (
  googlePrice: androidpublisher_v3.Schema$Price | undefined,
): PlayMoney | undefined => {
  if (googlePrice === undefined) return;
  const price: MutableDeep<PlayMoney> = {};
  if (typeof googlePrice.priceMicros === 'string') price.priceMicros = googlePrice.priceMicros;
  if (typeof googlePrice.currency === 'string') price.currency = googlePrice.currency;
  return price;
};

const readInAppProduct = (
  googleProduct: androidpublisher_v3.Schema$InAppProduct,
): InAppProductResource | undefined => {
  if (typeof googleProduct.sku !== 'string') return;
  const product: MutableDeep<InAppProductResource> = { sku: googleProduct.sku };
  if (typeof googleProduct.status === 'string') product.status = googleProduct.status;
  if (typeof googleProduct.purchaseType === 'string') {
    product.purchaseType = googleProduct.purchaseType;
  }
  if (typeof googleProduct.defaultLanguage === 'string') {
    product.defaultLanguage = googleProduct.defaultLanguage;
  }
  const defaultPrice = readProductMoney(googleProduct.defaultPrice);
  if (defaultPrice !== undefined) product.defaultPrice = defaultPrice;
  if (googleProduct.prices !== null && googleProduct.prices !== undefined) {
    const prices: Record<string, PlayMoney> = {};
    for (const [regionCode, googlePrice] of Object.entries(googleProduct.prices)) {
      const price = readProductMoney(googlePrice);
      if (price !== undefined) prices[regionCode] = price;
    }
    product.prices = prices;
  }
  if (googleProduct.listings !== null && googleProduct.listings !== undefined) {
    const listings: Record<
      string,
      {
        title?: string;
        description?: string;
      }
    > = {};
    for (const [locale, googleListing] of Object.entries(googleProduct.listings)) {
      const listing: {
        title?: string;
        description?: string;
      } = {};
      if (typeof googleListing.title === 'string') listing.title = googleListing.title;
      if (typeof googleListing.description === 'string') {
        listing.description = googleListing.description;
      }
      listings[locale] = listing;
    }
    product.listings = listings;
  }
  return product;
};

export const makeInAppProductsApi = (play: PlayRequests) => {
  /** List the app's in-app managed products, paging through Google's token pagination in full. */
  const listInAppProducts = (packageName: string): Promise<InAppProductResource[]> =>
    collectGeneratedPages(
      (pageToken) => {
        const listParameters: androidpublisher_v3.Params$Resource$Inappproducts$List = {
          packageName,
        };
        if (pageToken !== undefined) listParameters.token = pageToken;
        return play.send('list in-app products', () =>
          play.publisher.inappproducts.list(listParameters),
        );
      },
      (productPage) => {
        const products: InAppProductResource[] = [];
        if (!Array.isArray(productPage.inappproduct)) return products;
        for (const googleProduct of productPage.inappproduct) {
          const product = readInAppProduct(googleProduct);
          if (product !== undefined) products.push(product);
        }
        return products;
      },
      (productPage) => productPage.tokenPagination?.nextPageToken,
    );

  /** Create a new in-app managed product (POST). The product carries its `sku`. */
  const insertInAppProduct = async (
    packageName: string,
    product: InAppProductResource,
  ): Promise<void> => {
    await play.send('insert in-app product', () =>
      play.publisher.inappproducts.insert({
        packageName,
        requestBody: { ...product, packageName },
      }),
    );
  };

  /** Update an existing in-app managed product by SKU (PUT). */
  const updateInAppProduct = async (
    packageName: string,
    product: InAppProductResource,
  ): Promise<void> => {
    await play.send('update in-app product', () =>
      play.publisher.inappproducts.update({
        packageName,
        sku: product.sku,
        requestBody: { ...product, packageName },
      }),
    );
  };

  return { listInAppProducts, insertInAppProduct, updateInAppProduct };
};
