// App Store Connect provisioning: bundle IDs, certificates, devices, and profiles.

/** A registered Bundle ID resource (an App ID in the Developer portal). */
export type BundleIdResource = Readonly<{
  id: string;
  identifier: string;
  seedId?: string | undefined;
}>;

/** A signing certificate resource, with the bytes needed to package a `.p12`. */
export type CertificateResource = Readonly<{
  id: string;
  serialNumber: string;
  certificateContent: string;
  expirationDate?: string | undefined;
}>;

/** A device registered in the Developer portal, eligible to receive ad-hoc builds. */
export type DeviceResource = Readonly<{
  id: string;
  udid: string;
  name: string;
  status?: string | undefined;
}>;

/** A provisioning profile resource, with the bytes needed to install it locally. */
export type ProfileResource = Readonly<{
  id: string;
  name: string;
  uuid: string;
  profileContent: string;
}>;

/** One configured key on a capability's `settings` - Apple's per-capability toggle list (e.g. */
export type CapabilitySetting = Readonly<{
  key: string;
  options?: Readonly<{
    key: string;
  }>[];
}>;

/** A capability enabled on a bundle id (App ID), e.g. `PUSH_NOTIFICATIONS`. */
export type BundleIdCapabilityResource = Readonly<{
  id: string;
  capabilityType: string;
  settings?: readonly CapabilitySetting[];
}>;

/** An Apple Pay **merchant id** (e.g. */
export type MerchantIdResource = Readonly<{
  id: string;
  identifier?: string;
  name?: string;
}>;

/** A Wallet **pass type id** (e.g. */
export type PassTypeIdResource = Readonly<{
  id: string;
  identifier?: string;
  name?: string;
}>;
