// Checks App Store Connect agreements and that the Google Play app exists before setup.

import type { AscKey } from '@/types/credentials.js';
import { AppleStoreClientService } from './apple-store-client.ts';
import { GoogleStoreClientService, makeGoogleTransportFailure } from './google-store-client.ts';

export class SetupStoreReadiness {
  async checkAppleAgreements(ascKey: AscKey): Promise<void> {
    const appStoreClient = new AppleStoreClientService().createClient(ascKey);
    await appStoreClient.assertReady();
  }

  async checkAppleApp(ascKey: AscKey, bundleId: string): Promise<boolean> {
    const appStoreClient = new AppleStoreClientService().createClient(ascKey);
    const appId = await appStoreClient.getAppId(bundleId);

    return appId != null;
  }

  async checkPlayApp(serviceAccountJson: string, packageName: string): Promise<void> {
    const playStoreClient = new GoogleStoreClientService().createClient(serviceAccountJson);

    try {
      await playStoreClient.assertAppExists(packageName);
    } catch (cause) {
      let message = String(cause);

      if (cause instanceof Error) {
        message = cause.message;
      }

      throw makeGoogleTransportFailure({ message, cause });
    }
  }
}
