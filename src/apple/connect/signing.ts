import type { AscHost } from './host.js';
import type {
  BundleIdCapabilityResource,
  BundleIdResource,
  CapabilitySetting,
  CertificateResource,
  DeviceResource,
  ProfileResource,
} from '@/types/appleCatalog.js';
import type { ProvisioningProfileType, ResourceList } from './shared.js';
import type { components } from '@/generated/apple/schema.js';
import {
  DISTRIBUTION_CERT_TYPE,
  APP_STORE_PROFILE_TYPE,
  AD_HOC_PROFILE_TYPE,
  IOS_DEVICE_PLATFORM,
} from './shared.js';

export class ConnectSigning {
  constructor(private readonly client: AscHost) {}

  async findBundleId(identifier: string): Promise<BundleIdResource | null> {
    const { data: appleResources } = await this.client.request<
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
  }

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

  async listDistributionCertificates(): Promise<CertificateResource[]> {
    const appleResources = await this.client.requestAll<{
      serialNumber: string;
      certificateContent: string;
      expirationDate?: string;
    }>(`/certificates?filter[certificateType]=${DISTRIBUTION_CERT_TYPE}&limit=200`);
    return appleResources.map((entry) => ({
      id: entry.id,
      serialNumber: entry.attributes.serialNumber,
      certificateContent: entry.attributes.certificateContent,
      expirationDate: entry.attributes.expirationDate,
    }));
  }

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

  async findProfileByName(name: string): Promise<ProfileResource | null> {
    const { data: appleResources } = await this.client.request<
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
  }

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

  async deleteProfile(id: string): Promise<void> {
    await this.client.deleteResource(`/profiles/${id}`);
  }

  async listDevices(): Promise<DeviceResource[]> {
    const appleResources = await this.client.requestAll<{
      udid: string;
      name: string;
      status?: string;
    }>('/devices?limit=200');
    return appleResources.map((entry) => ({
      id: entry.id,
      udid: entry.attributes.udid,
      name: entry.attributes.name,
      status: entry.attributes.status,
    }));
  }

  async findDeviceByUdid(udid: string): Promise<DeviceResource | null> {
    const wanted = udid.toLowerCase();
    const matchingDevice = (await this.listDevices()).find(
      (device) => device.udid.toLowerCase() === wanted,
    );
    if (matchingDevice === undefined) return null;
    return matchingDevice;
  }

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

  async createAdHocProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    deviceIds: readonly string[],
    profileType: ProvisioningProfileType = AD_HOC_PROFILE_TYPE,
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
        devices: { data: deviceIds.map((id) => ({ type: 'devices', id })) },
      },
    });
    return {
      id: appleResources.id,
      name: appleResources.attributes.name,
      uuid: appleResources.attributes.uuid,
      profileContent: appleResources.attributes.profileContent,
    };
  }

  async listBundleIdCapabilities(
    bundleIdResourceId: string,
  ): Promise<BundleIdCapabilityResource[]> {
    const appleResources = await this.client.requestAll<{
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
  }

  async listProfilesForBundleId(bundleIdResourceId: string): Promise<ProfileResource[]> {
    const appleResources = await this.client.requestAll<{
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
  }

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
    if (enabledCapabilityType === undefined) enabledCapabilityType = capabilityType;
    return { id: appleResources.id, capabilityType: enabledCapabilityType };
  }

  async disableCapability(capabilityId: string): Promise<void> {
    await this.client.deleteResource(`/bundleIdCapabilities/${capabilityId}`);
  }
}
