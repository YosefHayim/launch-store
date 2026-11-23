// Lists the App Store Connect app info records that hold privacy details.

import type { AppStoreConnect } from './app-store-connect.ts';

export class ApplePrivacy {
  constructor(private readonly apple: AppStoreConnect) {}

  async list(appId: string): Promise<readonly string[]> {
    return this.apple.listAppInfo(appId);
  }
}
