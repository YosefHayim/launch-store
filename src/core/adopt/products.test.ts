import { describe, expect, it, vi } from "vitest";
import { productsAdopter } from "./products.js";
import type { AdoptCatalogApi, AdoptTarget } from "./types.js";
import type { AppDescriptor } from "../types.js";

/** A fully-stubbed {@link AdoptCatalogApi} whose reads default to "the account is empty". */
function makeApi(overrides: Partial<AdoptCatalogApi> = {}): AdoptCatalogApi {
  const base: AdoptCatalogApi = {
    getAppId: vi.fn().mockResolvedValue("app1"),
    getLatestMarketingVersion: vi.fn().mockResolvedValue("1.0.0"),
    getLatestBuildNumber: vi.fn().mockResolvedValue(1),
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

function target(overrides: Partial<AdoptTarget> = {}): AdoptTarget {
  return {
    app: APP,
    appId: "app1",
    bundleId: "com.acme.app",
    keyId: "K",
    cwd: "/repo",
    hasLaunchConfig: false,
    ...overrides,
  };
}

describe("productsAdopter", () => {
  it("imports an in-app purchase with its localizations, keyed by bundle id", async () => {
    const api = makeApi({
      listInAppPurchases: vi
        .fn()
        .mockResolvedValue([
          { id: "iap1", productId: "com.acme.coins", name: "Coins", inAppPurchaseType: "CONSUMABLE" },
        ]),
      listInAppPurchaseLocalizations: vi
        .fn()
        .mockResolvedValue([{ id: "l1", locale: "en-US", name: "Coins", description: "Buy coins" }]),
    });

    const writes = await productsAdopter.read(api, target());

    expect(writes).toHaveLength(1);
    const [write] = writes;
    expect(write?.description).toBe("products: import in-app purchase com.acme.coins (CONSUMABLE)");
    expect(write?.note).toBeUndefined();
    expect(write?.change).toEqual({
      home: "launch.config",
      bundleId: "com.acme.app",
      piece: {
        type: "iap",
        iap: {
          productId: "com.acme.coins",
          referenceName: "Coins",
          type: "CONSUMABLE",
          localizations: [{ locale: "en-US", name: "Coins", description: "Buy coins" }],
        },
      },
    });
  });

  it("notes a priced product whose amount the API won't cheaply return", async () => {
    const api = makeApi({
      listInAppPurchases: vi
        .fn()
        .mockResolvedValue([
          { id: "iap1", productId: "com.acme.pro", name: "Pro", inAppPurchaseType: "NON_CONSUMABLE" },
        ]),
      inAppPurchaseHasPrice: vi.fn().mockResolvedValue(true),
    });

    const [write] = await productsAdopter.read(api, target());

    expect(write?.note).toMatch(/priced on App Store Connect/);
  });

  it("skips an in-app purchase whose type Launch doesn't model", async () => {
    const api = makeApi({
      listInAppPurchases: vi
        .fn()
        .mockResolvedValue([{ id: "iap1", productId: "com.acme.weird", name: "Weird", inAppPurchaseType: "MYSTERY" }]),
    });

    expect(await productsAdopter.read(api, target())).toEqual([]);
  });

  it("imports a subscription group with its levels and billing period", async () => {
    const api = makeApi({
      listSubscriptionGroups: vi.fn().mockResolvedValue([{ id: "g1", referenceName: "Pro" }]),
      listSubscriptionGroupLocalizations: vi.fn().mockResolvedValue([{ id: "gl", locale: "en-US", name: "Pro Tiers" }]),
      listSubscriptions: vi
        .fn()
        .mockResolvedValue([
          { id: "s1", productId: "com.acme.pro.monthly", name: "Pro Monthly", subscriptionPeriod: "ONE_MONTH" },
        ]),
      listSubscriptionLocalizations: vi.fn().mockResolvedValue([{ id: "sl", locale: "en-US", name: "Pro" }]),
    });

    const [write] = await productsAdopter.read(api, target());

    expect(write?.description).toBe('products: import subscription group "Pro" (1 level)');
    expect(write?.change).toMatchObject({
      home: "launch.config",
      bundleId: "com.acme.app",
      piece: {
        type: "subscriptionGroup",
        group: {
          referenceName: "Pro",
          localizations: [{ locale: "en-US", name: "Pro Tiers" }],
          subscriptions: [
            {
              productId: "com.acme.pro.monthly",
              referenceName: "Pro Monthly",
              subscriptionPeriod: "ONE_MONTH",
              localizations: [{ locale: "en-US", name: "Pro" }],
            },
          ],
        },
      },
    });
  });

  it("drops a subscription group whose only level is missing its billing period", async () => {
    const api = makeApi({
      listSubscriptionGroups: vi.fn().mockResolvedValue([{ id: "g1", referenceName: "Pro" }]),
      listSubscriptions: vi.fn().mockResolvedValue([{ id: "s1", productId: "com.acme.pro", name: "Pro" }]),
    });

    expect(await productsAdopter.read(api, target())).toEqual([]);
  });
});
