import { describe, expect, it } from "vitest";
import { buildConsoleUrl } from "./consoleLinks.js";
import type { OpenTarget } from "./types.js";

const APP_ID = "1490000000";

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
