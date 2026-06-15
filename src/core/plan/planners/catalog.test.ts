import { describe, expect, it, vi } from "vitest";
import { catalogPlanner } from "./catalog.js";
import { makeAscApiFake } from "./ascApiFake.testkit.js";
import type { AscCatalogApi } from "../../ascSync.js";
import type { PlanContext } from "../types.js";
import type { AppDescriptor, AppProducts, LaunchConfig } from "../../types.js";

/** A fully-stubbed {@link AscCatalogApi}: reads default to "nothing exists yet", writes resolve to a created resource. */
function makeApi(overrides: Partial<AscCatalogApi> = {}): AscCatalogApi {
  const base: AscCatalogApi = {
    getAppId: vi.fn().mockResolvedValue("app1"),
    findBundleId: vi.fn().mockResolvedValue({ id: "bundle1", identifier: "com.acme.alpha" }),
    listBundleIdCapabilities: vi.fn().mockResolvedValue([]),
    enableCapability: vi
      .fn()
      .mockImplementation((_b: string, capabilityType: string) => Promise.resolve({ id: "cap-new", capabilityType })),
    disableCapability: vi.fn().mockResolvedValue(undefined),
    listInAppPurchases: vi.fn().mockResolvedValue([]),
    createInAppPurchase: vi
      .fn()
      .mockImplementation((_a: string, input: { productId: string; name: string; inAppPurchaseType: string }) =>
        Promise.resolve({
          id: "iap-new",
          productId: input.productId,
          name: input.name,
          inAppPurchaseType: input.inAppPurchaseType,
        }),
      ),
    listInAppPurchaseLocalizations: vi.fn().mockResolvedValue([]),
    createInAppPurchaseLocalization: vi
      .fn()
      .mockImplementation((_i: string, input: { locale: string; name: string }) =>
        Promise.resolve({ id: "iloc", locale: input.locale, name: input.name }),
      ),
    inAppPurchaseHasPrice: vi.fn().mockResolvedValue(false),
    findInAppPurchasePricePoint: vi
      .fn()
      .mockImplementation((_i: string, territory: string, price: number) =>
        Promise.resolve({ id: "ipp", customerPrice: String(price), territory }),
      ),
    createInAppPurchasePriceSchedule: vi.fn().mockResolvedValue(undefined),
    listSubscriptionGroups: vi.fn().mockResolvedValue([]),
    createSubscriptionGroup: vi
      .fn()
      .mockImplementation((_a: string, referenceName: string) => Promise.resolve({ id: "grp-new", referenceName })),
    listSubscriptionGroupLocalizations: vi.fn().mockResolvedValue([]),
    createSubscriptionGroupLocalization: vi.fn().mockResolvedValue({ id: "gloc" }),
    listSubscriptions: vi.fn().mockResolvedValue([]),
    createSubscription: vi
      .fn()
      .mockImplementation((_g: string, input: { productId: string; name: string }) =>
        Promise.resolve({ id: "sub-new", productId: input.productId, name: input.name }),
      ),
    listSubscriptionLocalizations: vi.fn().mockResolvedValue([]),
    createSubscriptionLocalization: vi.fn().mockResolvedValue({ id: "sloc" }),
    subscriptionHasPrice: vi.fn().mockResolvedValue(false),
    findSubscriptionPricePoint: vi.fn().mockResolvedValue({ id: "spp" }),
    createSubscriptionPrice: vi.fn().mockResolvedValue(undefined),
    getEditableAppInfoId: vi.fn().mockResolvedValue("appinfo1"),
    listAppInfoLocalizations: vi.fn().mockResolvedValue([]),
    createAppInfoLocalization: vi.fn().mockResolvedValue(undefined),
    updateAppInfoLocalization: vi.fn().mockResolvedValue(undefined),
    getEditableVersionId: vi.fn().mockResolvedValue("version1"),
    listVersionLocalizations: vi.fn().mockResolvedValue([]),
    createVersionLocalization: vi.fn().mockResolvedValue(undefined),
    updateVersionLocalization: vi.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides };
}

const PRODUCTS: AppProducts = {
  inAppPurchases: [
    {
      productId: "com.acme.coins",
      referenceName: "Coins",
      type: "CONSUMABLE",
      localizations: [{ locale: "en-US", name: "Coins" }],
      price: { customerPrice: 4.99 },
    },
  ],
};

const ALPHA: AppDescriptor = {
  name: "alpha",
  dir: "/no/such/dir/alpha",
  configPath: "/no/such/dir/alpha/app.json",
  bundleId: "com.acme.alpha",
};

function makeCtx(api: AscCatalogApi | null, products: Record<string, AppProducts> = {}): PlanContext {
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
    apps: [ALPHA],
    // Widen the catalog-only fake to the full surface API the context now exposes; the catalog methods
    // (which these tests assert on) win over the factory's inert defaults via the trailing spread.
    resolveAscApi: () => Promise.resolve(api === null ? null : { ...makeAscApiFake(), ...api }),
    resolvePlayApi: () => Promise.resolve(null),
  };
}

describe("catalogPlanner", () => {
  it("omits itself when no app declares a catalog", async () => {
    const plan = await catalogPlanner.plan(makeCtx(makeApi(), {}));
    expect(plan.state).toBe("omitted");
  });

  it("skips with an actionable hint when no Apple account is active", async () => {
    const plan = await catalogPlanner.plan(makeCtx(null, { "com.acme.alpha": PRODUCTS }));
    expect(plan.state).toBe("skipped");
    if (plan.state !== "skipped") return;
    expect(plan.reason).toMatch(/Apple account/);
    expect(plan.hint).toMatch(/creds/);
  });

  it("reports the per-app diff a fresh catalog would create", async () => {
    const plan = await catalogPlanner.plan(makeCtx(makeApi(), { "com.acme.alpha": PRODUCTS }));
    expect(plan.state).toBe("planned");
    if (plan.state !== "planned" || plan.scope !== "app") return;
    expect(plan.apps).toHaveLength(1);
    expect(plan.apps[0]?.identifier).toBe("com.acme.alpha");
    expect(plan.apps[0]?.actions.some((a) => a.description.includes("create in-app purchase com.acme.coins"))).toBe(
      true,
    );
  });

  it("captures a missing app record as a per-app error, not a thrown plan", async () => {
    const api = makeApi({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await catalogPlanner.plan(makeCtx(api, { "com.acme.alpha": PRODUCTS }));
    expect(plan.state).toBe("planned");
    if (plan.state !== "planned" || plan.scope !== "app") return;
    expect(plan.apps[0]?.error).toMatch(/No App Store Connect app record/);
    expect(plan.apps[0]?.actions).toHaveLength(0);
  });

  it("is strictly read-only: never invokes a write endpoint", async () => {
    const api = makeApi();
    await catalogPlanner.plan(makeCtx(api, { "com.acme.alpha": PRODUCTS }));
    expect(api.getAppId).toHaveBeenCalled();
    expect(api.listInAppPurchases).toHaveBeenCalled();
    expect(api.enableCapability).toHaveBeenCalledTimes(0);
    expect(api.createInAppPurchase).toHaveBeenCalledTimes(0);
    expect(api.createInAppPurchaseLocalization).toHaveBeenCalledTimes(0);
    expect(api.createInAppPurchasePriceSchedule).toHaveBeenCalledTimes(0);
    expect(api.createSubscription).toHaveBeenCalledTimes(0);
    expect(api.createSubscriptionGroup).toHaveBeenCalledTimes(0);
  });
});
