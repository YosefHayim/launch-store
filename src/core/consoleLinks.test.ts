import { describe, expect, it } from "vitest";
import { buildConsoleUrl, parseOpenTarget, resolveOpenPlatform, selectOpenApp } from "./consoleLinks.js";
import type { AppDescriptor, OpenTarget } from "./types.js";

const APP_ID = "1490000000";

/** Build a minimal {@link AppDescriptor} for the selection tests; ids reuse the domain shape's fields. */
function app(name: string, ids: Pick<AppDescriptor, "bundleId" | "packageName"> = {}): AppDescriptor {
  return { name, dir: `/repo/${name}`, configPath: `/repo/${name}/app.json`, ...ids };
}

describe("buildConsoleUrl — iOS deep links with a resolved app id", () => {
  const cases: readonly [OpenTarget, string][] = [
    ["asc", `https://appstoreconnect.apple.com/apps/${APP_ID}`],
    ["app-record", `https://appstoreconnect.apple.com/apps/${APP_ID}`],
    ["testflight", `https://appstoreconnect.apple.com/apps/${APP_ID}/testflight/ios`],
    ["listing", `https://appstoreconnect.apple.com/apps/${APP_ID}/appstore`],
    ["reviews", `https://appstoreconnect.apple.com/apps/${APP_ID}/ratings-and-reviews/ios`],
    ["agreements", "https://appstoreconnect.apple.com/agreements/"],
    ["play", "https://play.google.com/console"],
  ];

  it.each(cases)("%s → %s", (target, expected) => {
    expect(buildConsoleUrl(target, "ios", APP_ID)).toBe(expected);
  });
});

describe("buildConsoleUrl — iOS without a resolved app id falls back, never throws", () => {
  const appLevel: OpenTarget[] = ["asc", "app-record", "testflight", "listing", "reviews"];

  it.each(appLevel)("%s falls back to the apps list", (target) => {
    expect(buildConsoleUrl(target, "ios", undefined)).toBe("https://appstoreconnect.apple.com/apps");
  });

  it("agreements is account-level and ignores the missing app id", () => {
    expect(buildConsoleUrl("agreements", "ios", undefined)).toBe("https://appstoreconnect.apple.com/agreements/");
  });
});

describe("buildConsoleUrl — Android always lands on the Play Console", () => {
  const targets: OpenTarget[] = ["asc", "play", "testflight", "listing", "reviews", "agreements", "app-record"];

  it.each(targets)("%s → Play Console (no app id needed)", (target) => {
    expect(buildConsoleUrl(target, "android", APP_ID)).toBe("https://play.google.com/console");
    expect(buildConsoleUrl(target, "android", undefined)).toBe("https://play.google.com/console");
  });
});

describe("buildConsoleUrl — the play target forces the Play Console even on iOS", () => {
  it("ignores the iOS platform and app id", () => {
    expect(buildConsoleUrl("play", "ios", APP_ID)).toBe("https://play.google.com/console");
  });
});

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
