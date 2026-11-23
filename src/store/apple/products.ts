// Lists in-app purchase product ids already registered on App Store Connect.

import type { AppStoreConnect } from '@/apple/app-store-connect.js';

export class AppleProducts {
  constructor(private readonly apple: AppStoreConnect) {}

  async list(appId: string): Promise<readonly string[]> {
    return this.apple.listInAppPurchases(appId);
  }
}
