import { describe, expect, it } from "vitest";
import { appleProductsSource } from "./appleProducts.js";
import { appleSubscriptionsSource } from "./appleSubscriptions.js";
import { playProductsSource } from "./playProducts.js";
import { playSubscriptionsSource } from "./playSubscriptions.js";
import type { SnapshotAscApi, SnapshotContext, SnapshotPlayApi } from "../types.js";
import type { AppDescriptor, LaunchConfig } from "../../types.js";

const CONFIG: LaunchConfig = {
  profiles: {},
  credentials: "local",
  storage: "local",
  buildEngine: "fastlane",
  submit: "app-store-connect",
};

function app(over: Partial<AppDescriptor>): AppDescriptor {
  return { name: "alpha", dir: "/tmp/alpha", configPath: "/tmp/alpha/app.json", ...over };
}

function ctx(over: Partial<SnapshotContext>): SnapshotContext {
  return {
    config: CONFIG,
    apps: [],
    resolveAscApi: () => Promise.resolve(null),
    resolvePlayApi: () => Promise.resolve(null),
    ...over,
  };
}

const ascApi: SnapshotAscApi = {
  getAppId: () => Promise.resolve("1234567890"),
  listInAppPurchases: () =>
    Promise.resolve([{ productId: "com.acme.coins", inAppPurchaseType: "CONSUMABLE", state: "APPROVED" }]),
  listSubscriptionGroups: () => Promise.resolve([{ id: "g1", referenceName: "Pro" }]),
  listSubscriptions: () =>
    Promise.resolve([{ productId: "com.acme.pro", subscriptionPeriod: "P1M", state: "APPROVED" }]),
};

const playApi: SnapshotPlayApi = {
  listInAppProducts: () =>
    Promise.resolve([
      {
        sku: "coins",
        status: "active",
        defaultLanguage: "en-US",
        defaultPrice: { priceMicros: "990000", currency: "USD" },
        listings: { "en-US": { title: "Coins", description: "A pile of coins" } },
      },
    ]),
  listSubscriptions: () =>
    Promise.resolve([
      {
        productId: "sub.pro",
        basePlans: [
          { basePlanId: "monthly", state: "ACTIVE", autoRenewingBasePlanType: { billingPeriodDuration: "P1M" } },
        ],
        listings: [{ languageCode: "en-US", title: "Pro", description: "Pro plan" }],
      },
    ]),
};

describe("appleProductsSource", () => {
  it("omits when no iOS apps are in scope", async () => {
    const capture = await appleProductsSource.capture(ctx({ apps: [app({ packageName: "com.acme.alpha" })] }));
    expect(capture).toEqual({ state: "omitted" });
  });

  it("skips when no Apple account is active", async () => {
    const capture = await appleProductsSource.capture(ctx({ apps: [app({ bundleId: "com.acme.alpha" })] }));
    expect(capture.state).toBe("skipped");
  });

  it("captures each in-app purchase keyed by product id", async () => {
    const capture = await appleProductsSource.capture(
      ctx({ apps: [app({ bundleId: "com.acme.alpha" })], resolveAscApi: () => Promise.resolve(ascApi) }),
    );
    if (capture.state !== "captured") throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps[0]?.entities).toEqual([
      {
        key: "com.acme.coins",
        summary: "in-app purchase CONSUMABLE (APPROVED)",
        data: { productId: "com.acme.coins", type: "CONSUMABLE", state: "APPROVED" },
      },
    ]);
  });

  it("drops an app with no App Store Connect record yet", async () => {
    const capture = await appleProductsSource.capture(
      ctx({
        apps: [app({ bundleId: "com.acme.alpha" })],
        resolveAscApi: () => Promise.resolve({ ...ascApi, getAppId: () => Promise.resolve(null) }),
      }),
    );
    if (capture.state !== "captured") throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps).toEqual([]);
  });
});

describe("appleSubscriptionsSource", () => {
  it("flattens subscriptions across groups, keyed by product id with the group recorded", async () => {
    const capture = await appleSubscriptionsSource.capture(
      ctx({ apps: [app({ bundleId: "com.acme.alpha" })], resolveAscApi: () => Promise.resolve(ascApi) }),
    );
    if (capture.state !== "captured") throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps[0]?.entities).toEqual([
      {
        key: "com.acme.pro",
        summary: "subscription P1M in Pro (APPROVED)",
        data: { productId: "com.acme.pro", group: "Pro", period: "P1M", state: "APPROVED" },
      },
    ]);
  });
});

describe("playProductsSource", () => {
  it("skips when no Play service account is configured", async () => {
    const capture = await playProductsSource.capture(ctx({ apps: [app({ packageName: "com.acme.alpha" })] }));
    expect(capture.state).toBe("skipped");
  });

  it("captures managed products keyed by SKU, dropping the fanned-out region prices", async () => {
    const capture = await playProductsSource.capture(
      ctx({ apps: [app({ packageName: "com.acme.alpha" })], resolvePlayApi: () => Promise.resolve(playApi) }),
    );
    if (capture.state !== "captured") throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps[0]?.entities).toEqual([
      {
        key: "coins",
        summary: "Play product (active)",
        data: {
          sku: "coins",
          status: "active",
          defaultLanguage: "en-US",
          defaultPrice: { priceMicros: "990000", currency: "USD" },
          listings: { "en-US": { title: "Coins", description: "A pile of coins" } },
        },
      },
    ]);
  });
});

describe("playSubscriptionsSource", () => {
  it("captures subscriptions with base plans and listings, keyed by product id", async () => {
    const capture = await playSubscriptionsSource.capture(
      ctx({ apps: [app({ packageName: "com.acme.alpha" })], resolvePlayApi: () => Promise.resolve(playApi) }),
    );
    if (capture.state !== "captured") throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps[0]?.entities).toEqual([
      {
        key: "sub.pro",
        summary: "Play subscription (1 base plan(s))",
        data: {
          productId: "sub.pro",
          basePlans: [{ basePlanId: "monthly", state: "ACTIVE", period: "P1M" }],
          listings: [{ languageCode: "en-US", title: "Pro" }],
        },
      },
    ]);
  });
});
