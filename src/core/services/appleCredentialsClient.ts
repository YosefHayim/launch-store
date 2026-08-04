import { Context, Effect, Layer } from 'effect';
import type {
  BundleIdCapabilityResource as AscBundleIdCapabilityResource,
  BundleIdResource as AscBundleIdResource,
  CertificateResource as AscCertificateResource,
  DeviceResource as AscDeviceResource,
} from '../types/appleCatalog.js';
import type {
  BundleIdCapabilityResource,
  BundleIdResource,
  CertificateResource,
  ProfileResource,
} from '../types/appleCatalog.js';
import type { AscKey } from '../types/credentials.js';
import {
  type AppleStoreClientService as AppleStoreClientRequirements,
  AppleStoreClientService,
} from './appleStoreClient.js';

export type AppleDeviceResource = Readonly<{
  readonly id: string;
  readonly udid: string;
  readonly name: string;
  readonly status?: string;
}>;

export type AppleCredentialsClient = Readonly<{
  readonly findBundleId: (identifier: string) => Effect.Effect<BundleIdResource | null, unknown>;
  readonly createBundleId: (
    identifier: string,
    name: string,
    platform: 'IOS' | 'MAC_OS',
  ) => Effect.Effect<BundleIdResource, unknown>;
  readonly listDistributionCertificates: () => Effect.Effect<CertificateResource[], unknown>;
  readonly createCertificate: (csrContent: string) => Effect.Effect<CertificateResource, unknown>;
  readonly findProfileByName: (name: string) => Effect.Effect<ProfileResource | null, unknown>;
  readonly createAppStoreProfile: (
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    profileType: 'IOS_APP_STORE' | 'TVOS_APP_STORE' | 'MAC_APP_STORE',
  ) => Effect.Effect<ProfileResource, unknown>;
  readonly deleteProfile: (profileId: string) => Effect.Effect<void, unknown>;
  readonly listDevices: () => Effect.Effect<AppleDeviceResource[], unknown>;
  readonly createAdHocProfile: (
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    deviceIds: string[],
    profileType: 'IOS_APP_ADHOC' | 'TVOS_APP_ADHOC',
  ) => Effect.Effect<ProfileResource, unknown>;
  readonly listBundleIdCapabilities: (
    bundleIdResourceId: string,
  ) => Effect.Effect<BundleIdCapabilityResource[], unknown>;
}>;

export type AppleCredentialsClientFactory = Readonly<{
  readonly createClient: (ascKey: AscKey) => Effect.Effect<AppleCredentialsClient, unknown>;
}>;

export const AppleCredentialsClientFactory = Context.GenericTag<AppleCredentialsClientFactory>(
  'launch-store/AppleCredentialsClientFactory',
);

/** Translate the Apple transport shape without leaking explicit `undefined` fields into the domain. */
const toDomainBundleId = (bundleIdentifier: AscBundleIdResource): BundleIdResource => {
  if (bundleIdentifier.seedId === undefined)
    return { id: bundleIdentifier.id, identifier: bundleIdentifier.identifier };
  return {
    id: bundleIdentifier.id,
    identifier: bundleIdentifier.identifier,
    seedId: bundleIdentifier.seedId,
  };
};

/** Preserve a missing bundle identifier while translating a present Apple transport resource. */
const toOptionalDomainBundleId = (
  bundleIdentifier: AscBundleIdResource | null,
): BundleIdResource | null => {
  if (bundleIdentifier === null) return null;
  return toDomainBundleId(bundleIdentifier);
};

/** Translate an Apple certificate while preserving an absent expiration date as an absent field. */
const toDomainCertificate = (certificate: AscCertificateResource): CertificateResource => {
  if (certificate.expirationDate === undefined) {
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
};

/** Translate an Apple device while preserving an absent status as an absent field. */
const toDomainDevice = (device: AscDeviceResource): AppleDeviceResource => {
  if (device.status === undefined) return { id: device.id, udid: device.udid, name: device.name };
  return { id: device.id, udid: device.udid, name: device.name, status: device.status };
};

/** Translate one enabled capability and its optional setting choices into the domain API. */
const toDomainCapability = (
  capability: AscBundleIdCapabilityResource,
): BundleIdCapabilityResource => {
  if (capability.settings === undefined)
    return { id: capability.id, capabilityType: capability.capabilityType };
  return {
    id: capability.id,
    capabilityType: capability.capabilityType,
    settings: capability.settings.map((setting) => {
      if (setting.options === undefined) return { key: setting.key };
      return { key: setting.key, options: setting.options };
    }),
  };
};

export const AppleCredentialsClientLive: Layer.Layer<
  AppleCredentialsClientFactory,
  never,
  AppleStoreClientRequirements
> = Layer.effect(
  AppleCredentialsClientFactory,
  Effect.gen(function* () {
    const appleStoreClients = yield* AppleStoreClientService;
    return {
      createClient: (ascKey) =>
        Effect.gen(function* () {
          const appStoreClient = yield* appleStoreClients.createEffectClient(ascKey);
          return {
            findBundleId: (identifier) =>
              appStoreClient.findBundleId(identifier).pipe(Effect.map(toOptionalDomainBundleId)),
            createBundleId: (identifier, name, platform) =>
              appStoreClient
                .createBundleId(identifier, name, platform)
                .pipe(Effect.map(toDomainBundleId)),
            listDistributionCertificates: () =>
              appStoreClient
                .listDistributionCertificates()
                .pipe(Effect.map((certificates) => certificates.map(toDomainCertificate))),
            createCertificate: (csrContent) =>
              appStoreClient.createCertificate(csrContent).pipe(Effect.map(toDomainCertificate)),
            findProfileByName: (name) => appStoreClient.findProfileByName(name),
            createAppStoreProfile: (name, bundleIdResourceId, certificateId, profileType) =>
              appStoreClient.createAppStoreProfile(
                name,
                bundleIdResourceId,
                certificateId,
                profileType,
              ),
            deleteProfile: (profileId) => appStoreClient.deleteProfile(profileId),
            listDevices: () =>
              appStoreClient
                .listDevices()
                .pipe(Effect.map((devices) => devices.map(toDomainDevice))),
            createAdHocProfile: (name, bundleIdResourceId, certificateId, deviceIds, profileType) =>
              appStoreClient.createAdHocProfile(
                name,
                bundleIdResourceId,
                certificateId,
                deviceIds,
                profileType,
              ),
            listBundleIdCapabilities: (bundleIdResourceId) =>
              appStoreClient
                .listBundleIdCapabilities(bundleIdResourceId)
                .pipe(Effect.map((capabilities) => capabilities.map(toDomainCapability))),
          } satisfies AppleCredentialsClient;
        }),
    } satisfies AppleCredentialsClientFactory;
  }),
);
