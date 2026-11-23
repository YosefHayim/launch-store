export type CapabilityType =
  | 'ICLOUD'
  | 'IN_APP_PURCHASE'
  | 'GAME_CENTER'
  | 'PUSH_NOTIFICATIONS'
  | 'WALLET'
  | 'INTER_APP_AUDIO'
  | 'MAPS'
  | 'ASSOCIATED_DOMAINS'
  | 'PERSONAL_VPN'
  | 'APP_GROUPS'
  | 'HEALTHKIT'
  | 'HOMEKIT'
  | 'WIRELESS_ACCESSORY_CONFIGURATION'
  | 'APPLE_PAY'
  | 'DATA_PROTECTION'
  | 'SIRIKIT'
  | 'NETWORK_EXTENSIONS'
  | 'MULTIPATH'
  | 'HOT_SPOT'
  | 'NFC_TAG_READING'
  | 'CLASSKIT'
  | 'AUTOFILL_CREDENTIAL_PROVIDER'
  | 'ACCESS_WIFI_INFORMATION'
  | 'SYSTEM_EXTENSION_INSTALL'
  | 'APPLE_ID_AUTH';
/** Entitlement key -> capability type. */
const ENTITLEMENT_TO_CAPABILITY: Record<string, CapabilityType> = {
  'aps-environment': 'PUSH_NOTIFICATIONS',
  'com.apple.developer.aps-environment': 'PUSH_NOTIFICATIONS',
  'com.apple.developer.applesignin': 'APPLE_ID_AUTH',
  'com.apple.developer.icloud-container-identifiers': 'ICLOUD',
  'com.apple.developer.icloud-services': 'ICLOUD',
  'com.apple.developer.ubiquity-container-identifiers': 'ICLOUD',
  'com.apple.developer.ubiquity-kvstore-identifier': 'ICLOUD',
  'com.apple.security.application-groups': 'APP_GROUPS',
  'com.apple.developer.in-app-payments': 'APPLE_PAY',
  'com.apple.developer.healthkit': 'HEALTHKIT',
  'com.apple.developer.homekit': 'HOMEKIT',
  'com.apple.developer.associated-domains': 'ASSOCIATED_DOMAINS',
  'com.apple.developer.networking.vpn.api': 'PERSONAL_VPN',
  'com.apple.developer.networking.networkextension': 'NETWORK_EXTENSIONS',
  'com.apple.developer.networking.multipath': 'MULTIPATH',
  'com.apple.developer.networking.HotspotConfiguration': 'HOT_SPOT',
  'com.apple.developer.networking.wifi-info': 'ACCESS_WIFI_INFORMATION',
  'com.apple.developer.nfc.readersession.formats': 'NFC_TAG_READING',
  'com.apple.developer.ClassKit-environment': 'CLASSKIT',
  'com.apple.developer.authentication-services.autofill-credential-provider':
    'AUTOFILL_CREDENTIAL_PROVIDER',
  'com.apple.developer.siri': 'SIRIKIT',
  'com.apple.developer.pass-type-identifiers': 'WALLET',
  'com.apple.developer.maps': 'MAPS',
  'com.apple.developer.system-extension.install': 'SYSTEM_EXTENSION_INSTALL',
  'com.apple.external-accessory.wireless-configuration': 'WIRELESS_ACCESSORY_CONFIGURATION',
  'inter-app-audio': 'INTER_APP_AUDIO',
};
/** Entitlement keys that are NOT capabilities */
const ignoredEntitlements = new Set<string>([
  'application-identifier',
  'com.apple.developer.team-identifier',
  'keychain-access-groups',
  'get-task-allow',
  'com.apple.developer.default-data-protection',
  'com.apple.developer.kernel.increased-memory-limit',
  'com.apple.developer.kernel.extended-virtual-addressing',
]);
/** Capability type -> the one **canonical** entitlement key `launch-store adopt` emits for it */
export const CAPABILITY_TO_ENTITLEMENT: Partial<Record<CapabilityType, string>> = {
  PUSH_NOTIFICATIONS: 'aps-environment',
  APPLE_ID_AUTH: 'com.apple.developer.applesignin',
  ICLOUD: 'com.apple.developer.icloud-container-identifiers',
  APP_GROUPS: 'com.apple.security.application-groups',
  APPLE_PAY: 'com.apple.developer.in-app-payments',
  HEALTHKIT: 'com.apple.developer.healthkit',
  HOMEKIT: 'com.apple.developer.homekit',
  ASSOCIATED_DOMAINS: 'com.apple.developer.associated-domains',
  PERSONAL_VPN: 'com.apple.developer.networking.vpn.api',
  NETWORK_EXTENSIONS: 'com.apple.developer.networking.networkextension',
  MULTIPATH: 'com.apple.developer.networking.multipath',
  HOT_SPOT: 'com.apple.developer.networking.HotspotConfiguration',
  ACCESS_WIFI_INFORMATION: 'com.apple.developer.networking.wifi-info',
  NFC_TAG_READING: 'com.apple.developer.nfc.readersession.formats',
  CLASSKIT: 'com.apple.developer.ClassKit-environment',
  AUTOFILL_CREDENTIAL_PROVIDER:
    'com.apple.developer.authentication-services.autofill-credential-provider',
  SIRIKIT: 'com.apple.developer.siri',
  WALLET: 'com.apple.developer.pass-type-identifiers',
  MAPS: 'com.apple.developer.maps',
  SYSTEM_EXTENSION_INSTALL: 'com.apple.developer.system-extension.install',
  WIRELESS_ACCESSORY_CONFIGURATION: 'com.apple.external-accessory.wireless-configuration',
  INTER_APP_AUDIO: 'inter-app-audio',
  // DATA_PROTECTION is intentionally absent: its `com.apple.developer.default-data-protection` key is
  // signing/OS plumbing (in IGNORED_ENTITLEMENTS, not a capability toggle), and its level is set via the
  // capability's settings, so adopt surfaces it as advisory detail rather than an app.json entitlement.
};
/** Reverse map as a string-keyed lookup, so a raw `capabilityType` string resolves without a cast. */
const ownEntries = Object.entries(CAPABILITY_TO_ENTITLEMENT);
const capabilityToEntitlementLookup = new Map<string, string>(ownEntries);
/** The full set of {@link CapabilityType}s Launch maps, for narrowing a raw `capabilityType` wire string. */
const ownValues = Object.values(ENTITLEMENT_TO_CAPABILITY);
const capabilityTypes = new Set<string>(ownValues);
/** Narrow a raw App Store Connect `capabilityType` string to a {@link CapabilityType} Launch recognizes. */
export function isCapabilityType(capabilityText: string): capabilityText is CapabilityType {
  return capabilityTypes.has(capabilityText);
}
/** Whether an entitlement key is one Launch maps to an App Store Connect capability (vs. signing plumbing). */
export function isCapabilityEntitlement(key: string): boolean {
  return key in ENTITLEMENT_TO_CAPABILITY;
}
/** The canonical `app.json` entitlement key for a capability type */
export function entitlementForCapability(capabilityType: string): string | undefined {
  return capabilityToEntitlementLookup.get(capabilityType);
}
/** The outcome of mapping entitlements: capabilities to enable, plus keys we didn't recognize. */
type CapabilityMapping = {
  enable: CapabilityType[];
  unmapped: string[];
};
/** Map an app's `ios.entitlements` to the capabilities Launch should enable on its bundle id. */
export function mapEntitlementsToCapabilities(
  entitlements: Record<string, unknown> | undefined,
): CapabilityMapping {
  const enable = new Set<CapabilityType>();
  const unmapped: string[] = [];
  let configuredEntitlements = entitlements;

  if (configuredEntitlements == null) configuredEntitlements = {};

  for (const key of Object.keys(configuredEntitlements)) {
    const capability = ENTITLEMENT_TO_CAPABILITY[key];

    if (capability) {
      enable.add(capability);
    } else if (!ignoredEntitlements.has(key)) {
      unmapped.push(key);
    }
  }

  return { enable: [...enable].sort(), unmapped: unmapped.sort() };
}
export function staleProfileCapabilities(
  enabledOnAppId: string[],
  profileEntitlements: Record<string, unknown> | null,
): CapabilityType[] {
  if (!profileEntitlements) return [];

  const profileCapabilities = new Set(mapEntitlementsToCapabilities(profileEntitlements).enable);
  const missing = new Set<CapabilityType>();

  for (const capabilityType of enabledOnAppId) {
    if (!isCapabilityType(capabilityType)) continue;

    if (!entitlementForCapability(capabilityType)) continue;

    if (!profileCapabilities.has(capabilityType)) missing.add(capabilityType);
  }

  return [...missing].sort();
}
/** The `group.*` App Group container ids declared by one bundle's entitlements. */
export const appGroupContainers = (entitlements: Record<string, unknown> | undefined): string[] => {
  const entitlementValue = entitlements?.['com.apple.security.application-groups'];

  if (typeof entitlementValue == 'string') return [entitlementValue];

  if (!Array.isArray(entitlementValue)) return [];

  return entitlementValue.filter((id): id is string => typeof id == 'string' && id.length > 0);
};
/** The Apple Developer portal page where App Group container ids are created and assigned to bundle ids. */
export const APP_GROUP_PORTAL_URL =
  'https://developer.apple.com/account/resources/identifiers/list/applicationGroup';
/** The actionable message to print when an app (or one of its extensions) declares App Group */
export function appGroupPortalNotice(containers: readonly string[]): string | null {
  if (containers.length == 0) return null;

  function mapId(id: string) {
    return `"${id}"`;
  }

  const groups = containers.map(mapId).join(', ');
  let plural = 'App Groups';

  if (containers.length == 1) plural = 'App Group';

  return (
    `This app uses ${plural} (${groups}). Launch can register the App ID and enable the App Groups ` +
    `capability, but the public Apple API can't create the group container or assign it to your bundle ` +
    `ids - that step is portal-only. Create each ${plural.toLowerCase()} and add it to every bundle id ` +
    `that shares it (the main app and each extension) at ${APP_GROUP_PORTAL_URL}, or xcodebuild will fail ` +
    `to export (exit 65).`
  );
}
