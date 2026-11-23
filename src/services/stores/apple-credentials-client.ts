import type {
  BundleIdCapabilityResource as AscBundleIdCapabilityResource,
  BundleIdResource as AscBundleIdResource,
  CertificateResource as AscCertificateResource,
  DeviceResource as AscDeviceResource,
} from '@/types/apple-catalog.js';
import type {
  BundleIdCapabilityResource,
  BundleIdResource,
  CertificateResource,
  ProfileResource,
} from '@/types/apple-catalog.js';
import type { AscKey } from '@/types/credentials.js';
import { AppleStoreClientService } from './apple-store-client.ts';

type AppleDeviceResource = Readonly<{
  readonly id: string;
  readonly udid: string;
  readonly name: string;
  readonly status?: string;
}>;

export type AppleCredentialsClient = Readonly<{
  findBundleId: (identifier: string) => Promise<BundleIdResource | null>;
  createBundleId: (
    identifier: string,
    name: string,
    platform: 'IOS' | 'MAC_OS',
  ) => Promise<BundleIdResource>;
  listDistributionCertificates: () => Promise<CertificateResource[]>;
  createCertificate: (csrContent: string) => Promise<CertificateResource>;
  findProfileByName: (name: string) => Promise<ProfileResource | null>;
  createAppStoreProfile: (
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    profileType: 'IOS_APP_STORE' | 'TVOS_APP_STORE' | 'MAC_APP_STORE',
  ) => Promise<ProfileResource>;
  deleteProfile: (profileId: string) => Promise<void>;
  listDevices: () => Promise<AppleDeviceResource[]>;
  createAdHocProfile: (
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    deviceIds: readonly string[],
    profileType: 'IOS_APP_ADHOC' | 'TVOS_APP_ADHOC',
  ) => Promise<ProfileResource>;
  listBundleIdCapabilities: (bundleIdResourceId: string) => Promise<BundleIdCapabilityResource[]>;
}>;

export type AppleCredentialsClientFactory = Readonly<{
  createClient: (ascKey: AscKey) => Promise<AppleCredentialsClient>;
}>;

/** Translate the Apple transport shape without leaking explicit `undefined` fields into the domain. */
function readDomainBundleId(bundleIdentifier: AscBundleIdResource): BundleIdResource {
  if (bundleIdentifier.seedId == null)
    return { id: bundleIdentifier.id, identifier: bundleIdentifier.identifier };

  return {
    id: bundleIdentifier.id,
    identifier: bundleIdentifier.identifier,
    seedId: bundleIdentifier.seedId,
  };
}

/** Preserve a missing bundle identifier while translating a present Apple transport resource. */
function readOptionalDomainBundleId(
  bundleIdentifier: AscBundleIdResource | null,
): BundleIdResource | null {
  if (bundleIdentifier == null) return null;

  return readDomainBundleId(bundleIdentifier);
}

/** Translate an Apple certificate while preserving an absent expiration date as an absent field. */
function readDomainCertificate(certificate: AscCertificateResource): CertificateResource {
  if (certificate.expirationDate == null) {
    return {
      id: certificate.id,
      serialNumber: certificate.serialNumber,
      certificateContent: certificate.certificateContent,
    };
  }

  return {
    id: certificate.id,
    serialNumber: certificate.serialNumber,
    certificateContent: certificate.certificateContent,
    expirationDate: certificate.expirationDate,
  };
}

/** Translate an Apple device while preserving an absent status as an absent field. */
function readDomainDevice(device: AscDeviceResource): AppleDeviceResource {
  if (device.status == null) return { id: device.id, udid: device.udid, name: device.name };

  return { id: device.id, udid: device.udid, name: device.name, status: device.status };
}

/** Translate one enabled capability and its optional setting choices into the domain API. */
function readDomainCapability(
  capability: AscBundleIdCapabilityResource,
): BundleIdCapabilityResource {
  if (capability.settings == null)
    return { id: capability.id, capabilityType: capability.capabilityType };

  function mapSetting(setting: {
    readonly key: string;
    readonly options?: Readonly<{ key: string }>[];
  }) {
    if (setting.options == null) return { key: setting.key };

    return { key: setting.key, options: setting.options };
  }

  return {
    id: capability.id,
    capabilityType: capability.capabilityType,
    settings: capability.settings.map(mapSetting),
  };
}

async function createAppleCredentialsClient(ascKey: AscKey): Promise<AppleCredentialsClient> {
  const appStoreClient = AppleStoreClientService.createEffectClient(ascKey);

  return {
    async findBundleId(identifier) {
      const bundleIdentifier = await appStoreClient.findBundleId(identifier);
      return readOptionalDomainBundleId(bundleIdentifier);
    },
    async createBundleId(identifier, name, platform) {
      const bundleIdentifier = await appStoreClient.createBundleId(identifier, name, platform);
      return readDomainBundleId(bundleIdentifier);
    },
    async listDistributionCertificates() {
      const certificates = await appStoreClient.listDistributionCertificates();
      return certificates.map(readDomainCertificate);
    },
    async createCertificate(csrContent) {
      const certificate = await appStoreClient.createCertificate(csrContent);
      return readDomainCertificate(certificate);
    },
    findProfileByName(name) {
      return appStoreClient.findProfileByName(name);
    },
    createAppStoreProfile(name, bundleIdResourceId, certificateId, profileType) {
      return appStoreClient.createAppStoreProfile(
        name,
        bundleIdResourceId,
        certificateId,
        profileType,
      );
    },
    deleteProfile(profileId) {
      return appStoreClient.deleteProfile(profileId);
    },
    async listDevices() {
      const devices = await appStoreClient.listDevices();
      return devices.map(readDomainDevice);
    },
    createAdHocProfile(name, bundleIdResourceId, certificateId, deviceIds, profileType) {
      return appStoreClient.createAdHocProfile(
        name,
        bundleIdResourceId,
        certificateId,
        deviceIds,
        profileType,
      );
    },
    async listBundleIdCapabilities(bundleIdResourceId) {
      const capabilities = await appStoreClient.listBundleIdCapabilities(bundleIdResourceId);
      return capabilities.map(readDomainCapability);
    },
  };
}

export const AppleCredentialsClientFactory = {
  createClient: createAppleCredentialsClient,
};
