import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { agreementsProbe } from "./agreements.js";
import { appRecordProbe } from "./appRecord.js";
import { subscriptionGroupProbe } from "./subscriptionGroup.js";
import { bundleIdProbe } from "./bundleId.js";
import { distributionCertProbe } from "./distributionCert.js";
import { exportComplianceProbe } from "./exportCompliance.js";
import { iapProductsProbe } from "./iapProducts.js";
import { iapCodeReferenceProbe } from "./iapCodeReference.js";
import { storeKitConfigProbe } from "./storeKitConfig.js";
import { subscriptionsProbe } from "./subscriptions.js";
import { playAppProbe } from "./playApp.js";
import { playFirstUploadProbe } from "./playFirstUpload.js";
import { playInternalTrackProbe } from "./playInternalTrack.js";
import type { AscReadinessApi, PlayReadinessApi, ProbeResult, ReadinessContext } from "../types.js";
import type { AppDescriptor, LaunchConfig } from "../../types.js";

/** A minimal valid config; pass `products` to exercise the subscription-group scope. */
function config(products?: LaunchConfig["products"]): LaunchConfig {
  return {
    profiles: {},
    credentials: "local",
    storage: "local",
    buildEngine: "fastlane",
    submit: "app-store-connect",
    ...(products ? { products } : {}),
  };
}

/** A discovered app; override `bundleId`/`packageName` to scope it to a store. */
function app(over: Partial<AppDescriptor> = {}): AppDescriptor {
  return { name: "app", dir: "/a", configPath: "/a/app.json", ...over };
}

/** A read-only ASC fake — only the methods readiness reads exist, so a write is impossible by construction. */
function ascApi(over: Partial<AscReadinessApi> = {}): AscReadinessApi {
  return {
    getAppId: vi.fn(async () => "app-1"),
    checkRequiredAgreements: vi.fn(async () => true),
    listSubscriptionGroups: vi.fn(async () => [{ id: "g1" }]),
    findBundleId: vi.fn(async () => ({ id: "b1" })),
    listDistributionCertificates: vi.fn(async () => [{ id: "c1", expirationDate: "2099-01-01T00:00:00Z" }]),
    listInAppPurchases: vi.fn(async () => []),
    listSubscriptions: vi.fn(async () => []),
    ...over,
  };
}

/** A read-only Play fake, mirroring {@link ascApi}. */
function playApi(over: Partial<PlayReadinessApi> = {}): PlayReadinessApi {
  return {
    assertAppExists: vi.fn(async () => undefined),
    getLatestVersionCode: vi.fn(async () => 42),
    listTracks: vi.fn(async () => [{ track: "internal" }]),
    ...over,
  };
}

/** Build a context with explicit clients (or `null` to simulate unconfigured credentials). */
function ctx(args: {
  apps: AppDescriptor[];
  asc?: AscReadinessApi | null;
  play?: PlayReadinessApi | null;
  products?: LaunchConfig["products"];
}): ReadinessContext {
  return {
    config: config(args.products),
    apps: args.apps,
    resolveAscApi: async () => args.asc ?? null,
    resolvePlayApi: async () => args.play ?? null,
  };
}

/** The per-app status + identifier of a `checked` result (empty for any other state). */
function findings(result: ProbeResult): { status: string; identifier: string }[] {
  return result.state === "checked" ? result.apps.map(({ status, identifier }) => ({ status, identifier })) : [];
}

describe("appRecordProbe", () => {
  it("omits itself when no app has a bundle id", async () => {
    const result = await appRecordProbe.check(ctx({ apps: [app({ packageName: "com.x" })] }));
    expect(result.state).toBe("omitted");
  });

  it("skips when no Apple account is configured", async () => {
    const result = await appRecordProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: null }));
    expect(result.state).toBe("skipped");
  });

  it("passes when the app record exists, blocks when it doesn't", async () => {
    const ok = await appRecordProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const api = ascApi({ getAppId: vi.fn(async () => null) });
    const missing = await appRecordProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: api }));
    expect(findings(missing)).toEqual([{ status: "blocker", identifier: "com.x" }]);
    expect(api.getAppId).toHaveBeenCalledWith("com.x");
  });
});

describe("agreementsProbe", () => {
  it("omits without an iOS app and skips without an Apple account", async () => {
    expect((await agreementsProbe.check(ctx({ apps: [app({ packageName: "com.x" })] }))).state).toBe("omitted");
    expect((await agreementsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: null }))).state).toBe("skipped");
  });

  it("passes when agreements are in effect, blocks when one is missing/expired (one account-wide finding)", async () => {
    const ok = await agreementsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "account-wide" }]);

    const missing = ascApi({ checkRequiredAgreements: vi.fn(async () => false) });
    const blocked = await agreementsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: missing }));
    expect(findings(blocked)).toEqual([{ status: "blocker", identifier: "account-wide" }]);
  });

  it("propagates an unexpected read failure so the orchestrator records it as errored", async () => {
    const broken = ascApi({
      checkRequiredAgreements: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    await expect(agreementsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: broken }))).rejects.toThrow(
      "network down",
    );
  });
});

describe("subscriptionGroupProbe", () => {
  const withSubs = { "com.x": { subscriptionGroups: [{ referenceName: "g", localizations: [], subscriptions: [] }] } };

  it("omits itself when no app declares subscriptions", async () => {
    const result = await subscriptionGroupProbe.check(ctx({ apps: [app({ bundleId: "com.x" })] }));
    expect(result.state).toBe("omitted");
  });

  it("blocks when the declared group is absent and passes when present", async () => {
    const empty = ascApi({ listSubscriptionGroups: vi.fn(async () => []) });
    const missing = await subscriptionGroupProbe.check(
      ctx({ apps: [app({ bundleId: "com.x" })], asc: empty, products: withSubs }),
    );
    expect(findings(missing)).toEqual([{ status: "blocker", identifier: "com.x" }]);

    const ok = await subscriptionGroupProbe.check(
      ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi(), products: withSubs }),
    );
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);
  });

  it("warns instead of blocking when the app record isn't there to check against", async () => {
    const api = ascApi({ getAppId: vi.fn(async () => null) });
    const result = await subscriptionGroupProbe.check(
      ctx({ apps: [app({ bundleId: "com.x" })], asc: api, products: withSubs }),
    );
    expect(findings(result)).toEqual([{ status: "warn", identifier: "com.x" }]);
  });
});

describe("iapProductsProbe", () => {
  const withIap: LaunchConfig["products"] = {
    "com.x": {
      inAppPurchases: [{ productId: "com.x.coins", referenceName: "Coins", type: "CONSUMABLE", localizations: [] }],
    },
  };

  it("omits when no app declares one-time IAPs, skips without an Apple account", async () => {
    expect((await iapProductsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })] }))).state).toBe("omitted");
    expect(
      (await iapProductsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: null, products: withIap }))).state,
    ).toBe("skipped");
  });

  it("passes a present product, blocks a missing one and a MISSING_METADATA one", async () => {
    const present = ascApi({
      listInAppPurchases: vi.fn(async () => [{ productId: "com.x.coins", state: "READY_TO_SUBMIT" }]),
    });
    expect(
      findings(
        await iapProductsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: present, products: withIap })),
      ),
    ).toEqual([{ status: "ok", identifier: "com.x.coins" }]);

    const absent = ascApi({ listInAppPurchases: vi.fn(async () => []) });
    expect(
      findings(
        await iapProductsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: absent, products: withIap })),
      ),
    ).toEqual([{ status: "blocker", identifier: "com.x.coins" }]);

    const incomplete = ascApi({
      listInAppPurchases: vi.fn(async () => [{ productId: "com.x.coins", state: "MISSING_METADATA" }]),
    });
    expect(
      findings(
        await iapProductsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: incomplete, products: withIap })),
      ),
    ).toEqual([{ status: "blocker", identifier: "com.x.coins" }]);
  });

  it("warns instead of blocking when the app record isn't there to check against", async () => {
    const noApp = ascApi({ getAppId: vi.fn(async () => null) });
    const result = await iapProductsProbe.check(
      ctx({ apps: [app({ bundleId: "com.x" })], asc: noApp, products: withIap }),
    );
    expect(findings(result)).toEqual([{ status: "warn", identifier: "com.x" }]);
  });
});

describe("subscriptionsProbe", () => {
  const withSub: LaunchConfig["products"] = {
    "com.x": {
      subscriptionGroups: [
        {
          referenceName: "g",
          localizations: [],
          subscriptions: [
            { productId: "com.x.pro", referenceName: "Pro", subscriptionPeriod: "ONE_MONTH", localizations: [] },
          ],
        },
      ],
    },
  };

  it("omits when no app declares subscriptions", async () => {
    expect((await subscriptionsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })] }))).state).toBe("omitted");
  });

  it("passes a present subscription, blocks a missing one (across the app's groups)", async () => {
    const present = ascApi({
      listSubscriptions: vi.fn(async () => [{ productId: "com.x.pro", state: "READY_TO_SUBMIT" }]),
    });
    expect(
      findings(
        await subscriptionsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: present, products: withSub })),
      ),
    ).toEqual([{ status: "ok", identifier: "com.x.pro" }]);

    const absent = ascApi({ listSubscriptions: vi.fn(async () => []) });
    expect(
      findings(
        await subscriptionsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: absent, products: withSub })),
      ),
    ).toEqual([{ status: "blocker", identifier: "com.x.pro" }]);
  });
});

describe("bundleIdProbe", () => {
  it("omits without an iOS app and skips without an Apple account", async () => {
    expect((await bundleIdProbe.check(ctx({ apps: [app({ packageName: "com.x" })] }))).state).toBe("omitted");
    expect((await bundleIdProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: null }))).state).toBe("skipped");
  });

  it("passes when the Bundle ID is registered, blocks when it isn't", async () => {
    const ok = await bundleIdProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const api = ascApi({ findBundleId: vi.fn(async () => null) });
    const missing = await bundleIdProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: api }));
    expect(findings(missing)).toEqual([{ status: "blocker", identifier: "com.x" }]);
    expect(api.findBundleId).toHaveBeenCalledWith("com.x");
  });
});

describe("distributionCertProbe", () => {
  it("omits without an iOS app and skips without an Apple account", async () => {
    expect((await distributionCertProbe.check(ctx({ apps: [app({ packageName: "com.x" })] }))).state).toBe("omitted");
    expect((await distributionCertProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: null }))).state).toBe(
      "skipped",
    );
  });

  it("passes on an unexpired cert, blocks when none exist or all are expired (one team-wide finding)", async () => {
    const ok = await distributionCertProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "team-wide" }]);

    const none = ascApi({ listDistributionCertificates: vi.fn(async () => []) });
    const blockedNone = await distributionCertProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: none }));
    expect(findings(blockedNone)).toEqual([{ status: "blocker", identifier: "team-wide" }]);

    const expired = ascApi({
      listDistributionCertificates: vi.fn(async () => [{ id: "c1", expirationDate: "2000-01-01T00:00:00Z" }]),
    });
    const blockedExpired = await distributionCertProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: expired }));
    expect(findings(blockedExpired)).toEqual([{ status: "blocker", identifier: "team-wide" }]);
  });

  it("treats a certificate with no recorded expiry as usable", async () => {
    const undated = ascApi({ listDistributionCertificates: vi.fn(async () => [{ id: "c1" }]) });
    const ok = await distributionCertProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: undated }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "team-wide" }]);
  });
});

describe("exportComplianceProbe", () => {
  it("omits when no app declares a bundle id", async () => {
    expect((await exportComplianceProbe.check(ctx({ apps: [app({ packageName: "com.x" })] }))).state).toBe("omitted");
  });

  it("passes when declared (even `false`), warns when undeclared — needs no credentials", async () => {
    const declared = await exportComplianceProbe.check(
      ctx({ apps: [app({ bundleId: "com.x", usesNonExemptEncryption: false })], asc: null }),
    );
    expect(findings(declared)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const undeclared = await exportComplianceProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: null }));
    expect(findings(undeclared)).toEqual([{ status: "warn", identifier: "com.x" }]);
  });
});

describe("playAppProbe", () => {
  it("passes when the app is reachable, blocks when Play rejects it", async () => {
    const ok = await playAppProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: playApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const denied = playApi({
      assertAppExists: vi.fn(async () => {
        throw new Error("app not found");
      }),
    });
    const blocked = await playAppProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: denied }));
    expect(findings(blocked)).toEqual([{ status: "blocker", identifier: "com.x" }]);
  });
});

describe("playFirstUploadProbe", () => {
  it("passes with an uploaded build, blocks at versionCode 0, warns on a read failure", async () => {
    const ok = await playFirstUploadProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: playApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const none = playApi({ getLatestVersionCode: vi.fn(async () => 0) });
    const blocked = await playFirstUploadProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: none }));
    expect(findings(blocked)).toEqual([{ status: "blocker", identifier: "com.x" }]);

    const broken = playApi({
      getLatestVersionCode: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    const warned = await playFirstUploadProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: broken }));
    expect(findings(warned)).toEqual([{ status: "warn", identifier: "com.x" }]);
  });
});

describe("playInternalTrackProbe", () => {
  it("passes when an internal track exists, warns when it doesn't", async () => {
    const ok = await playInternalTrackProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: playApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const noTrack = playApi({ listTracks: vi.fn(async () => [{ track: "production" }]) });
    const warned = await playInternalTrackProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: noTrack }));
    expect(findings(warned)).toEqual([{ status: "warn", identifier: "com.x" }]);
  });
});

/** The first finding's `detail` string from a `checked` result (empty otherwise) — for asserting copy. */
function firstDetail(result: ProbeResult): string {
  return result.state === "checked" ? (result.apps[0]?.detail ?? "") : "";
}

/** A products catalog declaring a single one-time IAP under `com.x`. */
const oneIap: LaunchConfig["products"] = {
  "com.x": {
    inAppPurchases: [{ productId: "com.x.coins", referenceName: "Coins", type: "CONSUMABLE", localizations: [] }],
  },
};

describe("iapCodeReferenceProbe", () => {
  it("omits when the app declares no products (no scan)", async () => {
    const result = await iapCodeReferenceProbe.check(ctx({ apps: [app({ bundleId: "com.x" })] }));
    expect(result.state).toBe("omitted");
  });

  it("passes when every declared id appears in source, warns (naming it) when one doesn't", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iap-scan-"));
    try {
      writeFileSync(join(dir, "purchases.ts"), `await buy("com.x.coins");\n`);
      const ok = await iapCodeReferenceProbe.check(ctx({ apps: [app({ bundleId: "com.x", dir })], products: oneIap }));
      expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);

      const twoIds: LaunchConfig["products"] = {
        "com.x": {
          inAppPurchases: [
            { productId: "com.x.coins", referenceName: "Coins", type: "CONSUMABLE", localizations: [] },
            { productId: "com.x.ghost", referenceName: "Ghost", type: "CONSUMABLE", localizations: [] },
          ],
        },
      };
      const warned = await iapCodeReferenceProbe.check(
        ctx({ apps: [app({ bundleId: "com.x", dir })], products: twoIds }),
      );
      expect(findings(warned)).toEqual([{ status: "warn", identifier: "com.x" }]);
      expect(firstDetail(warned)).toContain("com.x.ghost");
      expect(firstDetail(warned)).not.toContain("com.x.coins");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not scan node_modules — a reference there does not count as a real one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iap-scan-"));
    try {
      mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(dir, "node_modules", "pkg", "index.js"), `const id = "com.x.coins";\n`);
      const result = await iapCodeReferenceProbe.check(
        ctx({ apps: [app({ bundleId: "com.x", dir })], products: oneIap }),
      );
      expect(findings(result)).toEqual([{ status: "warn", identifier: "com.x" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("storeKitConfigProbe", () => {
  it("omits when the app declares no products", async () => {
    const result = await storeKitConfigProbe.check(ctx({ apps: [app({ bundleId: "com.x" })] }));
    expect(result.state).toBe("omitted");
  });

  it("warns when no .storekit file exists, passes once one is added", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storekit-"));
    try {
      const warned = await storeKitConfigProbe.check(
        ctx({ apps: [app({ bundleId: "com.x", dir })], products: oneIap }),
      );
      expect(findings(warned)).toEqual([{ status: "warn", identifier: "com.x" }]);

      writeFileSync(join(dir, "Products.storekit"), "{}");
      const ok = await storeKitConfigProbe.check(ctx({ apps: [app({ bundleId: "com.x", dir })], products: oneIap }));
      expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);
      expect(firstDetail(ok)).toContain("Products.storekit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
