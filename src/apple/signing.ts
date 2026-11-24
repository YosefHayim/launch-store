// Creates the code signing assets an app needs on App Store Connect.

import type { AscHost } from './host.ts';
import type {
  BundleIdCapabilityResource,
  BundleIdResource,
  CapabilitySetting,
  CertificateResource,
  DeviceResource,
  ProfileResource,
} from '../types/apple-catalog.ts';
import type { ProvisioningProfileType, ResourceList } from './shared.ts';
import type { components } from '../types/apple-api-types.ts';
import {
  DISTRIBUTION_CERT_TYPE,
  APP_STORE_PROFILE_TYPE,
  AD_HOC_PROFILE_TYPE,
  IOS_DEVICE_PLATFORM,
} from './shared.ts';
import {
  APPLE_PAGE_LIMIT,
  applyAppleListQuery,
  applyAppleReadQuery,
  type AppleListQuery,
} from './list-query.ts';

export class ConnectSigning {
  constructor(private readonly client: AscHost) {}

  /**
   * Find and list bundle IDs that are registered to your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids
   */
  async findBundleId(
    identifier: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BundleIdResource | null> {
    const uRIComponent = encodeURIComponent(identifier);
    const { data: appleResources } = await this.client.request<
      ResourceList<{
        identifier: string;
        seedId?: string;
      }>
    >(
      'GET',
      applyAppleListQuery(
        `/bundleIds?filter[identifier]=${uRIComponent}`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    function hasSameIdentifier(entry: {
      id: string;
      attributes: { identifier: string; seedId?: string };
    }) {
      return entry.attributes.identifier == identifier;
    }

    const exact = appleResources.find(hasSameIdentifier);

    if (!exact) return null;

    return {
      id: exact.id,
      identifier: exact.attributes.identifier,
      seedId: exact.attributes.seedId,
    };
  }

  /**
   * Register a new bundle ID for app development.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-bundleids
   */
  async createBundleId(
    identifier: string,
    name: string,
    bundleIdPlatform: components['schemas']['BundleIdPlatform'] = 'IOS',
  ): Promise<BundleIdResource> {
    const appleResources = await this.client.createResource<{
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
  }

  /**
   * Find and list certificates and download their data.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-certificates
   */
  async listDistributionCertificates(
    listQuery: AppleListQuery | null = null,
  ): Promise<CertificateResource[]> {
    const appleResources = await this.client.requestAll<{
      serialNumber: string;
      certificateContent: string;
      expirationDate?: string;
    }>(
      applyAppleListQuery(
        `/certificates?filter[certificateType]=${DISTRIBUTION_CERT_TYPE}`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    function copyDistributionCertificate(entry: {
      id: string;
      attributes: { serialNumber: string; certificateContent: string; expirationDate?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      return {
        id: entry.id,
        serialNumber: entry.attributes.serialNumber,
        certificateContent: entry.attributes.certificateContent,
        expirationDate: entry.attributes.expirationDate,
      };
    }

    return appleResources.map(copyDistributionCertificate);
  }

  /**
   * Create a new certificate using a certificate signing request.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-certificates
   */
  async createCertificate(csrContent: string): Promise<CertificateResource> {
    const appleResources = await this.client.createResource<{
      serialNumber: string;
      certificateContent: string;
      expirationDate?: string;
    }>('/certificates', {
      type: 'certificates',
      attributes: { csrContent, certificateType: DISTRIBUTION_CERT_TYPE },
    });

    return {
      id: appleResources.id,
      serialNumber: appleResources.attributes.serialNumber,
      certificateContent: appleResources.attributes.certificateContent,
      expirationDate: appleResources.attributes.expirationDate,
    };
  }

  /**
   * Find and list provisioning profiles and download their data.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-profiles
   */
  async findProfileByName(name: string): Promise<ProfileResource | null> {
    const uRIComponent = encodeURIComponent(name);
    const { data: appleResources } = await this.client.request<
      ResourceList<{
        name: string;
        uuid: string;
        profileContent: string;
      }>
    >('GET', `/profiles?filter[name]=${uRIComponent}&limit=1`);

    const first = appleResources[0];

    if (!first) return null;

    return {
      id: first.id,
      name: first.attributes.name,
      uuid: first.attributes.uuid,
      profileContent: first.attributes.profileContent,
    };
  }

  /**
   * Create a new provisioning profile.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-profiles
   */
  async createAppStoreProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    profileType: ProvisioningProfileType = APP_STORE_PROFILE_TYPE,
  ): Promise<ProfileResource> {
    const appleResources = await this.client.createResource<{
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
  }

  /**
   * Delete a provisioning profile that is used for app development or distribution.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-profiles-_id_
   */
  async deleteProfile(id: string): Promise<void> {
    await this.client.deleteResource(`/profiles/${id}`);
  }

  /**
   * Find and list devices registered to your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-devices
   */
  async listDevices(listQuery: AppleListQuery | null = null): Promise<DeviceResource[]> {
    const appleResources = await this.client.requestAll<{
      udid: string;
      name: string;
      status?: string;
    }>(applyAppleListQuery('/devices', listQuery, APPLE_PAGE_LIMIT));

    function copyDevice(entry: {
      id: string;
      attributes: { udid: string; name: string; status?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      return {
        id: entry.id,
        udid: entry.attributes.udid,
        name: entry.attributes.name,
        status: entry.attributes.status,
      };
    }

    return appleResources.map(copyDevice);
  }

  async findDeviceByUdid(udid: string): Promise<DeviceResource | null> {
    const wanted = udid.toLowerCase();

    function hasSameUdid(device: {
      readonly id: string;
      readonly udid: string;
      readonly name: string;
      readonly status?: string | undefined | undefined;
    }) {
      return device.udid.toLowerCase() == wanted;
    }

    const matchingDevice = (await this.listDevices()).find(hasSameUdid);

    if (matchingDevice == null) return null;

    return matchingDevice;
  }

  /**
   * Register a new device for app development.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-devices
   */
  async registerDevice(udid: string, name: string): Promise<DeviceResource> {
    const appleResources = await this.client.createResource<{
      udid: string;
      name: string;
      status?: string;
    }>('/devices', {
      type: 'devices',
      attributes: { udid, name, platform: IOS_DEVICE_PLATFORM },
    });

    return {
      id: appleResources.id,
      udid: appleResources.attributes.udid,
      name: appleResources.attributes.name,
      status: appleResources.attributes.status,
    };
  }

  /**
   * Create a new provisioning profile.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-profiles
   */
  async createAdHocProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    deviceIds: readonly string[],
    profileType: ProvisioningProfileType = AD_HOC_PROFILE_TYPE,
  ): Promise<ProfileResource> {
    function writeDeviceLink(id: string) {
      return { type: 'devices', id };
    }

    const appleResources = await this.client.createResource<{
      name: string;
      uuid: string;
      profileContent: string;
    }>('/profiles', {
      type: 'profiles',
      attributes: { name, profileType },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundleIdResourceId } },
        certificates: { data: [{ type: 'certificates', id: certificateId }] },
        devices: { data: deviceIds.map(writeDeviceLink) },
      },
    });

    return {
      id: appleResources.id,
      name: appleResources.attributes.name,
      uuid: appleResources.attributes.uuid,
      profileContent: appleResources.attributes.profileContent,
    };
  }

  /**
   * Get a list of all capabilities for a specific bundle ID.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids-_id_-bundleidcapabilities
   */
  async listBundleIdCapabilities(
    bundleIdResourceId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BundleIdCapabilityResource[]> {
    const appleResources = await this.client.requestAll<{
      capabilityType?: string;
      settings?: CapabilitySetting[] | null;
    }>(
      // Apple's bundleIdCapabilities related endpoint rejects `limit` (400 "does not support this
      // parameter") unlike most collections; pagination still works through links.next in requestAll.
      applyAppleReadQuery(`/bundleIds/${bundleIdResourceId}/bundleIdCapabilities`, listQuery, {
        'fields[bundleIdCapabilities]': 'capabilityType,settings',
      }),
    );

    function readBundleCapability(capability: {
      id: string;
      attributes: { capabilityType?: string; settings?: CapabilitySetting[] | null };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const capabilityType = capability.attributes.capabilityType;

      if (capabilityType == null) return [];

      const enabledCapability: BundleIdCapabilityResource = {
        id: capability.id,
        capabilityType,
      };

      if (capability.attributes.settings != null && capability.attributes.settings != null)
        Object.assign(enabledCapability, { settings: capability.attributes.settings });

      return [enabledCapability];
    }

    return appleResources.flatMap(readBundleCapability);
  }

  /**
   * Get a list of all profiles for a specific bundle ID.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids-_id_-profiles
   */
  async listProfilesForBundleId(
    bundleIdResourceId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ProfileResource[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
      uuid?: string;
      profileContent?: string;
    }>(
      applyAppleListQuery(
        `/bundleIds/${bundleIdResourceId}/profiles`,
        listQuery,
        APPLE_PAGE_LIMIT,
        { 'fields[profiles]': 'name,uuid,profileContent' },
      ),
    );

    function readProvisioningProfile(profile: {
      id: string;
      attributes: { name?: string; uuid?: string; profileContent?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const profileName = profile.attributes.name;

      if (profileName == null) return [];

      const profileUuid = profile.attributes.uuid;

      if (profileUuid == null) return [];

      const profileContent = profile.attributes.profileContent;

      if (profileContent == null) return [];

      return [{ id: profile.id, name: profileName, uuid: profileUuid, profileContent }];
    }

    return appleResources.flatMap(readProvisioningProfile);
  }

  /**
   * Enable a capability for a bundle ID.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-bundleidcapabilities
   */
  async enableCapability(
    bundleIdResourceId: string,
    capabilityType: string,
  ): Promise<BundleIdCapabilityResource> {
    const appleResources = await this.client.createResource<{
      capabilityType?: string;
    }>('/bundleIdCapabilities', {
      type: 'bundleIdCapabilities',
      attributes: { capabilityType },
      relationships: { bundleId: { data: { type: 'bundleIds', id: bundleIdResourceId } } },
    });
    let enabledCapabilityType = appleResources.attributes.capabilityType;

    if (enabledCapabilityType == null) enabledCapabilityType = capabilityType;

    return { id: appleResources.id, capabilityType: enabledCapabilityType };
  }

  /**
   * Disable a capability for a bundle ID.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-bundleidcapabilities-_id_
   */
  async disableCapability(capabilityId: string): Promise<void> {
    await this.client.deleteResource(`/bundleIdCapabilities/${capabilityId}`);
  }
}
