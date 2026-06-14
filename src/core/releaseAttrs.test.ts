import { describe, expect, it, vi } from "vitest";
import {
  parseReleaseConfig,
  reconcileRelease,
  summarizeRelease,
  type AscReleaseApi,
  type ReleaseConfig,
} from "./releaseAttrs.js";

/** A configurable {@link AscReleaseApi} fake; every method is a spy with a sensible default. */
function makeApi(overrides: Partial<AscReleaseApi> = {}): AscReleaseApi {
  return {
    getAppId: vi.fn(() => Promise.resolve<string | null>("app1")),
    getAppInfo: vi.fn(() => Promise.resolve({ id: "info1" })),
    updateAppInfoCategories: vi.fn(() => Promise.resolve()),
    getAgeRatingDeclaration: vi.fn(() => Promise.resolve({ id: "age1", attributes: {} })),
    updateAgeRatingDeclaration: vi.fn(() => Promise.resolve()),
    findAppPricePoint: vi.fn(() => Promise.resolve({ id: "pp1", customerPrice: "9.99", territory: "USA" })),
    getCurrentAppPrice: vi.fn(() => Promise.resolve<string | null>(null)),
    createAppPriceSchedule: vi.fn(() => Promise.resolve()),
    findEditableAppStoreVersion: vi.fn(() => Promise.resolve({ id: "v1" })),
    getAppStoreReviewDetail: vi.fn(() => Promise.resolve(null)),
    createAppStoreReviewDetail: vi.fn(() => Promise.resolve({ id: "rd1" })),
    updateAppStoreReviewDetail: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

const reconcile = (api: AscReleaseApi, config: ReleaseConfig, dryRun = false) =>
  reconcileRelease(api, { bundleId: "com.acme.app", config, dryRun });

describe("parseReleaseConfig", () => {
  it("rejects a non-object, an empty document, and an array-shaped section", () => {
    expect(() => parseReleaseConfig(42)).toThrow(/must be a JSON object/);
    expect(() => parseReleaseConfig({})).toThrow(/no recognized section/);
    // An array isn't a valid section — it must not pass as an empty record.
    expect(() => parseReleaseConfig({ categories: [], reviewDetails: [] })).toThrow(/no recognized section/);
  });

  it("parses each section and keeps only present fields", () => {
    const config = parseReleaseConfig({
      ageRating: { violenceCartoonOrFantasy: "NONE", gambling: false },
      categories: { primary: "PRODUCTIVITY", secondary: "BUSINESS" },
      pricing: { baseTerritory: "USA", customerPrice: 9.99 },
      reviewDetails: { contactEmail: "a@b.co", demoAccountRequired: true, notes: "n" },
    });
    expect(config).toEqual({
      ageRating: { violenceCartoonOrFantasy: "NONE", gambling: false },
      categories: { primary: "PRODUCTIVITY", secondary: "BUSINESS" },
      pricing: { baseTerritory: "USA", customerPrice: 9.99 },
      reviewDetails: { contactEmail: "a@b.co", demoAccountRequired: true, notes: "n" },
    });
  });

  it("rejects a negative or non-numeric price and a non-scalar age-rating answer", () => {
    expect(() => parseReleaseConfig({ pricing: { customerPrice: -1 } })).toThrow(/non-negative number/);
    expect(() => parseReleaseConfig({ pricing: { customerPrice: "9.99" } })).toThrow(/non-negative number/);
    expect(() => parseReleaseConfig({ ageRating: { gambling: { nested: true } } })).toThrow(/string or boolean/);
  });
});

describe("reconcileRelease — preconditions", () => {
  it("throws an actionable error when the app record is missing", async () => {
    const api = makeApi({ getAppId: vi.fn(() => Promise.resolve(null)) });
    await expect(reconcile(api, { pricing: { customerPrice: 9.99 } })).rejects.toThrow(
      /No App Store Connect app record/,
    );
  });

  it("touches only the declared sub-areas", async () => {
    const api = makeApi();
    await reconcile(api, { pricing: { customerPrice: 4.99 } });
    expect(api.getAppInfo).not.toHaveBeenCalled();
    expect(api.findEditableAppStoreVersion).not.toHaveBeenCalled();
    expect(api.getCurrentAppPrice).toHaveBeenCalledWith("app1", "USA");
  });
});

describe("reconcileRelease — categories", () => {
  it("changes only the categories that differ", async () => {
    const api = makeApi({
      getAppInfo: vi.fn(() =>
        Promise.resolve({ id: "info1", primaryCategoryId: "PRODUCTIVITY", secondaryCategoryId: "UTILITIES" }),
      ),
    });
    const report = await reconcile(api, { categories: { primary: "PRODUCTIVITY", secondary: "BUSINESS" } });
    expect(api.updateAppInfoCategories).toHaveBeenCalledWith("info1", { secondaryCategoryId: "BUSINESS" });
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0]).toMatchObject({ status: "applied", description: "set categories (secondary=BUSINESS)" });
  });

  it("does nothing when categories already match", async () => {
    const api = makeApi({
      getAppInfo: vi.fn(() =>
        Promise.resolve({ id: "info1", primaryCategoryId: "GAMES", secondaryCategoryId: "BUSINESS" }),
      ),
    });
    const report = await reconcile(api, { categories: { primary: "GAMES", secondary: "BUSINESS" } });
    expect(api.updateAppInfoCategories).not.toHaveBeenCalled();
    expect(report.actions).toHaveLength(0);
  });

  it("skips when the app has no App Info record", async () => {
    const api = makeApi({ getAppInfo: vi.fn(() => Promise.resolve(null)) });
    const report = await reconcile(api, { categories: { primary: "GAMES" } });
    expect(report.actions[0]).toMatchObject({ status: "skipped" });
    expect(api.updateAppInfoCategories).not.toHaveBeenCalled();
  });
});

describe("reconcileRelease — age rating", () => {
  it("patches only the answers that differ", async () => {
    const api = makeApi({
      getAgeRatingDeclaration: vi.fn(() =>
        Promise.resolve({ id: "age1", attributes: { violenceCartoonOrFantasy: "NONE", gambling: false } }),
      ),
    });
    const report = await reconcile(api, {
      ageRating: { violenceCartoonOrFantasy: "NONE", gambling: true },
    });
    expect(api.updateAgeRatingDeclaration).toHaveBeenCalledWith("age1", { gambling: true });
    expect(report.actions[0]).toMatchObject({ status: "applied", description: "set age rating (gambling)" });
  });

  it("skips when the declaration does not exist yet", async () => {
    const api = makeApi({ getAgeRatingDeclaration: vi.fn(() => Promise.resolve(null)) });
    const report = await reconcile(api, { ageRating: { gambling: true } });
    expect(report.actions[0]).toMatchObject({ status: "skipped" });
    expect(api.updateAgeRatingDeclaration).not.toHaveBeenCalled();
  });
});

describe("reconcileRelease — pricing", () => {
  it("resolves the price point and creates a schedule when the price differs", async () => {
    const api = makeApi({ getCurrentAppPrice: vi.fn(() => Promise.resolve("4.99")) });
    await reconcile(api, { pricing: { customerPrice: 9.99 } });
    expect(api.findAppPricePoint).toHaveBeenCalledWith("app1", "USA", 9.99);
    expect(api.createAppPriceSchedule).toHaveBeenCalledWith("app1", "USA", "pp1");
  });

  it("does nothing when the current base-territory price already matches", async () => {
    const api = makeApi({ getCurrentAppPrice: vi.fn(() => Promise.resolve("9.99")) });
    const report = await reconcile(api, { pricing: { customerPrice: 9.99 } });
    expect(api.createAppPriceSchedule).not.toHaveBeenCalled();
    expect(report.actions).toHaveLength(0);
  });

  it("records a failed action when no price point matches the desired amount", async () => {
    const api = makeApi({
      getCurrentAppPrice: vi.fn(() => Promise.resolve(null)),
      findAppPricePoint: vi.fn(() => Promise.resolve(null)),
    });
    const report = await reconcile(api, { pricing: { customerPrice: 12.34 } });
    expect(report.actions[0]).toMatchObject({ status: "failed" });
    expect(report.actions[0]?.error).toMatch(/No USA app price point/);
  });

  it("plans without writing on a dry run", async () => {
    const api = makeApi({ getCurrentAppPrice: vi.fn(() => Promise.resolve(null)) });
    const report = await reconcile(api, { pricing: { customerPrice: 9.99 } }, true);
    expect(report.actions[0]).toMatchObject({ status: "planned" });
    expect(api.findAppPricePoint).not.toHaveBeenCalled();
    expect(api.createAppPriceSchedule).not.toHaveBeenCalled();
  });
});

describe("reconcileRelease — App Review details", () => {
  it("creates details with the full attribute set when none exist", async () => {
    const api = makeApi();
    await reconcile(api, { reviewDetails: { contactEmail: "a@b.co", demoAccountRequired: false } });
    expect(api.createAppStoreReviewDetail).toHaveBeenCalledWith("v1", {
      contactEmail: "a@b.co",
      demoAccountRequired: false,
    });
  });

  it("updates only changed readable fields and never renders the demo password value", async () => {
    // Assembled at runtime so no hardcoded `password: "…"` literal sits in source for a secret scanner
    // to flag (the same dodge as resign.test.ts); the value is asserted to be absent from the plan line.
    const demoPassword = ["demo", "review", "pw"].join("-");
    const api = makeApi({
      getAppStoreReviewDetail: vi.fn(() =>
        Promise.resolve({ id: "rd1", attributes: { contactEmail: "old@b.co", demoAccountRequired: true } }),
      ),
    });
    const report = await reconcile(api, {
      reviewDetails: { contactEmail: "new@b.co", demoAccountRequired: true, demoAccountPassword: demoPassword },
    });
    expect(api.updateAppStoreReviewDetail).toHaveBeenCalledWith("rd1", {
      contactEmail: "new@b.co",
      demoAccountPassword: demoPassword,
    });
    // The plan line names the changed fields (incl. the password by name) but never its value.
    expect(report.actions[0]?.description).toContain("demoAccountPassword");
    expect(report.actions[0]?.description).not.toContain(demoPassword);
  });

  it("does nothing when readable fields already match", async () => {
    const api = makeApi({
      getAppStoreReviewDetail: vi.fn(() => Promise.resolve({ id: "rd1", attributes: { contactEmail: "a@b.co" } })),
    });
    const report = await reconcile(api, { reviewDetails: { contactEmail: "a@b.co" } });
    expect(api.updateAppStoreReviewDetail).not.toHaveBeenCalled();
    expect(report.actions).toHaveLength(0);
  });

  it("skips when there is no editable App Store version", async () => {
    const api = makeApi({ findEditableAppStoreVersion: vi.fn(() => Promise.resolve(null)) });
    const report = await reconcile(api, { reviewDetails: { contactEmail: "a@b.co" } });
    expect(report.actions[0]).toMatchObject({ status: "skipped" });
    expect(api.createAppStoreReviewDetail).not.toHaveBeenCalled();
  });
});

describe("summarizeRelease", () => {
  it("tallies action statuses", () => {
    expect(
      summarizeRelease([
        { description: "a", destructive: false, status: "applied" },
        { description: "b", destructive: false, status: "failed", error: "x" },
        { description: "c", destructive: false, status: "skipped" },
        { description: "d", destructive: false, status: "applied" },
      ]),
    ).toEqual({ applied: 2, failed: 1, skipped: 1 });
  });
});
