import type { AppStoreConnect } from '../apple/app-store-connect.ts';

interface SignedAppUpload {
  path: string;
  bundleId: string;
}

export class SubmitToAppStore {
  constructor(private readonly apple: AppStoreConnect) {}

  async upload(signedApp: SignedAppUpload): Promise<string> {
    const appId = await this.apple.findAppId(signedApp.bundleId);

    const isMissing = appId == null;

    if (isMissing) {
      throw new Error(`App Store Connect has no app ${signedApp.bundleId}`);
    }

    // Opening POST /v1/buildUploads without the IPA bytes leaves a stuck upload on the account.
    return signedApp.path;
  }
}
