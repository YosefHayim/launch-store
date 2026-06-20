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
import { iapPricingProbe } from "./iapPricing.js";
import { subscriptionOffersProbe } from "./subscriptionOffers.js";
import { sandboxTestersProbe } from "./sandboxTesters.js";
import { playAppProbe } from "./playApp.js";
import { playFirstUploadProbe } from "./playFirstUpload.js";
import { playInternalTrackProbe } from "./playInternalTrack.js";
import { ageRatingProbe } from "./ageRating.js";
import { listingUrlsProbe } from "./listingUrls.js";
import { accountDeletionProbe } from "./accountDeletion.js";
import { demoAccountProbe } from "./demoAccount.js";
import { profileEntitlementsProbe } from "./profileEntitlements.js";
import { screenshotsProbe } from "./screenshots.js";
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
    listSandboxTesters: vi.fn(async () => [{ id: "t1" }]),
    findInAppPurchasePricePoint: vi.fn(async () => ({ id: "ipp" })),
    findSubscriptionPricePoint: vi.fn(async () => ({ id: "spp" })),
    listSubscriptionOfferCodes: vi.fn(async () => []),
    getEditableAppInfoId: vi.fn(async () => "appinfo-1"),
    getAgeRatingDeclaration: vi.fn(async () => ({ attributes: { violenceCartoonOrFantasy: false } })),
    listAccountDeletionUrls: vi.fn(async () => [{ locale: "en-US", url: "https://x.example/delete" }]),
    findEditableAppStoreVersion: vi.fn(async () => ({ id: "ver-1" })),
    getAppStoreReviewDetail: vi.fn(async () => ({ attributes: { demoAccountRequired: false } })),
    listBundleIdCapabilities: vi.fn(async () => [{ capabilityType: "PUSH_NOTIFICATIONS" }]),
    listAppStoreVersionLocalizations: vi.fn(async () => [{ id: "loc-1", locale: "en-US" }]),
    listScreenshotSets: vi.fn(async () => [{ id: "set-1", screenshotDisplayType: "APP_IPHONE_67" }]),
    listScreenshots: vi.fn(async () => [{ id: "shot-1" }]),
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

/** An app selling one priced IAP — shared by the pricing and sandbox-tester probes. */
const withPricedIap: LaunchConfig["products"] = {
  "com.x": {
    inAppPurchases: [
      {
        productId: "com.x.coins",
        referenceName: "Coins",
        type: "CONSUMABLE",
        localizations: [],
        price: { customerPrice: 9.99 },
      },
    ],
  },
};

/** An app selling a subscription that declares one offer-code campaign — shared by the offers probe. */
const withOffers: LaunchConfig["products"] = {
  "com.x": {
    subscriptionGroups: [
      {
        referenceName: "g",
        localizations: [],
        subscriptions: [
          {
            productId: "com.x.pro",
            referenceName: "Pro",
            subscriptionPeriod: "ONE_MONTH",
            localizations: [],
            offerCodes: [
              {
                name: "LAUNCH50",
                duration: "ONE_MONTH",
                offerMode: "PAY_AS_YOU_GO",
                numberOfPeriods: 1,
                customerEligibilities: ["NEW"],
                offerEligibility: "REPLACE_INTRO_OFFERS",
                prices: [{ customerPrice: 4.99 }],
              },
            ],
          },
        ],
      },
    ],
  },
};

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

describe("iapPricingProbe", () => {
  it("omits when no app declares a priced product, skips without an Apple account", async () => {
    expect((await iapPricingProbe.check(ctx({ apps: [app({ bundleId: "com.x" })] }))).state).toBe("omitted");
    expect(
      (await iapPricingProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: null, products: withPricedIap })))
        .state,
    ).toBe("skipped");
  });

  it("passes a valid price point, blocks an invalid one", async () => {
    const live = [{ id: "iap1", productId: "com.x.coins", state: "READY_TO_SUBMIT" }];
    const valid = ascApi({ listInAppPurchases: vi.fn(async () => live) });
    expect(
      findings(
        await iapPricingProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: valid, products: withPricedIap })),
      ),
    ).toEqual([{ status: "ok", identifier: "com.x.coins" }]);

    const invalid = ascApi({
      listInAppPurchases: vi.fn(async () => live),
      findInAppPurchasePricePoint: vi.fn(async () => null),
    });
    expect(
      findings(
        await iapPricingProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: invalid, products: withPricedIap })),
      ),
    ).toEqual([{ status: "blocker", identifier: "com.x.coins" }]);
  });

  it("warns when the product isn't on App Store Connect yet, and when there's no app record", async () => {
    const notLive = await iapPricingProbe.check(
      ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi(), products: withPricedIap }),
    );
    expect(findings(notLive)).toEqual([{ status: "warn", identifier: "com.x.coins" }]);

    const noApp = ascApi({ getAppId: vi.fn(async () => null) });
    const result = await iapPricingProbe.check(
      ctx({ apps: [app({ bundleId: "com.x" })], asc: noApp, products: withPricedIap }),
    );
    expect(findings(result)).toEqual([{ status: "warn", identifier: "com.x" }]);
  });
});

describe("subscriptionOffersProbe", () => {
  it("omits when no subscription declares offer codes, skips without an Apple account", async () => {
    expect((await subscriptionOffersProbe.check(ctx({ apps: [app({ bundleId: "com.x" })] }))).state).toBe("omitted");
    expect(
      (
        await subscriptionOffersProbe.check(
          ctx({ apps: [app({ bundleId: "com.x" })], asc: null, products: withOffers }),
        )
      ).state,
    ).toBe("skipped");
  });

  it("passes a present offer code, warns on a missing one", async () => {
    const live = [{ id: "s1", productId: "com.x.pro", state: "READY_TO_SUBMIT" }];
    const present = ascApi({
      listSubscriptions: vi.fn(async () => live),
      listSubscriptionOfferCodes: vi.fn(async () => [{ name: "LAUNCH50" }]),
    });
    expect(
      findings(
        await subscriptionOffersProbe.check(
          ctx({ apps: [app({ bundleId: "com.x" })], asc: present, products: withOffers }),
        ),
      ),
    ).toEqual([{ status: "ok", identifier: "com.x.pro·LAUNCH50" }]);

    const missing = ascApi({
      listSubscriptions: vi.fn(async () => live),
      listSubscriptionOfferCodes: vi.fn(async () => []),
    });
    expect(
      findings(
        await subscriptionOffersProbe.check(
          ctx({ apps: [app({ bundleId: "com.x" })], asc: missing, products: withOffers }),
        ),
      ),
    ).toEqual([{ status: "warn", identifier: "com.x.pro·LAUNCH50" }]);
  });

  it("warns (deferring to the subscriptions probe) when the subscription isn't on App Store Connect yet", async () => {
    const result = await subscriptionOffersProbe.check(
      ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi(), products: withOffers }),
    );
    expect(findings(result)).toEqual([{ status: "warn", identifier: "com.x.pro" }]);
  });
});

describe("sandboxTestersProbe", () => {
  it("omits when no app sells products, skips without an Apple account", async () => {
    expect((await sandboxTestersProbe.check(ctx({ apps: [app({ bundleId: "com.x" })] }))).state).toBe("omitted");
    expect(
      (await sandboxTestersProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: null, products: withPricedIap })))
        .state,
    ).toBe("skipped");
  });

  it("passes with ≥1 tester, warns with none (one account-wide finding)", async () => {
    const ok = await sandboxTestersProbe.check(
      ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi(), products: withPricedIap }),
    );
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "account-wide" }]);

    const none = ascApi({ listSandboxTesters: vi.fn(async () => []) });
    const warned = await sandboxTestersProbe.check(
      ctx({ apps: [app({ bundleId: "com.x" })], asc: none, products: withPricedIap }),
    );
    expect(findings(warned)).toEqual([{ status: "warn", identifier: "account-wide" }]);
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

describe("ageRatingProbe", () => {
  it("omits without an iOS app and skips without an Apple account", async () => {
    expect((await ageRatingProbe.check(ctx({ apps: [app({ packageName: "com.x" })] }))).state).toBe("omitted");
    expect((await ageRatingProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: null }))).state).toBe("skipped");
  });

  it("passes a completed questionnaire, blocks an empty or never-touched one", async () => {
    const ok = await ageRatingProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const empty = ascApi({ getAgeRatingDeclaration: vi.fn(async () => ({ attributes: {} })) });
    expect(findings(await ageRatingProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: empty })))).toEqual([
      { status: "blocker", identifier: "com.x" },
    ]);

    const untouched = ascApi({ getAgeRatingDeclaration: vi.fn(async () => null) });
    expect(findings(await ageRatingProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: untouched })))).toEqual([
      { status: "blocker", identifier: "com.x" },
    ]);
  });

  it("warns instead of blocking when there's no app record or no editable version to read", async () => {
    const noApp = ascApi({ getAppId: vi.fn(async () => null) });
    expect(findings(await ageRatingProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: noApp })))).toEqual([
      { status: "warn", identifier: "com.x" },
    ]);

    const noInfo = ascApi({ getEditableAppInfoId: vi.fn(async () => null) });
    expect(findings(await ageRatingProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: noInfo })))).toEqual([
      { status: "warn", identifier: "com.x" },
    ]);
  });
});

describe("accountDeletionProbe", () => {
  it("omits without an iOS app and skips without an Apple account", async () => {
    expect((await accountDeletionProbe.check(ctx({ apps: [app({ packageName: "com.x" })] }))).state).toBe("omitted");
    expect((await accountDeletionProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: null }))).state).toBe(
      "skipped",
    );
  });

  it("passes when a URL is declared in any locale, warns when none is set", async () => {
    const ok = await accountDeletionProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const none = ascApi({ listAccountDeletionUrls: vi.fn(async () => [{ locale: "en-US", url: "" }]) });
    expect(findings(await accountDeletionProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: none })))).toEqual([
      { status: "warn", identifier: "com.x" },
    ]);
  });

  it("warns when there's no app record or no editable app info to read", async () => {
    const noApp = ascApi({ getAppId: vi.fn(async () => null) });
    expect(findings(await accountDeletionProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: noApp })))).toEqual(
      [{ status: "warn", identifier: "com.x" }],
    );
  });
});

describe("demoAccountProbe", () => {
  it("omits without an iOS app and skips without an Apple account", async () => {
    expect((await demoAccountProbe.check(ctx({ apps: [app({ packageName: "com.x" })] }))).state).toBe("omitted");
    expect((await demoAccountProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: null }))).state).toBe(
      "skipped",
    );
  });

  it("passes when sign-in isn't required, or when it is and a demo account is provided", async () => {
    const notRequired = await demoAccountProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi() }));
    expect(findings(notRequired)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const provided = ascApi({
      getAppStoreReviewDetail: vi.fn(async () => ({
        attributes: { demoAccountRequired: true, demoAccountName: "review@x.example" },
      })),
    });
    expect(findings(await demoAccountProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: provided })))).toEqual([
      { status: "ok", identifier: "com.x" },
    ]);
  });

  it("blocks when sign-in is required but no demo account name is set", async () => {
    const missing = ascApi({
      getAppStoreReviewDetail: vi.fn(async () => ({ attributes: { demoAccountRequired: true } })),
    });
    expect(findings(await demoAccountProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: missing })))).toEqual([
      { status: "blocker", identifier: "com.x" },
    ]);
  });

  it("warns when App Review details, the app record, or an editable version are missing", async () => {
    const noDetail = ascApi({ getAppStoreReviewDetail: vi.fn(async () => null) });
    expect(findings(await demoAccountProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: noDetail })))).toEqual([
      { status: "warn", identifier: "com.x" },
    ]);

    const noVersion = ascApi({ findEditableAppStoreVersion: vi.fn(async () => null) });
    expect(findings(await demoAccountProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: noVersion })))).toEqual(
      [{ status: "warn", identifier: "com.x" }],
    );
  });
});

describe("profileEntitlementsProbe", () => {
  /** An app whose entitlements require the Push Notifications capability on its App ID. */
  const pushApp = app({ bundleId: "com.x", iosEntitlements: { "aps-environment": "production" } });

  it("omits when no in-scope app declares capability-bearing entitlements", async () => {
    expect((await profileEntitlementsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })] }))).state).toBe("omitted");
  });

  it("skips without an Apple account when an app does declare entitlements", async () => {
    expect((await profileEntitlementsProbe.check(ctx({ apps: [pushApp], asc: null }))).state).toBe("skipped");
  });

  it("passes when the App ID's capabilities cover the entitlements, blocks when one is missing", async () => {
    const ok = await profileEntitlementsProbe.check(ctx({ apps: [pushApp], asc: ascApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const missing = ascApi({ listBundleIdCapabilities: vi.fn(async () => []) });
    const blocked = await profileEntitlementsProbe.check(ctx({ apps: [pushApp], asc: missing }));
    expect(findings(blocked)).toEqual([{ status: "blocker", identifier: "com.x" }]);
    expect(firstDetail(blocked)).toContain("PUSH_NOTIFICATIONS");
  });

  it("warns when the App ID isn't registered yet", async () => {
    const noBundle = ascApi({ findBundleId: vi.fn(async () => null) });
    expect(findings(await profileEntitlementsProbe.check(ctx({ apps: [pushApp], asc: noBundle })))).toEqual([
      { status: "warn", identifier: "com.x" },
    ]);
  });
});

describe("screenshotsProbe", () => {
  it("omits without an iOS app and skips without an Apple account", async () => {
    expect((await screenshotsProbe.check(ctx({ apps: [app({ packageName: "com.x" })] }))).state).toBe("omitted");
    expect((await screenshotsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: null }))).state).toBe(
      "skipped",
    );
  });

  it('passes when the required 6.7" class has a screenshot', async () => {
    const ok = await screenshotsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);
  });

  it("warns when iPhone screenshots exist but not for the required class, blocks when none exist", async () => {
    const otherClass = ascApi({
      listScreenshotSets: vi.fn(async () => [{ id: "set-1", screenshotDisplayType: "APP_IPHONE_65" }]),
    });
    expect(
      findings(await screenshotsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: otherClass }))),
    ).toEqual([{ status: "warn", identifier: "com.x" }]);

    const noShots = ascApi({ listScreenshots: vi.fn(async () => []) });
    expect(findings(await screenshotsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: noShots })))).toEqual([
      { status: "blocker", identifier: "com.x" },
    ]);

    const noSets = ascApi({ listScreenshotSets: vi.fn(async () => []) });
    expect(findings(await screenshotsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: noSets })))).toEqual([
      { status: "blocker", identifier: "com.x" },
    ]);
  });

  it("warns when there's no app record or no editable version to read", async () => {
    const noApp = ascApi({ getAppId: vi.fn(async () => null) });
    expect(findings(await screenshotsProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: noApp })))).toEqual([
      { status: "warn", identifier: "com.x" },
    ]);
  });
});

describe("listingUrlsProbe", () => {
  /** Write a minimal `store.config.json` declaring one Apple privacy-policy URL, and return its dir. */
  function appDirWithPrivacyUrl(url: string): string {
    const dir = mkdtempSync(join(tmpdir(), "listing-urls-"));
    writeFileSync(
      join(dir, "store.config.json"),
      JSON.stringify({ apple: { info: { "en-US": { privacyPolicyUrl: url } } } }),
    );
    return dir;
  }

  it("omits when no in-scope app declares a listing URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "listing-urls-"));
    try {
      expect((await listingUrlsProbe.check(ctx({ apps: [app({ bundleId: "com.x", dir })] }))).state).toBe("omitted");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes a 2xx URL and blocks a non-2xx one", async () => {
    const dir = appDirWithPrivacyUrl("https://x.example/privacy");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200 })),
    );
    try {
      const ok = await listingUrlsProbe.check(ctx({ apps: [app({ bundleId: "com.x", dir })] }));
      expect(findings(ok)).toEqual([{ status: "ok", identifier: "https://x.example/privacy" }]);
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }

    const dir2 = appDirWithPrivacyUrl("https://x.example/gone");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 404 })),
    );
    try {
      const blocked = await listingUrlsProbe.check(ctx({ apps: [app({ bundleId: "com.x", dir: dir2 })] }));
      expect(findings(blocked)).toEqual([{ status: "blocker", identifier: "https://x.example/gone" }]);
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("propagates a fetch failure so the orchestrator records it as errored", async () => {
    const dir = appDirWithPrivacyUrl("https://x.example/privacy");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENOTFOUND");
      }),
    );
    try {
      await expect(listingUrlsProbe.check(ctx({ apps: [app({ bundleId: "com.x", dir })] }))).rejects.toThrow(
        "ENOTFOUND",
      );
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
