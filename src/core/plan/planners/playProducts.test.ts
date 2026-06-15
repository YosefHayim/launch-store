import { describe, expect, it, vi } from "vitest";
import { playProductsPlanner } from "./playProducts.js";
import type { PlanContext, PlayCatalogApi } from "../types.js";
import type { AppDescriptor, AppProducts, InAppPurchaseConfig, LaunchConfig } from "../../types.js";

/** A fully-stubbed {@link PlayCatalogApi}: reads default to "nothing exists yet", writes resolve to void. */
function makePlayApi(overrides: Partial<PlayCatalogApi> = {}): PlayCatalogApi {
  const base: PlayCatalogApi = {
    assertAppExists: vi.fn().mockResolvedValue(undefined),
    listInAppProducts: vi.fn().mockResolvedValue([]),
    insertInAppProduct: vi.fn().mockResolvedValue(undefined),
    updateInAppProduct: vi.fn().mockResolvedValue(undefined),
    listSubscriptions: vi.fn().mockResolvedValue([]),
    createSubscription: vi.fn().mockResolvedValue(undefined),
    patchSubscription: vi.fn().mockResolvedValue(undefined),
    activateBasePlan: vi.fn().mockResolvedValue(undefined),
    listSubscriptionOffers: vi.fn().mockResolvedValue([]),
    createSubscriptionOffer: vi.fn().mockResolvedValue(undefined),
    activateSubscriptionOffer: vi.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides };
}

/** A Play-published in-app product (carries a `play` override); SKU defaults to the shared product id. */
const PLAY_IAP: InAppPurchaseConfig = {
  productId: "com.acme.coins",
  referenceName: "Coins",
  type: "CONSUMABLE",
  localizations: [{ locale: "en-US", name: "Coins" }],
  play: {},
};

/** An Apple-only in-app product (no `play` override) — must never reach Play. */
const APPLE_ONLY_IAP: InAppPurchaseConfig = {
  productId: "com.acme.gems",
  referenceName: "Gems",
  type: "CONSUMABLE",
  localizations: [{ locale: "en-US", name: "Gems" }],
};

const ALPHA: AppDescriptor = {
  name: "alpha",
  dir: "/no/such/dir/alpha",
  configPath: "/no/such/dir/alpha/app.json",
  bundleId: "com.acme.alpha",
  packageName: "com.acme.alpha",
};

function makeCtx(
  api: PlayCatalogApi | null,
  products: Record<string, AppProducts> = {},
  apps: AppDescriptor[] = [ALPHA],
): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: "local",
    storage: "local",
    buildEngine: "fastlane",
    submit: "app-store-connect",
    ...(Object.keys(products).length > 0 ? { products } : {}),
  };
  return {
    config,
    apps,
    resolveAscApi: () => Promise.resolve(null),
    resolvePlayApi: () => Promise.resolve(api),
  };
}

describe("playProductsPlanner", () => {
  it("omits itself when no app declares a Play-overridden product", async () => {
    const plan = await playProductsPlanner.plan(
      makeCtx(makePlayApi(), { "com.acme.alpha": { inAppPurchases: [APPLE_ONLY_IAP] } }),
    );
    expect(plan.state).toBe("omitted");
  });

  it("omits an app that has products but no Android package name", async () => {
    const noPackage: AppDescriptor = {
      name: "alpha",
      dir: "/no/such/dir/alpha",
      configPath: "/no/such/dir/alpha/app.json",
      bundleId: "com.acme.alpha",
    };
    const plan = await playProductsPlanner.plan(
      makeCtx(makePlayApi(), { "com.acme.alpha": { inAppPurchases: [PLAY_IAP] } }, [noPackage]),
    );
    expect(plan.state).toBe("omitted");
  });

  it("skips with an actionable hint when no Play service account is configured", async () => {
    const plan = await playProductsPlanner.plan(makeCtx(null, { "com.acme.alpha": { inAppPurchases: [PLAY_IAP] } }));
    expect(plan.state).toBe("skipped");
    if (plan.state !== "skipped") return;
    expect(plan.reason).toMatch(/Play service account/);
    expect(plan.hint).toMatch(/android/);
  });

  it("reports the per-app diff a fresh Play product would create", async () => {
    const plan = await playProductsPlanner.plan(
      makeCtx(makePlayApi(), { "com.acme.alpha": { inAppPurchases: [PLAY_IAP] } }),
    );
    expect(plan.state).toBe("planned");
    if (plan.state !== "planned") return;
    expect(plan.apps).toHaveLength(1);
    expect(plan.apps[0]?.identifier).toBe("com.acme.alpha");
    expect(plan.apps[0]?.actions.some((a) => a.description === "create Play product com.acme.coins")).toBe(true);
  });

  it("captures an unreachable app as a per-app error, not a thrown plan", async () => {
    const api = makePlayApi({ assertAppExists: vi.fn().mockRejectedValue(new Error("app not found on Play")) });
    const plan = await playProductsPlanner.plan(makeCtx(api, { "com.acme.alpha": { inAppPurchases: [PLAY_IAP] } }));
    expect(plan.state).toBe("planned");
    if (plan.state !== "planned") return;
    expect(plan.apps[0]?.error).toMatch(/app not found on Play/);
    expect(plan.apps[0]?.actions).toHaveLength(0);
  });

  it("is strictly read-only: never invokes a Play write endpoint", async () => {
    const api = makePlayApi();
    await playProductsPlanner.plan(makeCtx(api, { "com.acme.alpha": { inAppPurchases: [PLAY_IAP] } }));
    expect(api.listInAppProducts).toHaveBeenCalled();
    expect(api.insertInAppProduct).toHaveBeenCalledTimes(0);
    expect(api.updateInAppProduct).toHaveBeenCalledTimes(0);
  });
});
