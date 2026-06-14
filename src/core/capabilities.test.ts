import { describe, expect, it } from "vitest";
import { mapEntitlementsToCapabilities } from "./capabilities.js";

describe("mapEntitlementsToCapabilities", () => {
  it("maps known entitlement keys to their capability types", () => {
    const { enable } = mapEntitlementsToCapabilities({
      "aps-environment": "production",
      "com.apple.developer.applesignin": ["Default"],
      "com.apple.security.application-groups": ["group.com.acme"],
    });
    // ASCII order: 'L' (76) < '_' (95), so APPLE_ID_AUTH sorts before APP_GROUPS.
    expect(enable).toEqual(["APPLE_ID_AUTH", "APP_GROUPS", "PUSH_NOTIFICATIONS"]);
  });

  it("collapses the several iCloud entitlements onto a single ICLOUD capability", () => {
    const { enable } = mapEntitlementsToCapabilities({
      "com.apple.developer.icloud-container-identifiers": ["iCloud.com.acme"],
      "com.apple.developer.icloud-services": ["CloudKit"],
      "com.apple.developer.ubiquity-kvstore-identifier": "X.com.acme",
    });
    expect(enable).toEqual(["ICLOUD"]);
  });

  it("ignores signing-plumbing entitlements without flagging them as unmapped", () => {
    const { enable, unmapped } = mapEntitlementsToCapabilities({
      "application-identifier": "ABCDE.com.acme",
      "com.apple.developer.team-identifier": "ABCDE",
      "keychain-access-groups": ["ABCDE.com.acme"],
      "get-task-allow": true,
    });
    expect(enable).toEqual([]);
    expect(unmapped).toEqual([]);
  });

  it("surfaces a genuinely unrecognized entitlement key as unmapped", () => {
    const { enable, unmapped } = mapEntitlementsToCapabilities({
      "com.apple.developer.healthkit": true,
      "com.apple.developer.some-future-thing": true,
    });
    expect(enable).toEqual(["HEALTHKIT"]);
    expect(unmapped).toEqual(["com.apple.developer.some-future-thing"]);
  });

  it("returns empty results for missing or empty entitlements", () => {
    expect(mapEntitlementsToCapabilities(undefined)).toEqual({ enable: [], unmapped: [] });
    expect(mapEntitlementsToCapabilities({})).toEqual({ enable: [], unmapped: [] });
  });

  it("returns a stably-sorted enable list regardless of key order", () => {
    const a = mapEntitlementsToCapabilities({
      "com.apple.developer.siri": true,
      "aps-environment": "production",
      "com.apple.developer.homekit": true,
    });
    const b = mapEntitlementsToCapabilities({
      "com.apple.developer.homekit": true,
      "com.apple.developer.siri": true,
      "aps-environment": "production",
    });
    expect(a.enable).toEqual(b.enable);
    expect(a.enable).toEqual(["HOMEKIT", "PUSH_NOTIFICATIONS", "SIRIKIT"]);
  });
});
