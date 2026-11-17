// Docs: https://developer.apple.com/documentation/appstoreconnectapi/bundle-ids
import type { components } from '@apple/generated/schema.js';
import type {
  BundleIdCapabilityResource,
  BundleIdResource,
  CapabilitySetting,
  ProfileResource,
} from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests, ResourceList } from '@/app-store-connect-api/api-client.js';
export const makeBundleIdsApi = (api: AppStoreConnectRequests) => {
  /**
   * Find a registered Bundle ID by its identifier, or null if it isn't registered yet. Apple's
   * `filter[identifier]` is a SUBSTRING match, so a query for `com.acme.app` also returns
   * `com.acme.app.widget` - never trust `data[0]`; select the row whose identifier matches exactly
   * (issue #291). The raised limit keeps that exact row from being paginated away behind its
   * multi-target siblings.
   */
  const findBundleId = async (identifier: string): Promise<BundleIdResource | null> => {
    const { data: appleResources } = await api.request<
      ResourceList<{
        identifier: string;
        seedId?: string;
      }>
    >('GET', `/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=200`);
    const exact = appleResources.find((entry) => entry.attributes.identifier === identifier);
    if (!exact) return null;
    return {
      id: exact.id,
      identifier: exact.attributes.identifier,
      seedId: exact.attributes.seedId,
    };
  };
  /**
   * Register a new Bundle ID (App ID) so a build can be signed against it. The bundle-id platform defaults
   * to iOS - the value tvOS/visionOS also register under (their bundle ids are iOS-family); macOS callers
   * pass `MAC_OS` (computed by `toBundleIdPlatform` in `core/platform.ts`).
   */
  const createBundleId = async (
    identifier: string,
    name: string,
    bundleIdPlatform: components['schemas']['BundleIdPlatform'] = 'IOS',
  ): Promise<BundleIdResource> => {
    const appleResources = await api.createResource<{
      identifier: string;
      seedId?: string;
    }>('/bundleIds', {
      type: 'bundleIds',
      attributes: { identifier, name, platform: bundleIdPlatform },
    });
    return {
      id: appleResources.id,
      identifier: appleResources.attributes.identifier,
      seedId: appleResources.attributes.seedId,
    };
  };
  /** List the capabilities currently enabled on a bundle id (App ID), with their toggle settings. */
  const listBundleIdCapabilities = async (
    bundleIdResourceId: string,
  ): Promise<BundleIdCapabilityResource[]> => {
    const appleResources = await api.requestAll<{
      capabilityType?: string;
      settings?: CapabilitySetting[] | null;
    }>(
      // Apple's bundleIdCapabilities related endpoint rejects `limit` (400 "does not support this
      // parameter") unlike most collections; pagination still works through links.next in requestAll.
      `/bundleIds/${bundleIdResourceId}/bundleIdCapabilities?fields[bundleIdCapabilities]=capabilityType,settings`,
    );
    return appleResources.flatMap((capability) => {
      const capabilityType = capability.attributes.capabilityType;
      if (capabilityType === undefined) return [];
      const enabledCapability: BundleIdCapabilityResource = {
        id: capability.id,
        capabilityType,
      };
      if (capability.attributes.settings !== null && capability.attributes.settings !== undefined)
        Object.assign(enabledCapability, { settings: capability.attributes.settings });
      return [enabledCapability];
    });
  };
  /**
   * List the provisioning profiles attached to a bundle id, with their `.mobileprovision` bytes -
   * the read `launch adopt` uses to recover a shipping app's real capability values (app groups,
   * iCloud containers, merchant ids) from a profile's embedded entitlements. Unlike
   * {@link findProfileByName}, this matches on the bundle id rather than Launch's deterministic name,
   * so it finds profiles created in Xcode/the portal by an app onboarded before Launch.
   */
  const listProfilesForBundleId = async (
    bundleIdResourceId: string,
  ): Promise<ProfileResource[]> => {
    const appleResources = await api.requestAll<{
      name?: string;
      uuid?: string;
      profileContent?: string;
    }>(
      `/bundleIds/${bundleIdResourceId}/profiles?limit=200&fields[profiles]=name,uuid,profileContent`,
    );
    return appleResources.flatMap((profile) => {
      const profileName = profile.attributes.name;
      if (profileName === undefined) return [];
      const profileUuid = profile.attributes.uuid;
      if (profileUuid === undefined) return [];
      const profileContent = profile.attributes.profileContent;
      if (profileContent === undefined) return [];
      return [{ id: profile.id, name: profileName, uuid: profileUuid, profileContent }];
    });
  };
  /** Enable a capability on a bundle id. The reconciler only calls this for a capability not already on. */
  const enableCapability = async (
    bundleIdResourceId: string,
    capabilityType: string,
  ): Promise<BundleIdCapabilityResource> => {
    const appleResources = await api.createResource<{
      capabilityType?: string;
    }>('/bundleIdCapabilities', {
      type: 'bundleIdCapabilities',
      attributes: { capabilityType },
      relationships: { bundleId: { data: { type: 'bundleIds', id: bundleIdResourceId } } },
    });
    let enabledCapabilityType = appleResources.attributes.capabilityType;
    if (enabledCapabilityType === undefined) enabledCapabilityType = capabilityType;
    return { id: appleResources.id, capabilityType: enabledCapabilityType };
  };
  /** Disable a capability by its resource id (only reached under `--allow-destructive`). */
  const disableCapability = async (capabilityId: string): Promise<void> => {
    await api.deleteResource(`/bundleIdCapabilities/${capabilityId}`);
  };
  return {
    findBundleId,
    createBundleId,
    listBundleIdCapabilities,
    listProfilesForBundleId,
    enableCapability,
    disableCapability,
  };
};
