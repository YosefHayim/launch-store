import { describe, expect, it } from "vitest";
import { createTransitionTracker, planTransitionNotifications, reviewStatusForVerdict } from "./releaseNotify.js";
import { classifyVerdict, type ReleaseStatus } from "./appStoreRelease.js";

/** A minimal {@link ReleaseStatus} for one poll; `appStoreState` drives the verdict unless overridden. */
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

describe("planTransitionNotifications — review", () => {
  it("notifies a real verdict even after an earlier silent terminal state", () => {
    const tracker = createTransitionTracker();
    // `PREPARE_FOR_SUBMISSION` is terminal (`verdict.done`) but not a review outcome, so it must stay
    // silent AND must not mark the app reviewed — otherwise a later approved/rejected ping is suppressed.
    expect(planTransitionNotifications("alpha", status({ appStoreState: "PREPARE_FOR_SUBMISSION" }), tracker)).toEqual(
      [],
    );
    expect(tracker.reviewed.size).toBe(0);

    const events = planTransitionNotifications("alpha", status({ appStoreState: "REJECTED" }), tracker);
    expect(events).toEqual([
      expect.objectContaining({ event: "review", status: "rejected", app: "alpha", platform: "ios", version: "1.2.0" }),
    ]);
    expect(tracker.reviewed.size).toBe(1);
  });

  it("fires an approved review once, then stays silent on repeat polls", () => {
    const tracker = createTransitionTracker();
    expect(planTransitionNotifications("alpha", status({ appStoreState: "READY_FOR_SALE" }), tracker)).toEqual([
      expect.objectContaining({ event: "review", status: "approved", app: "alpha" }),
    ]);
    expect(planTransitionNotifications("alpha", status({ appStoreState: "READY_FOR_SALE" }), tracker)).toEqual([]);
  });

  it("stays silent while the verdict is still in progress", () => {
    const tracker = createTransitionTracker();
    expect(planTransitionNotifications("alpha", status({ appStoreState: "IN_REVIEW" }), tracker)).toEqual([]);
    expect(tracker.reviewed.size).toBe(0);
  });

  it("notifies again for a new version of the same app in one session", () => {
    const tracker = createTransitionTracker();
    // v1.2.0 is rejected and notified.
    expect(planTransitionNotifications("alpha", status({ appStoreState: "REJECTED" }), tracker)).toEqual([
      expect.objectContaining({ event: "review", status: "rejected", version: "1.2.0" }),
    ]);
    // A resubmitted v1.2.1 of the same app must still notify on its own verdict — the prior version's
    // state must not leak across the version change.
    const events = planTransitionNotifications(
      "alpha",
      status({ appStoreState: "READY_FOR_SALE", versionString: "1.2.1" }),
      tracker,
    );
    expect(events).toEqual([expect.objectContaining({ event: "review", status: "approved", version: "1.2.1" })]);
  });
});

describe("planTransitionNotifications — rollout", () => {
  it("treats the first phased state as a silent baseline, then notifies each change once", () => {
    const tracker = createTransitionTracker();
    // Held at IN_REVIEW (not terminal) so the rollout transition is exercised without a review ping.
    expect(planTransitionNotifications("alpha", status({ phasedReleaseState: "INACTIVE" }), tracker)).toEqual([]);

    const advanced = planTransitionNotifications("alpha", status({ phasedReleaseState: "ACTIVE" }), tracker);
    expect(advanced).toEqual([
      expect.objectContaining({ event: "rollout", status: "advanced", app: "alpha", detail: "ACTIVE" }),
    ]);

    expect(planTransitionNotifications("alpha", status({ phasedReleaseState: "ACTIVE" }), tracker)).toEqual([]);
  });

  it("tracks phased state per app independently", () => {
    const tracker = createTransitionTracker();
    planTransitionNotifications("alpha", status({ phasedReleaseState: "ACTIVE" }), tracker);
    // beta's first observation is its own baseline, regardless of alpha's state.
    expect(planTransitionNotifications("beta", status({ phasedReleaseState: "ACTIVE" }), tracker)).toEqual([]);
  });
});
