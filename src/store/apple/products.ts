// Lists in-app purchase product ids already registered on App Store Connect.

import type { AppStoreConnect } from '@/apple/app-store-connect.js';
import type { InAppPurchaseResource } from '@/types/apple-catalog.js';

export class AppleProducts {
  constructor(private readonly apple: AppStoreConnect) {}

  async list(appId: string): Promise<readonly string[]> {
    const purchases = await this.apple.listInAppPurchases(appId);

    function productIdFromPurchase(purchase: InAppPurchaseResource): string {
      return purchase.productId;
    }

    return purchases.map(productIdFromPurchase);
  }
}
