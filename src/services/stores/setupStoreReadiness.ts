import type { AscKey } from '../../types/credentials.ts';
import { AppleStoreClientService } from './appleStoreClient.ts';
import { GoogleStoreClientService, makeGoogleTransportFailure } from './googleStoreClient.ts';

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
