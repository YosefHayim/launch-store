import { describe, expect, it } from "vitest";
import { formatStatusLine, reviewStatusForVerdict, selectIosApps, worstExitCode } from "./status.js";
import { classifyVerdict, type ReleaseStatus } from "../../core/appStoreRelease.js";
import type { AppDescriptor } from "../../core/types.js";

function status(over: Partial<ReleaseStatus> = {}): ReleaseStatus {
  const base: ReleaseStatus = {
    bundleId: "com.acme.app",
    versionString: "1.2.0",
    appStoreState: "IN_REVIEW",
    buildNumber: "42",
    buildProcessingState: "VALID",
    phasedReleaseState: null,
    verdict: classifyVerdict("IN_REVIEW"),
  };
  const merged: ReleaseStatus = { ...base, ...over };
  if (over.appStoreState !== undefined && over.verdict === undefined) {
    merged.verdict = classifyVerdict(over.appStoreState ?? "");
  }
  return merged;
}

function app(name: string, bundleId?: string): AppDescriptor {
  return { name, dir: `/repo/${name}`, configPath: `/repo/${name}/app.json`, ...(bundleId ? { bundleId } : {}) };
}

describe("formatStatusLine", () => {
  it("renders version, verdict, build, and phased state", () => {
    expect(formatStatusLine(status())).toBe("v1.2.0 · In review · build 42");
  });

  it("annotates a build still processing", () => {
    expect(formatStatusLine(status({ buildProcessingState: "PROCESSING" }))).toContain("build 42 (PROCESSING)");
  });

  it("shows the phased-rollout state and a live verdict", () => {
    const line = formatStatusLine(status({ appStoreState: "READY_FOR_SALE", phasedReleaseState: "ACTIVE" }));
    expect(line).toContain("Live on the App Store");
    expect(line).toContain("phased: ACTIVE");
  });

  it("handles an app with no App Store version yet", () => {
    expect(formatStatusLine(status({ versionString: null, appStoreState: "", buildNumber: null }))).toContain(
      "no App Store version",
    );
  });
});

describe("worstExitCode — error › rejected › in-progress › ok", () => {
  it("picks the worst code in the batch", () => {
    expect(worstExitCode([0, 0])).toBe(0);
    expect(worstExitCode([0, 3])).toBe(3);
    expect(worstExitCode([3, 2])).toBe(2);
    expect(worstExitCode([2, 1])).toBe(1);
    expect(worstExitCode([0, 1, 3])).toBe(1);
    expect(worstExitCode([])).toBe(0);
  });
});

describe("reviewStatusForVerdict", () => {
  it("notifies rejected on a rejection", () => {
    expect(reviewStatusForVerdict(classifyVerdict("REJECTED"))).toBe("rejected");
  });

  it("notifies approved on a released verdict", () => {
    expect(reviewStatusForVerdict(classifyVerdict("READY_FOR_SALE"))).toBe("approved");
  });

  it("notifies approved on a pending-release verdict", () => {
    expect(reviewStatusForVerdict(classifyVerdict("PENDING_DEVELOPER_RELEASE"))).toBe("approved");
  });

  it("stays silent while in review", () => {
    expect(reviewStatusForVerdict(classifyVerdict("IN_REVIEW"))).toBeNull();
  });

  it("stays silent on a preparing (not-yet-submitted) verdict", () => {
    expect(reviewStatusForVerdict(classifyVerdict("PREPARE_FOR_SUBMISSION"))).toBeNull();
  });
});

describe("selectIosApps", () => {
  const apps = [app("alpha", "com.acme.alpha"), app("beta"), app("gamma", "com.acme.gamma")];

  it("returns every app with a bundle id when no selector is given", () => {
    expect(selectIosApps(apps, undefined)).toEqual([
      { name: "alpha", bundleId: "com.acme.alpha" },
      { name: "gamma", bundleId: "com.acme.gamma" },
    ]);
  });

  it("narrows to the named apps", () => {
    expect(selectIosApps(apps, "gamma")).toEqual([{ name: "gamma", bundleId: "com.acme.gamma" }]);
  });

  it("throws on an unknown app name", () => {
    expect(() => selectIosApps(apps, "delta")).toThrow(/Unknown iOS app "delta"/);
  });
});
