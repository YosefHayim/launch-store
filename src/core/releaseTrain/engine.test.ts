import { describe, expect, it } from "vitest";
import type { ReleaseVerdict } from "../appStoreRelease.js";
import { androidCarState, iosCarState, resolveTrainCars } from "./engine.js";

function verdict(state: ReleaseVerdict["state"]): ReleaseVerdict {
  return { label: state, state, done: true, exitCode: 0 };
}

describe("iosCarState", () => {
  it("maps each verdict to a native car state, keeping the car put on unknown", () => {
    expect(iosCarState(verdict("released"))).toBe("released");
    expect(iosCarState(verdict("pending-release"))).toBe("approved");
    expect(iosCarState(verdict("in-review"))).toBe("in-review");
    expect(iosCarState(verdict("rejected"))).toBe("rejected");
    expect(iosCarState(verdict("preparing"))).toBe("submitted");
    expect(iosCarState(verdict("unknown"))).toBeNull();
  });
});

describe("androidCarState", () => {
  it("treats a processed production release as live and a draft as submitted", () => {
    expect(androidCarState([{ status: "completed" }])).toBe("released");
    expect(androidCarState([{ status: "inProgress", userFraction: 0.1 }])).toBe("released");
    expect(androidCarState([{ status: "halted" }])).toBe("released");
    expect(androidCarState([{ status: "draft" }])).toBe("submitted");
  });

  it("keeps the car put when the track is empty or in an unknown status", () => {
    expect(androidCarState([])).toBeNull();
    expect(androidCarState([{ status: "weird" }])).toBeNull();
  });
});

describe("resolveTrainCars", () => {
  const base = { runtimeVersion: "1.0.0", channel: "production", noOta: false };

  it("coordinates both native legs and one OTA follower each by default", () => {
    const plan = resolveTrainCars({ ...base, hasBundleId: true, hasPackageName: true, hasCloudStorage: true });
    expect(plan.platforms).toEqual(["ios", "android"]);
    expect(plan.ota).toEqual([
      { platform: "ios", channel: "production", runtimeVersion: "1.0.0" },
      { platform: "android", channel: "production", runtimeVersion: "1.0.0" },
    ]);
  });

  it("drops OTA followers under --no-ota or with no cloud storage", () => {
    expect(
      resolveTrainCars({ ...base, hasBundleId: true, hasPackageName: false, hasCloudStorage: true, noOta: true }).ota,
    ).toEqual([]);
    expect(resolveTrainCars({ ...base, hasBundleId: true, hasPackageName: false, hasCloudStorage: false }).ota).toEqual(
      [],
    );
  });

  it("narrows to one native leg under --platform", () => {
    const plan = resolveTrainCars({
      ...base,
      hasBundleId: true,
      hasPackageName: true,
      hasCloudStorage: true,
      platformFilter: "ios",
    });
    expect(plan.platforms).toEqual(["ios"]);
    expect(plan.ota).toEqual([{ platform: "ios", channel: "production", runtimeVersion: "1.0.0" }]);
  });

  it("omits a native leg the app doesn't declare", () => {
    const plan = resolveTrainCars({ ...base, hasBundleId: false, hasPackageName: true, hasCloudStorage: false });
    expect(plan.platforms).toEqual(["android"]);
  });
});
