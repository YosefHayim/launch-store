import { describe, expect, it, vi } from "vitest";
import { capabilitiesAdopter, planCapabilityEntitlements } from "./capabilities.js";
import { NEEDS_VALUE, type AdoptCatalogApi, type AdoptTarget } from "./types.js";
import type { AppDescriptor } from "../types.js";

describe("planCapabilityEntitlements", () => {
  it("recovers a real identifier value from the provisioning profile", () => {
    const planned = planCapabilityEntitlements({
      enabledTypes: ["APP_GROUPS"],
      settingsByType: {},
      profileEntitlements: { "com.apple.security.application-groups": ["group.com.acme"] },
      existing: {},
    });
    expect(planned).toEqual([{ key: "com.apple.security.application-groups", value: ["group.com.acme"] }]);
  });

  it("flags an enabled capability with NEEDS_VALUE and an off-Mac note when no profile is available", () => {
    const [planned] = planCapabilityEntitlements({
      enabledTypes: ["APP_GROUPS"],
      settingsByType: {},
      profileEntitlements: null,
      existing: {},
    });
    expect(planned?.value).toBe(NEEDS_VALUE);
    expect(planned?.note).toMatch(/off-Mac or none/);
  });

  it("flags an enabled capability the profile omits with a profile-gap note", () => {
    const [planned] = planCapabilityEntitlements({
      enabledTypes: ["PUSH_NOTIFICATIONS"],
      settingsByType: {},
      profileEntitlements: {},
      existing: {},
    });
    expect(planned).toEqual({
      key: "aps-environment",
      value: NEEDS_VALUE,
      note: "enabled on App Store Connect but no value in the provisioning profile",
    });
  });

  it("never overwrites an entitlement the app.json already declares", () => {
    const planned = planCapabilityEntitlements({
      enabledTypes: ["APP_GROUPS"],
      settingsByType: {},
      profileEntitlements: { "com.apple.security.application-groups": ["group.com.acme"] },
      existing: { "com.apple.security.application-groups": ["group.existing"] },
    });
    expect(planned).toEqual([]);
  });

  it("ignores always-on capabilities that carry no entitlement", () => {
    const planned = planCapabilityEntitlements({
      enabledTypes: ["IN_APP_PURCHASE", "GAME_CENTER"],
      settingsByType: {},
      profileEntitlements: {},
      existing: {},
    });
    expect(planned).toEqual([]);
  });

  it("appends capability settings to a NEEDS_VALUE note as advisory detail", () => {
    const [planned] = planCapabilityEntitlements({
      enabledTypes: ["ICLOUD"],
      settingsByType: { ICLOUD: [{ key: "ICLOUD_VERSION", options: [{ key: "VERSION_2" }] }] },
      profileEntitlements: {},
      existing: {},
    });
    expect(planned?.key).toBe("com.apple.developer.icloud-container-identifiers");
    expect(planned?.note).toContain("settings: ICLOUD_VERSION=VERSION_2");
  });
});

function makeApi(overrides: Partial<AdoptCatalogApi> = {}): AdoptCatalogApi {
  const base: AdoptCatalogApi = {
    getAppId: vi.fn().mockResolvedValue("app1"),
    getLatestMarketingVersion: vi.fn().mockResolvedValue(null),
    getLatestBuildNumber: vi.fn().mockResolvedValue(0),
    findBundleId: vi.fn().mockResolvedValue({ id: "b1", identifier: "com.acme.app" }),
    listBundleIdCapabilities: vi.fn().mockResolvedValue([]),
    listProfilesForBundleId: vi.fn().mockResolvedValue([]),
    listMerchantIds: vi.fn().mockResolvedValue([]),
    listInAppPurchases: vi.fn().mockResolvedValue([]),
    listInAppPurchaseLocalizations: vi.fn().mockResolvedValue([]),
    inAppPurchaseHasPrice: vi.fn().mockResolvedValue(false),
    listSubscriptionGroups: vi.fn().mockResolvedValue([]),
    listSubscriptionGroupLocalizations: vi.fn().mockResolvedValue([]),
    listSubscriptions: vi.fn().mockResolvedValue([]),
    listSubscriptionLocalizations: vi.fn().mockResolvedValue([]),
    subscriptionHasPrice: vi.fn().mockResolvedValue(false),
    listDistributionCertificates: vi.fn().mockResolvedValue([]),
  };
  return { ...base, ...overrides };
}

const APP: AppDescriptor = {
  name: "acme",
  dir: "/repo/acme",
  configPath: "/repo/acme/app.json",
  bundleId: "com.acme.app",
};
const TARGET: AdoptTarget = {
  app: APP,
  appId: "app1",
  bundleId: "com.acme.app",
  keyId: "K",
  cwd: "/repo",
  hasLaunchConfig: false,
};

describe("capabilitiesAdopter", () => {
  it("returns no writes when the bundle id isn't registered yet", async () => {
    const api = makeApi({ findBundleId: vi.fn().mockResolvedValue(null) });
    expect(await capabilitiesAdopter.read(api, TARGET)).toEqual([]);
  });

  it("plans app.json entitlement writes for enabled capabilities with no profile to read", async () => {
    const api = makeApi({
      listBundleIdCapabilities: vi.fn().mockResolvedValue([{ id: "c1", capabilityType: "PUSH_NOTIFICATIONS" }]),
      listProfilesForBundleId: vi.fn().mockResolvedValue([]),
    });
    const writes = await capabilitiesAdopter.read(api, TARGET);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.change).toEqual({
      home: "app.json",
      configPath: "/repo/acme/app.json",
      key: "aps-environment",
      value: NEEDS_VALUE,
    });
    expect(writes[0]?.fidelity).toBe("advisory");
  });
});
