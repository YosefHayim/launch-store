import type { AppStoreConnect } from '../../apple/app-store-connect.ts';

export class ApplePrivacy {
  constructor(private readonly apple: AppStoreConnect) {}

  async list(appId: string): Promise<readonly string[]> {
    return this.apple.listAppInfo(appId);
  }
}
