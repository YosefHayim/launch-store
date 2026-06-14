/**
 * Translate an app's iOS entitlements into App Store Connect capability flags.
 *
 * EAS enables capabilities as an opaque side-effect of `eas build`, using Apple's fragile cookie/web
 * session. Launch does it explicitly through the official JWT API (`bundleIdCapabilities`), and this
 * module is the pure translation step: `app.json` `ios.entitlements` → the {@link CapabilityType}s the
 * reconciler enables on the bundle id. Keeping it a pure function (no I/O) makes the mapping table the
 * one place to audit and unit-test.
 *
 * Scope: we toggle the capability FLAG only. Associating the concrete container an entitlement points
 * at — a specific App Group, iCloud container, or merchant id — is the one thing Apple's public API
 * still can't do (it needs the cookie session EAS uses), so that part stays in the portal. See the
 * auth-boundary note in the PR for why Launch deliberately cedes that turf.
 */

/**
 * An App Store Connect capability type — the `capabilityType` value on a `bundleIdCapabilities`
 * resource. This is the subset Launch maps from entitlements; Apple's full enum is larger, but a
 * capability with no corresponding entitlement key isn't something a build needs enabled.
 */
export type CapabilityType =
  | "ICLOUD"
  | "IN_APP_PURCHASE"
  | "GAME_CENTER"
  | "PUSH_NOTIFICATIONS"
  | "WALLET"
  | "INTER_APP_AUDIO"
  | "MAPS"
  | "ASSOCIATED_DOMAINS"
  | "PERSONAL_VPN"
  | "APP_GROUPS"
  | "HEALTHKIT"
  | "HOMEKIT"
  | "WIRELESS_ACCESSORY_CONFIGURATION"
  | "APPLE_PAY"
  | "DATA_PROTECTION"
  | "SIRIKIT"
  | "NETWORK_EXTENSIONS"
  | "MULTIPATH"
  | "HOT_SPOT"
  | "NFC_TAG_READING"
  | "CLASSKIT"
  | "AUTOFILL_CREDENTIAL_PROVIDER"
  | "ACCESS_WIFI_INFORMATION"
  | "SYSTEM_EXTENSION_INSTALL"
  | "APPLE_ID_AUTH";

/**
 * Entitlement key → capability type. The authoritative mapping, in one place. Several distinct iCloud
 * entitlements all gate the single `ICLOUD` capability, so they collapse to the same value here.
 */
const ENTITLEMENT_TO_CAPABILITY: Record<string, CapabilityType> = {
  "aps-environment": "PUSH_NOTIFICATIONS",
  "com.apple.developer.aps-environment": "PUSH_NOTIFICATIONS",
  "com.apple.developer.applesignin": "APPLE_ID_AUTH",
  "com.apple.developer.icloud-container-identifiers": "ICLOUD",
  "com.apple.developer.icloud-services": "ICLOUD",
  "com.apple.developer.ubiquity-container-identifiers": "ICLOUD",
  "com.apple.developer.ubiquity-kvstore-identifier": "ICLOUD",
  "com.apple.security.application-groups": "APP_GROUPS",
  "com.apple.developer.in-app-payments": "APPLE_PAY",
  "com.apple.developer.healthkit": "HEALTHKIT",
  "com.apple.developer.homekit": "HOMEKIT",
  "com.apple.developer.associated-domains": "ASSOCIATED_DOMAINS",
  "com.apple.developer.networking.vpn.api": "PERSONAL_VPN",
  "com.apple.developer.networking.networkextension": "NETWORK_EXTENSIONS",
  "com.apple.developer.networking.multipath": "MULTIPATH",
  "com.apple.developer.networking.HotspotConfiguration": "HOT_SPOT",
  "com.apple.developer.networking.wifi-info": "ACCESS_WIFI_INFORMATION",
  "com.apple.developer.nfc.readersession.formats": "NFC_TAG_READING",
  "com.apple.developer.ClassKit-environment": "CLASSKIT",
  "com.apple.developer.authentication-services.autofill-credential-provider": "AUTOFILL_CREDENTIAL_PROVIDER",
  "com.apple.developer.siri": "SIRIKIT",
  "com.apple.developer.pass-type-identifiers": "WALLET",
  "com.apple.developer.maps": "MAPS",
  "com.apple.developer.system-extension.install": "SYSTEM_EXTENSION_INSTALL",
  "com.apple.external-accessory.wireless-configuration": "WIRELESS_ACCESSORY_CONFIGURATION",
  "inter-app-audio": "INTER_APP_AUDIO",
};

/**
 * Entitlement keys that are NOT capabilities: signing plumbing Xcode/the profile own (team id, app
 * id, keychain groups, debug flag) or values the OS reads directly. Listing them explicitly means a
 * truly-unrecognized key still surfaces as {@link mapEntitlementsToCapabilities}'s `unmapped` (a real
 * "you may need to handle this in the portal" signal) instead of being lost in the noise.
 */
const IGNORED_ENTITLEMENTS = new Set<string>([
  "application-identifier",
  "com.apple.developer.team-identifier",
  "keychain-access-groups",
  "get-task-allow",
  "com.apple.developer.default-data-protection",
  "com.apple.developer.kernel.increased-memory-limit",
  "com.apple.developer.kernel.extended-virtual-addressing",
]);

/** The outcome of mapping entitlements: capabilities to enable, plus keys we didn't recognize. */
export interface CapabilityMapping {
  /** Capability flags to enable on the bundle id, de-duplicated and stably ordered. */
  enable: CapabilityType[];
  /** Entitlement keys neither mapped to a capability nor known to be ignorable — surfaced as a warning. */
  unmapped: string[];
}

/**
 * Map an app's `ios.entitlements` to the capabilities Launch should enable on its bundle id. Pure:
 * the result depends only on the input keys (values are irrelevant — Apple toggles a capability by
 * presence, and the concrete container is out of API scope). De-dupes collapsing iCloud entitlements
 * and returns the enable list sorted for a deterministic plan/diff.
 */
export function mapEntitlementsToCapabilities(entitlements: Record<string, unknown> | undefined): CapabilityMapping {
  const enable = new Set<CapabilityType>();
  const unmapped: string[] = [];
  for (const key of Object.keys(entitlements ?? {})) {
    const capability = ENTITLEMENT_TO_CAPABILITY[key];
    if (capability) {
      enable.add(capability);
    } else if (!IGNORED_ENTITLEMENTS.has(key)) {
      unmapped.push(key);
    }
  }
  return { enable: [...enable].sort(), unmapped: unmapped.sort() };
}
