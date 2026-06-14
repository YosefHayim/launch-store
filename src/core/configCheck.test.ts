import { describe, expect, it } from "vitest";
import { checkAppConfig } from "./configCheck.js";

/** A minimal, footgun-free config so each test can perturb one field and assert on that finding alone. */
const clean = {
  expo: {
    name: "Acme",
    slug: "acme",
    version: "1.2.3",
    scheme: "acme",
    icon: "./assets/icon.png",
    ios: { bundleIdentifier: "com.acme.app" },
    android: { package: "com.acme.app" },
  },
};

/** Pull the keys that fired, for terse assertions about which rules tripped. */
const keys = (config: Record<string, unknown>, platform: "ios" | "android"): string[] =>
  checkAppConfig(config, "app.json", platform).map((finding) => finding.key);

describe("checkAppConfig", () => {
  it("passes a clean config on both platforms", () => {
    expect(checkAppConfig(clean, "app.json", "ios")).toEqual([]);
    expect(checkAppConfig(clean, "app.json", "android")).toEqual([]);
  });

  it("flags an invalid iOS bundle id as an error, only on iOS", () => {
    const config = { expo: { ...clean.expo, ios: { bundleIdentifier: "com.acme_app" } } };
    const ios = checkAppConfig(config, "app.json", "ios");
    expect(ios).toHaveLength(1);
    expect(ios[0]).toMatchObject({ severity: "error", key: "ios.bundleIdentifier" });
    // The bundle-id rule is iOS-only; the Android pass doesn't flag it.
    expect(keys(config, "android")).not.toContain("ios.bundleIdentifier");
  });

  it("flags an invalid Android package (hyphen / digit-led segment) as an error", () => {
    expect(keys({ expo: { ...clean.expo, android: { package: "com.acme-app" } } }, "android")).toContain(
      "android.package",
    );
    expect(keys({ expo: { ...clean.expo, android: { package: "com.1acme.app" } } }, "android")).toContain(
      "android.package",
    );
    expect(keys({ expo: { ...clean.expo, android: { package: "single" } } }, "android")).toContain("android.package");
  });

  it("flags a splash with no backgroundColor as an error on Android only", () => {
    const config = { expo: { ...clean.expo, splash: { image: "./assets/splash.png" } } };
    const android = checkAppConfig(config, "app.json", "android");
    expect(android.some((f) => f.key === "splash" && f.severity === "error")).toBe(true);
    expect(keys(config, "ios")).not.toContain("splash");
  });

  it("accepts a splash that has a backgroundColor (incl. an android-level override)", () => {
    expect(keys({ expo: { ...clean.expo, splash: { image: "x", backgroundColor: "#fff" } } }, "android")).not.toContain(
      "splash",
    );
    expect(
      keys(
        {
          expo: {
            ...clean.expo,
            splash: { image: "x" },
            android: { package: "com.acme.app", splash: { backgroundColor: "#000" } },
          },
        },
        "android",
      ),
    ).not.toContain("splash");
  });

  it("warns when no app icon is set", () => {
    const { icon: _icon, ...noIcon } = clean.expo;
    expect(keys({ expo: noIcon }, "ios")).toContain("icon");
    // An adaptive icon alone satisfies the check.
    expect(
      keys(
        { expo: { ...noIcon, android: { package: "com.acme.app", adaptiveIcon: { foregroundImage: "x" } } } },
        "android",
      ),
    ).not.toContain("icon");
  });

  it("warns when no URL scheme is set", () => {
    const { scheme: _scheme, ...noScheme } = clean.expo;
    expect(keys({ expo: noScheme }, "ios")).toContain("scheme");
  });

  it("warns on a non-numeric marketing version", () => {
    expect(keys({ expo: { ...clean.expo, version: "v1" } }, "ios")).toContain("version");
    expect(keys({ expo: { ...clean.expo, version: "1.0.0-beta" } }, "ios")).toContain("version");
  });

  it("tolerates a flat (unwrapped) config shape", () => {
    const flat = {
      slug: "acme",
      version: "1.0.0",
      scheme: "acme",
      icon: "x",
      ios: { bundleIdentifier: "com.acme.app" },
    };
    expect(checkAppConfig(flat, "app.json", "ios")).toEqual([]);
  });
});
