// Checks App Store Connect agreements and that the Google Play app exists before setup.

import type { AscKey } from '@/types/credentials.js';
import { AppleStoreClientService } from './apple-store-client.ts';
import { GoogleStoreClientService, makeGoogleTransportFailure } from './google-store-client.ts';

export const SetupStoreReadiness = {
  async checkAppleAgreements(ascKey: AscKey): Promise<void> {
    const appStoreClient = AppleStoreClientService.createEffectClient(ascKey);
    await appStoreClient.assertReady();
  },
  async checkAppleApp(ascKey: AscKey, bundleId: string): Promise<boolean> {
    const appStoreClient = AppleStoreClientService.createEffectClient(ascKey);
    const appId = await appStoreClient.getAppId(bundleId);

    return appId != null;
  },
  async checkPlayApp(serviceAccountJson: string, packageName: string): Promise<void> {
    const playStoreClient = GoogleStoreClientService.createEffectClient(serviceAccountJson);

    try {
      await playStoreClient.assertAppExists(packageName);
    } catch (cause) {
      let message = String(cause);

      if (cause instanceof Error) {
        message = cause.message;
      }

      throw makeGoogleTransportFailure({ message, cause });
    }
  },
};
