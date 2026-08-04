import { Effect } from 'effect';
import { loadActiveAscKey } from '../credentials/accounts.js';
import { loadServiceAccount } from '../credentials/androidKeystore.js';
import {
  AppleStoreClientService,
  type EffectAppStoreConnectClient,
} from '../services/appleStoreClient.js';
import {
  type EffectGooglePlayClient,
  GoogleStoreClientService,
} from '../services/googleStoreClient.js';

/** Build one memoized Effect-native App Store client resolver. */
export const createAscClientResolver = () => {
  let cachedClient: EffectAppStoreConnectClient | null | undefined;
  return () =>
    Effect.gen(function* () {
      if (cachedClient === undefined) {
        const ascKey = yield* loadActiveAscKey();
        if (ascKey === null) {
          cachedClient = null;
        } else {
          const appleStoreClients = yield* AppleStoreClientService;
          cachedClient = yield* appleStoreClients.createEffectClient(ascKey);
        }
      }
      return cachedClient;
    });
};

/** Build one memoized Effect-native Google Play client resolver. */
export const createPlayClientResolver = () => {
  let cachedClient: EffectGooglePlayClient | null | undefined;
  return () =>
    Effect.gen(function* () {
      if (cachedClient === undefined) {
        const serviceAccountJson = yield* loadServiceAccount();
        if (serviceAccountJson === null) {
          cachedClient = null;
        } else {
          const googleStoreClients = yield* GoogleStoreClientService;
          cachedClient = yield* googleStoreClients.createEffectClient(serviceAccountJson);
        }
      }
      return cachedClient;
    });
};
