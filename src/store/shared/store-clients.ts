// Creates reusable App Store Connect and Google Play clients for store commands.

import { loadActiveAscKey } from '../../credentials/accounts.ts';
import { loadServiceAccount } from '../../credentials/android-keystore-assets.ts';
import { AppleStoreClientService } from '../../services/stores/apple-store-client.ts';
import { GoogleStoreClientService } from '../../services/stores/google-store-client.ts';

type AppStoreClient = ReturnType<AppleStoreClientService['createClient']>;

type PlayStoreClient = ReturnType<GoogleStoreClientService['createClient']>;

/** Build one memoized App Store client reader. */
export function createAscClientReader(): () => Promise<AppStoreClient | null> {
  let hasCachedClient = false;
  let cachedClient: AppStoreClient | null = null;

  return async function readAscClient(): Promise<AppStoreClient | null> {
    if (hasCachedClient) {
      return cachedClient;
    }

    const ascKey = await loadActiveAscKey();

    if (ascKey == null) {
      cachedClient = null;
      hasCachedClient = true;
      return null;
    }

    cachedClient = new AppleStoreClientService().createClient(ascKey);
    hasCachedClient = true;

    return cachedClient;
  };
}

/** Build one memoized Google Play client reader. */
export function createPlayClientReader(): (
  packageName?: string,
) => Promise<PlayStoreClient | null> {
  const clients = new Map<string, PlayStoreClient | null>();

  return async function readPlayClient(packageName?: string): Promise<PlayStoreClient | null> {
    if (packageName == null) {
      return null;
    }

    const isBlankName = packageName == '';

    if (isBlankName) {
      return null;
    }

    if (clients.has(packageName)) {
      const cachedClient = clients.get(packageName) ?? null;

      return cachedClient;
    }

    const serviceAccountJson = await loadServiceAccount(packageName);

    if (serviceAccountJson == null) {
      clients.set(packageName, null);
      return null;
    }

    const client = new GoogleStoreClientService().createClient(serviceAccountJson);

    clients.set(packageName, client);

    return client;
  };
}
