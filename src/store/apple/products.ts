import type { AppStoreConnect } from '@/apple/app-store-connect.js';

export class AppleProducts {
  constructor(private readonly apple: AppStoreConnect) {}

  async list(appId: string): Promise<readonly string[]> {
    return this.apple.listInAppPurchases(appId);
  }
}
