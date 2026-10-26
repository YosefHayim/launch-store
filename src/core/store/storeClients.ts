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
export const createPlayClientResolver = () =>
  Effect.gen(function* () {
    const credentialContext = yield* Effect.context<
      | Effect.Effect.Context<ReturnType<typeof loadServiceAccount>>
      | typeof GoogleStoreClientService.Service
    >();
    const clients = new Map<string, EffectGooglePlayClient | null>();
    return (packageName?: string) =>
      Effect.gen(function* () {
        if (!packageName) return null;
        if (clients.has(packageName)) {
          const cachedClient = clients.get(packageName);
          if (cachedClient !== undefined) return cachedClient;
        }
        const serviceAccountJson = yield* loadServiceAccount(packageName);
        if (serviceAccountJson === null) {
          clients.set(packageName, null);
          return null;
        }
        const googleStoreClients = yield* GoogleStoreClientService;
        const client = yield* googleStoreClients.createEffectClient(serviceAccountJson);
        clients.set(packageName, client);
        return client;
      }).pipe(Effect.provide(credentialContext));
  });
