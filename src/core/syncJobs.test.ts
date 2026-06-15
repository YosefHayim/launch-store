import { describe, expect, it } from "vitest";
import { buildJobs, selectApps } from "./syncJobs.js";
import type { AppDescriptor, AppProducts, LaunchConfig } from "./types.js";

/** A discovered app pointing at a non-existent dir, so `buildJobs`' asset/listing reads return empty. */
function app(name: string, over: Partial<AppDescriptor> = {}): AppDescriptor {
  return { name, dir: `/no/such/dir/${name}`, configPath: `/no/such/dir/${name}/app.json`, ...over };
}

/** A minimal valid {@link LaunchConfig} — only `products` matters to `buildJobs`. */
function config(products?: Record<string, AppProducts>): LaunchConfig {
  return {
    profiles: {},
    credentials: "local",
    storage: "local",
    buildEngine: "fastlane",
    submit: "app-store-connect",
    ...(products ? { products } : {}),
  };
}

const IAP: AppProducts = {
  inAppPurchases: [
    {
      productId: "com.acme.coins",
      referenceName: "Coins",
      type: "CONSUMABLE",
      localizations: [{ locale: "en-US", name: "Coins" }],
    },
  ],
};

describe("selectApps", () => {
  const apps = [
    app("alpha", { bundleId: "com.acme.alpha" }),
    app("beta"),
    app("gamma", { bundleId: "com.acme.gamma" }),
  ];

  it("returns every app when no selector is given", () => {
    expect(selectApps(apps, undefined)).toEqual(apps);
  });

  it("narrows to the named apps, in selector order", () => {
    expect(selectApps(apps, "gamma,alpha").map((a) => a.name)).toEqual(["gamma", "alpha"]);
  });

  it("trims whitespace and ignores empty entries", () => {
    expect(selectApps(apps, " alpha , ").map((a) => a.name)).toEqual(["alpha"]);
  });

  it("throws on an unknown app name", () => {
    expect(() => selectApps(apps, "delta")).toThrow(/Unknown app "delta"/);
  });
});

describe("buildJobs", () => {
  it("builds a job for an app that declares products", () => {
    const jobs = buildJobs([app("alpha", { bundleId: "com.acme.alpha" })], config({ "com.acme.alpha": IAP }));
    expect(jobs.map((job) => job.bundleId)).toEqual(["com.acme.alpha"]);
    expect(jobs[0]?.products.inAppPurchases).toHaveLength(1);
  });

  it("skips an app with no iOS bundle id", () => {
    expect(buildJobs([app("beta")], config({ "com.acme.beta": IAP }))).toHaveLength(0);
  });

  it("skips an app with nothing to sync (no capabilities, products, listing, or assets)", () => {
    expect(buildJobs([app("alpha", { bundleId: "com.acme.alpha" })], config())).toHaveLength(0);
  });
});
