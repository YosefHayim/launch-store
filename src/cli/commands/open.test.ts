import { describe, expect, it } from "vitest";
import { parseOpenTarget, resolveOpenPlatform, selectOpenApp } from "./open.js";
import type { AppDescriptor } from "../../core/types.js";

function app(name: string, ids: { bundleId?: string; packageName?: string } = {}): AppDescriptor {
  return { name, dir: `/repo/${name}`, configPath: `/repo/${name}/app.json`, ...ids };
}

describe("parseOpenTarget", () => {
  it("defaults to asc when no target is given", () => {
    expect(parseOpenTarget(undefined)).toBe("asc");
  });

  it("accepts every documented target", () => {
    for (const target of ["asc", "play", "testflight", "listing", "reviews", "agreements", "app-record"]) {
      expect(parseOpenTarget(target)).toBe(target);
    }
  });

  it("rejects an unknown target with the valid list", () => {
    expect(() => parseOpenTarget("dashboard")).toThrow(/Unknown target "dashboard"/);
  });
});

describe("resolveOpenPlatform", () => {
  it("honors an explicit --platform flag", () => {
    expect(resolveOpenPlatform("asc", "android")).toBe("android");
    expect(resolveOpenPlatform("play", "ios")).toBe("ios");
  });

  it("infers android for the play target", () => {
    expect(resolveOpenPlatform("play", undefined)).toBe("android");
  });

  it("defaults to ios for every other target", () => {
    expect(resolveOpenPlatform("asc", undefined)).toBe("ios");
    expect(resolveOpenPlatform("testflight", undefined)).toBe("ios");
  });

  it("rejects an invalid --platform", () => {
    expect(() => resolveOpenPlatform("asc", "web")).toThrow(/Unknown --platform "web"/);
  });
});

describe("selectOpenApp", () => {
  const apps = [
    app("alpha", { bundleId: "com.acme.alpha" }),
    app("beta", { packageName: "com.acme.beta" }),
    app("gamma", { bundleId: "com.acme.gamma", packageName: "com.acme.gamma" }),
  ];

  it("picks the first iOS app with a bundle id", () => {
    expect(selectOpenApp(apps, "ios", undefined).name).toBe("alpha");
  });

  it("picks the first Android app with a package name", () => {
    expect(selectOpenApp(apps, "android", undefined).name).toBe("beta");
  });

  it("narrows to the named app", () => {
    expect(selectOpenApp(apps, "ios", "gamma").name).toBe("gamma");
  });

  it("throws when the named app lacks the platform id", () => {
    expect(() => selectOpenApp(apps, "ios", "beta")).toThrow(/No ios app found matching "beta"/);
  });

  it("throws when no app qualifies for the platform", () => {
    expect(() => selectOpenApp([app("solo", { bundleId: "com.acme.solo" })], "android", undefined)).toThrow(
      /android\.package/,
    );
  });
});
