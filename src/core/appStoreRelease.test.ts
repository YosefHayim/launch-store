import { describe, expect, it, vi } from "vitest";
import type { AppStoreVersionResource, PhasedReleaseResource } from "../apple/ascClient.js";
import {
  controlPhasedRelease,
  readReleaseStatus,
  runAppStoreRelease,
  type AscReleaseApi,
  type ReleaseInput,
} from "./appStoreRelease.js";

/**
 * A fully-stubbed {@link AscReleaseApi}. Reads default to "nothing exists yet"; writes resolve to a
 * created resource. Override per-test to simulate existing versions / phased releases / submissions.
 */
function makeApi(overrides: Partial<AscReleaseApi> = {}): AscReleaseApi {
  const base: AscReleaseApi = {
    listAppStoreVersions: vi.fn().mockResolvedValue([]),
    createAppStoreVersion: vi
      .fn()
      .mockImplementation((_appId: string, input: { versionString: string }) =>
        Promise.resolve({ id: "v-new", versionString: input.versionString, appStoreState: "PREPARE_FOR_SUBMISSION" }),
      ),
    updateAppStoreVersion: vi.fn().mockResolvedValue(undefined),
    selectBuildForVersion: vi.fn().mockResolvedValue(undefined),
    setBuildUsesNonExemptEncryption: vi.fn().mockResolvedValue(undefined),
    listAppStoreVersionLocalizations: vi.fn().mockResolvedValue([]),
    updateVersionWhatsNew: vi.fn().mockResolvedValue(undefined),
    getPhasedRelease: vi.fn().mockResolvedValue(null),
    createPhasedRelease: vi.fn().mockResolvedValue({ id: "ph-new", phasedReleaseState: "INACTIVE" }),
    updatePhasedRelease: vi.fn().mockResolvedValue(undefined),
    deletePhasedRelease: vi.fn().mockResolvedValue(undefined),
    listReviewSubmissions: vi.fn().mockResolvedValue([]),
    createReviewSubmission: vi.fn().mockResolvedValue({ id: "rs-new", state: "READY_FOR_REVIEW" }),
    addReviewSubmissionItem: vi.fn().mockResolvedValue(undefined),
    submitReviewSubmission: vi.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides };
}

function input(over: Partial<ReleaseInput> = {}): ReleaseInput {
  return {
    appId: "app1",
    versionString: "1.4.0",
    buildId: "b9",
    usesNonExemptEncryption: false,
    releaseType: "AFTER_APPROVAL",
    phased: false,
    whatsNew: [],
    dryRun: false,
    ...over,
  };
}

describe("runAppStoreRelease — fresh release", () => {
  it("creates the version, stamps compliance, attaches the build, and submits for review", async () => {
    const api = makeApi();
    const report = await runAppStoreRelease(api, input());

    expect(report.reused).toBe(false);
    expect(report.alreadyInFlight).toBe(false);
    expect(api.createAppStoreVersion).toHaveBeenCalledWith("app1", {
      versionString: "1.4.0",
      platform: "IOS",
      releaseType: "AFTER_APPROVAL",
    });
    expect(api.setBuildUsesNonExemptEncryption).toHaveBeenCalledWith("b9", false);
    expect(api.selectBuildForVersion).toHaveBeenCalledWith("v-new", "b9");
    expect(api.createReviewSubmission).toHaveBeenCalledWith("app1", "IOS");
    expect(api.addReviewSubmissionItem).toHaveBeenCalledWith("rs-new", "v-new");
    expect(api.submitReviewSubmission).toHaveBeenCalledWith("rs-new");
    expect(report.actions.every((a) => a.status === "applied")).toBe(true);
  });

  it("passes a scheduled release date through to the version create", async () => {
    const api = makeApi();
    await runAppStoreRelease(api, input({ releaseType: "SCHEDULED", earliestReleaseDate: "2026-07-01T12:00:00Z" }));
    expect(api.createAppStoreVersion).toHaveBeenCalledWith("app1", {
      versionString: "1.4.0",
      platform: "IOS",
      releaseType: "SCHEDULED",
      earliestReleaseDate: "2026-07-01T12:00:00Z",
    });
  });
});

describe("runAppStoreRelease — resume / idempotency", () => {
  const editable: AppStoreVersionResource = { id: "v-edit", versionString: "1.3.0", appStoreState: "REJECTED" };

  it("reuses an editable version (renaming it) instead of creating a second one", async () => {
    const api = makeApi({ listAppStoreVersions: vi.fn().mockResolvedValue([editable]) });
    const report = await runAppStoreRelease(api, input({ versionString: "1.4.0" }));

    expect(report.reused).toBe(true);
    expect(api.createAppStoreVersion).not.toHaveBeenCalled();
    expect(api.updateAppStoreVersion).toHaveBeenCalledWith("v-edit", {
      versionString: "1.4.0",
      releaseType: "AFTER_APPROVAL",
      earliestReleaseDate: null,
    });
    expect(api.selectBuildForVersion).toHaveBeenCalledWith("v-edit", "b9");
  });

  it("no-ops when the version is already in review", async () => {
    const api = makeApi({
      listAppStoreVersions: vi
        .fn()
        .mockResolvedValue([{ id: "v1", versionString: "1.4.0", appStoreState: "WAITING_FOR_REVIEW" }]),
    });
    const report = await runAppStoreRelease(api, input({ versionString: "1.4.0" }));

    expect(report.alreadyInFlight).toBe(true);
    expect(api.createAppStoreVersion).not.toHaveBeenCalled();
    expect(api.submitReviewSubmission).not.toHaveBeenCalled();
    expect(report.actions[0]?.status).toBe("skipped");
  });

  it("throws when the version string is already released", async () => {
    const api = makeApi({
      listAppStoreVersions: vi
        .fn()
        .mockResolvedValue([{ id: "v1", versionString: "1.4.0", appStoreState: "READY_FOR_SALE" }]),
    });
    await expect(runAppStoreRelease(api, input({ versionString: "1.4.0" }))).rejects.toThrow(/already released/);
  });

  it("tolerates a review item that's already been added (re-run after submit-failure)", async () => {
    const api = makeApi({
      addReviewSubmissionItem: vi.fn().mockRejectedValue(new Error("The resource already exists.")),
    });
    const report = await runAppStoreRelease(api, input());
    // The add is swallowed as idempotent, and submit still runs.
    expect(api.submitReviewSubmission).toHaveBeenCalled();
    expect(report.actions.find((a) => a.description.includes("add version"))?.status).toBe("applied");
  });
});

describe("runAppStoreRelease — phased release", () => {
  it("enables a phased release when opted in and none exists", async () => {
    const api = makeApi();
    await runAppStoreRelease(api, input({ phased: true }));
    expect(api.createPhasedRelease).toHaveBeenCalledWith("v-new");
    expect(api.deletePhasedRelease).not.toHaveBeenCalled();
  });

  it("cancels a stale phased release when the run wants an immediate rollout", async () => {
    const phased: PhasedReleaseResource = { id: "ph1", phasedReleaseState: "INACTIVE" };
    const api = makeApi({ getPhasedRelease: vi.fn().mockResolvedValue(phased) });
    await runAppStoreRelease(api, input({ phased: false }));
    expect(api.deletePhasedRelease).toHaveBeenCalledWith("ph1");
    expect(api.createPhasedRelease).not.toHaveBeenCalled();
  });
});

describe("runAppStoreRelease — what's-new", () => {
  it("writes notes for a present locale and skips a missing one", async () => {
    const api = makeApi({
      listAppStoreVersionLocalizations: vi
        .fn()
        .mockResolvedValue([{ id: "loc-en", locale: "en-US", whatsNew: undefined }]),
    });
    const report = await runAppStoreRelease(
      api,
      input({
        whatsNew: [
          { locale: "en-US", text: "Bug fixes." },
          { locale: "fr-FR", text: "Corrections." },
        ],
      }),
    );
    expect(api.updateVersionWhatsNew).toHaveBeenCalledWith("loc-en", "Bug fixes.");
    expect(api.updateVersionWhatsNew).toHaveBeenCalledTimes(1);
    expect(report.actions.find((a) => a.description.includes("[fr-FR]"))?.status).toBe("skipped");
  });
});

describe("runAppStoreRelease — dry run", () => {
  it("records a plan without performing any write", async () => {
    const api = makeApi();
    const report = await runAppStoreRelease(api, input({ dryRun: true, phased: true }));

    expect(api.createAppStoreVersion).not.toHaveBeenCalled();
    expect(api.setBuildUsesNonExemptEncryption).not.toHaveBeenCalled();
    expect(api.submitReviewSubmission).not.toHaveBeenCalled();
    expect(report.actions.length).toBeGreaterThan(0);
    expect(report.actions.every((a) => a.status === "planned")).toBe(true);
  });
});

describe("readReleaseStatus", () => {
  it("prefers the in-progress version and flags a rejection", async () => {
    const api = makeApi({
      listAppStoreVersions: vi.fn().mockResolvedValue([
        { id: "v-live", versionString: "1.3.0", appStoreState: "READY_FOR_SALE" },
        { id: "v-rej", versionString: "1.4.0", appStoreState: "REJECTED", releaseType: "AFTER_APPROVAL" },
      ]),
    });
    const status = await readReleaseStatus(api, "app1");
    expect(status.versionString).toBe("1.4.0");
    expect(status.appStoreState).toBe("REJECTED");
    expect(status.rejected).toBe(true);
  });

  it("reports the live version's phased-release state when one is active", async () => {
    const api = makeApi({
      listAppStoreVersions: vi
        .fn()
        .mockResolvedValue([{ id: "v-live", versionString: "1.4.0", appStoreState: "READY_FOR_SALE" }]),
      getPhasedRelease: vi.fn().mockResolvedValue({ id: "ph1", phasedReleaseState: "ACTIVE" }),
    });
    const status = await readReleaseStatus(api, "app1");
    expect(status).toMatchObject({
      versionString: "1.4.0",
      appStoreState: "READY_FOR_SALE",
      phasedReleaseState: "ACTIVE",
    });
    expect(status.rejected).toBe(false);
  });

  it("returns nulls when the app has no versions", async () => {
    const api = makeApi();
    expect(await readReleaseStatus(api, "app1")).toEqual({ versionString: null, appStoreState: null, rejected: false });
  });
});

describe("controlPhasedRelease", () => {
  it("pauses the live version's phased rollout", async () => {
    const api = makeApi({
      listAppStoreVersions: vi
        .fn()
        .mockResolvedValue([{ id: "v-live", versionString: "1.4.0", appStoreState: "READY_FOR_SALE" }]),
      getPhasedRelease: vi.fn().mockResolvedValue({ id: "ph1", phasedReleaseState: "ACTIVE" }),
    });
    const result = await controlPhasedRelease(api, "app1", "pause");
    expect(api.updatePhasedRelease).toHaveBeenCalledWith("ph1", "PAUSE");
    expect(result).toEqual({ versionString: "1.4.0", from: "ACTIVE", to: "PAUSE" });
  });

  it("throws when no phased release is underway", async () => {
    const api = makeApi({
      listAppStoreVersions: vi
        .fn()
        .mockResolvedValue([{ id: "v-live", versionString: "1.4.0", appStoreState: "READY_FOR_SALE" }]),
    });
    await expect(controlPhasedRelease(api, "app1", "complete")).rejects.toThrow(/No phased release/);
  });
});
