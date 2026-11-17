// Docs: https://developer.apple.com/documentation/appstoreconnectapi/profiles
import type { components } from '@apple/generated/schema.js';
import type { ProfileResource } from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests, ResourceList } from '@/app-store-connect-api/api-client.js';
/**
 * Provisioning profile type for App Store / TestFlight distribution - the **iOS default**. tvOS, macOS,
 * and visionOS resolve their own profile type via `appStoreProfileType()` in `core/platform.ts` and pass
 * it to createAppStoreProfile; this constant is the default that keeps the
 * iOS path unchanged.
 */
const APP_STORE_PROFILE_TYPE = 'IOS_APP_STORE';
/** Provisioning profile type for ad-hoc (install-link) distribution - the iOS default; tvOS/visionOS map their own via `core/platform.ts` (macOS has no ad-hoc type). */
const AD_HOC_PROFILE_TYPE = 'IOS_APP_ADHOC';
/** The App Store Connect signing-profile type written when creating a profile (e.g. `IOS_APP_STORE`, `TVOS_APP_STORE`, `MAC_APP_STORE`). */
type ProvisioningProfileType = NonNullable<
  NonNullable<components['schemas']['Profile']['attributes']>['profileType']
>;
export const makeProfilesApi = (api: AppStoreConnectRequests) => {
  /** Find a provisioning profile by exact name (Launch names its profiles deterministically). */
  const findProfileByName = async (name: string): Promise<ProfileResource | null> => {
    const { data: appleResources } = await api.request<
      ResourceList<{
        name: string;
        uuid: string;
        profileContent: string;
      }>
    >('GET', `/profiles?filter[name]=${encodeURIComponent(name)}&limit=1`);
    const first = appleResources[0];
    if (!first) return null;
    return {
      id: first.id,
      name: first.attributes.name,
      uuid: first.attributes.uuid,
      profileContent: first.attributes.profileContent,
    };
  };
  /**
   * Create an App Store provisioning profile linking a bundle id to a distribution certificate. `profileType`
   * defaults to the iOS App Store profile; tvOS/macOS callers pass their own (`appStoreProfileType` in
   * `core/platform.ts`), so the type matches the platform the build targets.
   */
  const createAppStoreProfile = async (
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    profileType: ProvisioningProfileType = APP_STORE_PROFILE_TYPE,
  ): Promise<ProfileResource> => {
    const appleResources = await api.createResource<{
      name: string;
      uuid: string;
      profileContent: string;
    }>('/profiles', {
      type: 'profiles',
      attributes: { name, profileType },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundleIdResourceId } },
        certificates: { data: [{ type: 'certificates', id: certificateId }] },
      },
    });
    return {
      id: appleResources.id,
      name: appleResources.attributes.name,
      uuid: appleResources.attributes.uuid,
      profileContent: appleResources.attributes.profileContent,
    };
  };
  /** Delete a provisioning profile (used when recreating one after issuing a new certificate). */
  const deleteProfile = async (id: string): Promise<void> => {
    await api.deleteResource(`/profiles/${id}`);
  };
  /**
   * Create an ad-hoc provisioning profile that ties a bundle id + distribution certificate to an
   * explicit device set - the install-link analog of {@link createAppStoreProfile}. The profile is
   * only valid for the `deviceIds` listed, so it must be recreated whenever the device set changes.
   */
  const createAdHocProfile = async (
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    deviceIds: readonly string[],
    profileType: ProvisioningProfileType = AD_HOC_PROFILE_TYPE,
  ): Promise<ProfileResource> => {
    const appleResources = await api.createResource<{
      name: string;
      uuid: string;
      profileContent: string;
    }>('/profiles', {
      type: 'profiles',
      attributes: { name, profileType },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundleIdResourceId } },
        certificates: { data: [{ type: 'certificates', id: certificateId }] },
        devices: { data: deviceIds.map((id) => ({ type: 'devices', id })) },
      },
    });
    return {
      id: appleResources.id,
      name: appleResources.attributes.name,
      uuid: appleResources.attributes.uuid,
      profileContent: appleResources.attributes.profileContent,
    };
  };
  return {
    findProfileByName,
    createAppStoreProfile,
    deleteProfile,
    createAdHocProfile,
  };
};
