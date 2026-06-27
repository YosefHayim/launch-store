import { describe, expect, it } from "vitest";
import { assertListingPlatform } from "./metadata.js";

describe("assertListingPlatform", () => {
  it("allows the two platforms fastlane deliver/supply drive: iOS and Android", () => {
    expect(() => {
      assertListingPlatform("ios");
    }).not.toThrow();
    expect(() => {
      assertListingPlatform("android");
    }).not.toThrow();
  });

  it("rejects tvOS, macOS, and visionOS — their listing isn't wired through deliver in v1", () => {
    for (const platform of ["tvos", "macos", "visionos"] as const) {
      expect(() => {
        assertListingPlatform(platform);
      }).toThrow(/syncs the iOS and Android store listing only/);
    }
  });
});
