import { describe, expect, it } from "vitest";
import type { InAppProductResource } from "../google/playClient.js";
import type { InAppPurchaseConfig } from "./types.js";
import {
  type PlayProductsApi,
  productInSync,
  reconcilePlayProducts,
  summarizePlayProducts,
  toPlayProduct,
} from "./playProducts.js";

/** Records every write the reconciler makes, so a test can assert exactly what was sent to Play. */
interface Calls {
  inserts: InAppProductResource[];
  updates: InAppProductResource[];
}

/** A hand-rolled {@link PlayProductsApi} — no network — serving `existing` and recording the writes. */
function makeApi(
  existing: InAppProductResource[],
  options: { reachable?: boolean; failSku?: string } = {},
): { api: PlayProductsApi; calls: Calls } {
  const calls: Calls = { inserts: [], updates: [] };
  const api: PlayProductsApi = {
    assertAppExists: () =>
      options.reachable === false ? Promise.reject(new Error("No reachable Play app")) : Promise.resolve(),
    listInAppProducts: () => Promise.resolve(existing),
    insertInAppProduct: (_pkg, product) => {
      if (product.sku === options.failSku) return Promise.reject(new Error("price not on a valid tier"));
      calls.inserts.push(product);
      return Promise.resolve();
    },
    updateInAppProduct: (_pkg, product) => {
      calls.updates.push(product);
      return Promise.resolve();
    },
  };
  return { api, calls };
}

/** A minimal shared in-app-purchase config with a Play override. */
function product(overrides: Partial<InAppPurchaseConfig> = {}): InAppPurchaseConfig {
  return {
    productId: "com.acme.coins.100",
    referenceName: "100 Coins",
    type: "CONSUMABLE",
    localizations: [{ locale: "en-US", name: "100 Coins", description: "A pile of coins" }],
    play: { defaultPrice: { priceMicros: "1990000", currency: "USD" } },
    ...overrides,
  };
}

describe("toPlayProduct", () => {
  it("maps shared fields + the play override into an active managed product", () => {
    expect(toPlayProduct(product())).toEqual({
      sku: "com.acme.coins.100",
      status: "active",
      purchaseType: "managedUser",
      defaultLanguage: "en-US",
      defaultPrice: { priceMicros: "1990000", currency: "USD" },
      listings: { "en-US": { title: "100 Coins", description: "A pile of coins" } },
    });
  });

  it("prefers play.sku over the shared productId and carries per-region prices", () => {
    const mapped = toPlayProduct(
      product({
        play: {
          sku: "coins_100",
          defaultPrice: { priceMicros: "1990000", currency: "USD" },
          prices: { GB: { priceMicros: "1790000", currency: "GBP" } },
        },
      }),
    );
    expect(mapped.sku).toBe("coins_100");
    expect(mapped.prices).toEqual({ GB: { priceMicros: "1790000", currency: "GBP" } });
  });

  it("throws when the product has no localization to derive a default language from", () => {
    expect(() => toPlayProduct(product({ localizations: [] }))).toThrow(/at least one localization/);
  });
});

describe("productInSync", () => {
  const desired = toPlayProduct(product());

  it("ignores Play's auto-fanned regional prices not named in config", () => {
    const live: InAppProductResource = {
      ...desired,
      prices: { US: { priceMicros: "1990000", currency: "USD" }, JP: { priceMicros: "300000000", currency: "JPY" } },
    };
    expect(productInSync(live, desired)).toBe(true);
  });

  it("detects a drifted listing title and a changed default price", () => {
    expect(productInSync({ ...desired, listings: { "en-US": { title: "Old name" } } }, desired)).toBe(false);
    expect(productInSync({ ...desired, defaultPrice: { priceMicros: "2990000", currency: "USD" } }, desired)).toBe(
      false,
    );
  });
});

describe("reconcilePlayProducts", () => {
  it("throws when the Play app record is unreachable", async () => {
    const { api } = makeApi([], { reachable: false });
    await expect(
      reconcilePlayProducts(api, { packageName: "com.acme.app", products: [product()], dryRun: true }),
    ).rejects.toThrow(/No reachable Play app/);
  });

  it("creates a product Play doesn't have yet", async () => {
    const { api, calls } = makeApi([]);
    const result = await reconcilePlayProducts(api, {
      packageName: "com.acme.app",
      products: [product()],
      dryRun: false,
    });
    expect(result.actions.map((a) => `${a.status} ${a.description}`)).toEqual([
      "applied create Play product com.acme.coins.100",
    ]);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0]?.defaultPrice).toEqual({ priceMicros: "1990000", currency: "USD" });
  });

  it("emits no action when the live product already matches (subset diff vs Play's extra regions)", async () => {
    const live: InAppProductResource = {
      ...toPlayProduct(product()),
      prices: { US: { priceMicros: "1990000", currency: "USD" }, FR: { priceMicros: "1990000", currency: "EUR" } },
    };
    const { api, calls } = makeApi([live]);
    const result = await reconcilePlayProducts(api, {
      packageName: "com.acme.app",
      products: [product()],
      dryRun: false,
    });
    expect(result.actions).toEqual([]);
    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  });

  it("updates a drifted product, merging managed fields onto the live one so Play's regions survive", async () => {
    const live: InAppProductResource = {
      sku: "com.acme.coins.100",
      status: "active",
      purchaseType: "managedUser",
      defaultLanguage: "en-US",
      defaultPrice: { priceMicros: "990000", currency: "USD" },
      prices: { JP: { priceMicros: "150000000", currency: "JPY" } },
      listings: { "en-US": { title: "Old name" } },
    };
    const { api, calls } = makeApi([live]);
    const result = await reconcilePlayProducts(api, {
      packageName: "com.acme.app",
      products: [product()],
      dryRun: false,
    });
    expect(result.actions.map((a) => `${a.status} ${a.description}`)).toEqual([
      "applied update Play product com.acme.coins.100",
    ]);
    const sent = calls.updates[0]!;
    expect(sent.defaultPrice).toEqual({ priceMicros: "1990000", currency: "USD" });
    expect(sent.listings?.["en-US"]?.title).toBe("100 Coins");
    expect(sent.prices?.["JP"]).toEqual({ priceMicros: "150000000", currency: "JPY" });
  });

  it("leaves a Play product whose SKU isn't in config untouched (additive)", async () => {
    const orphan: InAppProductResource = { sku: "com.acme.legacy", status: "active", purchaseType: "managedUser" };
    const { api, calls } = makeApi([orphan]);
    const result = await reconcilePlayProducts(api, {
      packageName: "com.acme.app",
      products: [product()],
      dryRun: false,
    });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.description).toBe("create Play product com.acme.coins.100");
    expect(calls.updates).toHaveLength(0);
  });

  it("plans without writing on a dry run", async () => {
    const { api, calls } = makeApi([]);
    const result = await reconcilePlayProducts(api, {
      packageName: "com.acme.app",
      products: [product()],
      dryRun: true,
    });
    expect(result.actions[0]?.status).toBe("planned");
    expect(calls.inserts).toHaveLength(0);
  });

  it("isolates a per-product failure so the rest of the run continues", async () => {
    const { api, calls } = makeApi([], { failSku: "com.acme.coins.100" });
    const result = await reconcilePlayProducts(api, {
      packageName: "com.acme.app",
      products: [
        product(),
        product({
          productId: "com.acme.coins.500",
          play: { defaultPrice: { priceMicros: "4990000", currency: "USD" } },
        }),
      ],
      dryRun: false,
    });
    const summary = summarizePlayProducts(result.actions);
    expect(summary).toEqual({ applied: 1, failed: 1, skipped: 0 });
    expect(result.actions.find((a) => a.status === "failed")?.error).toMatch(/valid tier/);
    expect(calls.inserts.map((p) => p.sku)).toEqual(["com.acme.coins.500"]);
  });
});
