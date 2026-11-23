// Lists App Store version strings recorded for one app on App Store Connect.

import type { AppStoreConnect } from '../app-store-connect.ts';

export class AppleVersion {
  constructor(private readonly apple: AppStoreConnect) {}

  async list(appId: string): Promise<readonly string[]> {
    return this.apple.listVersions(appId);
  }
}
