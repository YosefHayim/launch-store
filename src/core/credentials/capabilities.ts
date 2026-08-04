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
/**
 * Entitlement key -> capability type. The authoritative mapping, in one place. Several distinct iCloud
 * entitlements all gate the single `ICLOUD` capability, so they collapse to the same value here.
 */
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
/**
 * Entitlement keys that are NOT capabilities: signing plumbing Xcode/the profile own (team id, app
 * id, keychain groups, debug flag) or values the OS reads directly. Listing them explicitly means a
 * truly-unrecognized key still surfaces as {@link mapEntitlementsToCapabilities}'s `unmapped` (a real
 * "you may need to handle this in the portal" signal) instead of being lost in the noise.
 */
const IGNORED_ENTITLEMENTS = new Set<string>([
  'application-identifier',
  'com.apple.developer.team-identifier',
  'keychain-access-groups',
  'get-task-allow',
  'com.apple.developer.default-data-protection',
  'com.apple.developer.kernel.increased-memory-limit',
  'com.apple.developer.kernel.extended-virtual-addressing',
]);
/**
 * Capability type -> the one **canonical** entitlement key `launch adopt` emits for it when a shipping
 * app's provisioning profile didn't supply a concrete value (so the entitlement is written with the
 * build-breaking {@link import("../adopt/capabilities.js").NEEDS_VALUE} sentinel for the developer to fill in).
 *
 * This is the curated inverse of {@link ENTITLEMENT_TO_CAPABILITY}: that map is many-to-one (several
 * iCloud entitlements collapse to `ICLOUD`), so the inverse must pick a single representative key per
 * capability - the identifier-bearing one a developer most likely needs (e.g. the iCloud *container
 * identifiers*, not the kv-store key). Capabilities Apple always enables and that carry no entitlement
 * (`IN_APP_PURCHASE`, `GAME_CENTER`) are intentionally absent - there is nothing to write to `app.json`.
 * Kept here, beside the forward map, so the entitlementcapability vocabulary has one home to audit.
 */
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
const CAPABILITY_TO_ENTITLEMENT_LOOKUP = new Map<string, string>(
  Object.entries(CAPABILITY_TO_ENTITLEMENT),
);
/** The full set of {@link CapabilityType}s Launch maps, for narrowing a raw `capabilityType` wire string. */
const CAPABILITY_TYPES = new Set<string>(Object.values(ENTITLEMENT_TO_CAPABILITY));
/** Narrow a raw App Store Connect `capabilityType` string to a {@link CapabilityType} Launch recognizes. */
export const isCapabilityType = (capabilityText: string): capabilityText is CapabilityType => {
  return CAPABILITY_TYPES.has(capabilityText);
};
/** Whether an entitlement key is one Launch maps to an App Store Connect capability (vs. signing plumbing). */
export const isCapabilityEntitlement = (key: string): boolean => {
  return key in ENTITLEMENT_TO_CAPABILITY;
};
/**
 * The canonical `app.json` entitlement key for a capability type, or `undefined` for an always-on /
 * value-less capability that needs no entitlement. Accepts a raw `capabilityType` string (Apple's wire
 * value) so `launch adopt` can look up a gap without first narrowing to {@link CapabilityType}.
 */
export const entitlementForCapability = (capabilityType: string): string | undefined => {
  return CAPABILITY_TO_ENTITLEMENT_LOOKUP.get(capabilityType);
};
/** The outcome of mapping entitlements: capabilities to enable, plus keys we didn't recognize. */
export type CapabilityMapping = {
  enable: CapabilityType[];
  unmapped: string[];
};
/**
 * Map an app's `ios.entitlements` to the capabilities Launch should enable on its bundle id. Pure:
 * the result depends only on the input keys (values are irrelevant - Apple toggles a capability by
 * presence, and the concrete container is out of API scope). De-dupes collapsing iCloud entitlements
 * and returns the enable list sorted for a deterministic plan/diff.
 */
export const mapEntitlementsToCapabilities = (
  entitlements: Record<string, unknown> | undefined,
): CapabilityMapping => {
  const enable = new Set<CapabilityType>();
  const unmapped: string[] = [];
  let configuredEntitlements = entitlements;
  if (configuredEntitlements === undefined) configuredEntitlements = {};
  for (const key of Object.keys(configuredEntitlements)) {
    const capability = ENTITLEMENT_TO_CAPABILITY[key];
    if (capability) {
      enable.add(capability);
    } else if (!IGNORED_ENTITLEMENTS.has(key)) {
      unmapped.push(key);
    }
  }
  return { enable: [...enable].sort(), unmapped: unmapped.sort() };
};
export const staleProfileCapabilities = (
  enabledOnAppId: string[],
  profileEntitlements: Record<string, unknown> | null,
): CapabilityType[] => {
  if (!profileEntitlements) return [];
  const profileCapabilities = new Set(mapEntitlementsToCapabilities(profileEntitlements).enable);
  const missing = new Set<CapabilityType>();
  for (const capabilityType of enabledOnAppId) {
    if (!isCapabilityType(capabilityType)) continue;
    if (!entitlementForCapability(capabilityType)) continue;
    if (!profileCapabilities.has(capabilityType)) missing.add(capabilityType);
  }
  return [...missing].sort();
};
/** The entitlement key whose value lists the `group.*` App Group container ids a bundle joins. */
export const APP_GROUPS_ENTITLEMENT = 'com.apple.security.application-groups';
/**
 * The `group.*` App Group container ids declared by one bundle's entitlements. The
 * {@link APP_GROUPS_ENTITLEMENT} value is an array of group ids in a normal Expo config; this reads it
 * defensively (a lone string is tolerated, non-strings dropped) so a hand-edited config can't throw.
 * Pure - used to detect the portal-only App Group step (see {@link mapEntitlementsToCapabilities} for
 * why the *container* itself is out of API scope).
 */
export const appGroupContainers = (entitlements: Record<string, unknown> | undefined): string[] => {
  const entitlementValue = entitlements?.[APP_GROUPS_ENTITLEMENT];
  if (typeof entitlementValue === 'string') return [entitlementValue];
  if (!Array.isArray(entitlementValue)) return [];
  return entitlementValue.filter((id): id is string => typeof id === 'string' && id.length > 0);
};
/** The Apple Developer portal page where App Group container ids are created and assigned to bundle ids. */
export const APP_GROUP_PORTAL_URL =
  'https://developer.apple.com/account/resources/identifiers/list/applicationGroup';
/**
 * The actionable message to print when an app (or one of its extensions) declares App Group containers,
 * or `null` when it declares none. Creating a `group.*` container and assigning it to the bundle ids that
 * share it is the one signing step Apple's JWT API can't do - it needs the portal's cookie session, which
 * Launch deliberately doesn't automate. Surfacing this up front turns the otherwise cryptic `xcodebuild`
 * exit 65 ("provisioning profile doesn't include the application-groups entitlement") into a precise
 * to-do: which groups, where to create them, and which bundle ids must join. Pure - for the build path to
 * warn before archiving and for unit tests.
 */
export const appGroupPortalNotice = (containers: string[]): string | null => {
  if (containers.length === 0) return null;
  const groups = containers.map((id) => `"${id}"`).join(', ');
  let plural = 'App Groups';
  if (containers.length === 1) plural = 'App Group';
  return (
    `This app uses ${plural} (${groups}). Launch can register the App ID and enable the App Groups ` +
    `capability, but the public Apple API can't create the group container or assign it to your bundle ` +
    `ids - that step is portal-only. Create each ${plural.toLowerCase()} and add it to every bundle id ` +
    `that shares it (the main app and each extension) at ${APP_GROUP_PORTAL_URL}, or xcodebuild will fail ` +
    `to export (exit 65).`
  );
};
