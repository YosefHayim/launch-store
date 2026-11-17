// Docs: https://developer.apple.com/documentation/appstoreconnectapi/apps
import type { ResourceList, AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';

/** One app as listed in the account: its id, display name and bundle identifier. */
interface AppleAppSummary {
  id: string;
  name: string;
  bundleId: string | null;
}

const readNonEmptyAttribute = (attribute: string | undefined): string | null => {
  const isAttributePresent = typeof attribute === 'string' && attribute.length > 0;
  if (isAttributePresent) return attribute;
  return null;
};

const summarizeAppleApp = (appleResource: {
  id: string;
  attributes: { name?: string; bundleId?: string };
}): AppleAppSummary => {
  const name = readNonEmptyAttribute(appleResource.attributes.name);
  const bundleId = readNonEmptyAttribute(appleResource.attributes.bundleId);
  const isNameMissing = name === null;
  if (isNameMissing) return { id: appleResource.id, name: appleResource.id, bundleId };
  return { id: appleResource.id, name, bundleId };
};

export const makeAppsApi = (api: AppStoreConnectRequests) => {
  /** Resolve the internal App Store Connect app id for a bundle identifier, or null if no record exists. */
  const getAppId = async (bundleId: string): Promise<string | null> => {
    const { data: appleResources } = await api.request<
      ResourceList<{
        bundleId: string;
      }>
    >('GET', `/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`);
    const appResource = appleResources[0];
    if (appResource === undefined) return null;
    return appResource.id;
  };

  /**
   * List the names of the apps this key can access - the recognizable signal for telling accounts
   * apart in the picker (an opaque Team ID alone isn't memorable). All pages, names only.
   */
  const listAppNames = async (): Promise<string[]> => {
    const appleResources = await api.requestAll<{
      name?: string;
    }>('/apps?fields[apps]=name&limit=200');
    return appleResources
      .map((entry) => entry.attributes.name)
      .filter((name): name is string => Boolean(name));
  };

  const listApps = async (): Promise<{ id: string; name: string; bundleId: string | null }[]> => {
    const appleResources = await api.requestAll<{
      name?: string;
      bundleId?: string;
    }>('/apps?fields[apps]=name,bundleId&limit=200');
    return appleResources.map(summarizeAppleApp);
  };

  return {
    getAppId,
    listAppNames,
    listApps,
  };
};

export type AppsApi = ReturnType<typeof makeAppsApi>;
