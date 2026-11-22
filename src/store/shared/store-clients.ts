import { loadActiveAscKey } from '../../credentials/accounts.ts';
import { loadServiceAccount } from '../../credentials/android-keystore-assets.ts';
import { AppleStoreClientService } from '../../services/stores/apple-store-client.ts';
import { GoogleStoreClientService } from '../../services/stores/google-store-client.ts';

type AppStoreClient = ReturnType<typeof AppleStoreClientService.createEffectClient>;
type PlayStoreClient = ReturnType<typeof GoogleStoreClientService.createEffectClient>;

/** Build one memoized App Store client resolver. */
export function createAscClientResolver(): () => Promise<AppStoreClient | null> {
  let hasCachedClient = false;
  let cachedClient: AppStoreClient | null = null;

  return async function resolveAscClient(): Promise<AppStoreClient | null> {
    if (hasCachedClient) {
      return cachedClient;
    }

    const ascKey = await loadActiveAscKey();

    if (ascKey == null) {
      cachedClient = null;
      hasCachedClient = true;
      return null;
    }

    cachedClient = AppleStoreClientService.createEffectClient(ascKey);
    hasCachedClient = true;

    return cachedClient;
  };
}

/** Build one memoized Google Play client resolver. */
export function createPlayClientResolver(): (
  packageName?: string,
) => Promise<PlayStoreClient | null> {
  const clients = new Map<string, PlayStoreClient | null>();

  return async function resolvePlayClient(packageName?: string): Promise<PlayStoreClient | null> {
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

    const client = GoogleStoreClientService.createEffectClient(serviceAccountJson);
    clients.set(packageName, client);

    return client;
  };
}
