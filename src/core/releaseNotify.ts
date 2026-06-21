/**
 * Bridge from an App Store release reading to {@link NotifyEvent}s — the domain logic behind
 * `launch status --watch`'s review/rollout notifications, kept out of the thin CLI so it's unit-tested.
 *
 * `--watch` re-reads every app each poll. To ping a dev *once* per transition (not every 30s), the
 * watch loop carries a {@link TransitionTracker} across polls and feeds each fresh reading through
 * {@link planTransitionNotifications}, which decides what (if anything) changed and updates the tracker.
 * Everything here is iOS-only: the App Store review verdict and phased rollout are iOS concepts.
 */

import type { ReleaseStatus, ReleaseVerdict } from "./appStoreRelease.js";
import type { NotifyEvent } from "./notify.js";

/**
 * Memory of what's already been notified, owned by the watch loop for its lifetime. Keyed per
 * `(app, version)` — a developer can ship a new version of the same app mid-session (e.g. resubmit
 * after a rejection while another app keeps the loop alive), and that fresh release must not inherit
 * the prior version's state. `reviewed` holds the keys whose review verdict has already pinged;
 * `lastPhasedState` is each key's last seen phased-release state, so a change between polls reads as a
 * rollout advance.
 */
export interface TransitionTracker {
  reviewed: Set<string>;
  lastPhasedState: Map<string, string>;
}

/** A fresh tracker for one `--watch` session. */
export function createTransitionTracker(): TransitionTracker {
  return { reviewed: new Set<string>(), lastPhasedState: new Map<string, string>() };
}

/**
 * The review notification status for a verdict, or `null` when the transition isn't worth a ping.
 * A rejection notifies `rejected`; a `released`/`pending-release` verdict notifies `approved`. Other
 * settled verdicts (`preparing`, `unknown`) don't represent a review outcome, so they stay silent even
 * though their `verdict.done` is true. Pure.
 */
export function reviewStatusForVerdict(verdict: ReleaseVerdict): "approved" | "rejected" | null {
  if (verdict.state === "rejected") return "rejected";
  if (verdict.state === "released" || verdict.state === "pending-release") return "approved";
  return null;
}

/**
 * Decide which notifications one app's latest reading should fire, mutating `tracker` so each transition
 * pings at most once across the whole watch:
 * - **review** the first time the app settles to a notify-worthy verdict. The app is marked reviewed
 *   *only when it actually notifies* — a terminal-but-silent verdict (e.g. not-yet-submitted) must not
 *   block a later approved/rejected ping if the app re-enters review.
 * - **rollout `advanced`** whenever the phased-release state changes to a new non-null value between
 *   polls. The first observed state is a silent baseline (we can't tell a fresh ramp from a resumed one).
 */
export function planTransitionNotifications(
  appName: string,
  status: ReleaseStatus,
  tracker: TransitionTracker,
): NotifyEvent[] {
  const events: NotifyEvent[] = [];
  const version = status.versionString ?? "";
  // Key transition memory by app *and* version so a new release of the same app during one watch
  // session is a fresh review/rollout, not blocked by the prior version's already-notified state.
  const key = `${appName}@${version}`;

  if (status.verdict.done && !tracker.reviewed.has(key)) {
    const reviewStatus = reviewStatusForVerdict(status.verdict);
    if (reviewStatus) {
      tracker.reviewed.add(key);
      events.push({
        event: "review",
        status: reviewStatus,
        app: appName,
        platform: "ios",
        version,
        detail: status.verdict.label,
      });
    }
  }

  const phased = status.phasedReleaseState;
  if (phased && tracker.lastPhasedState.get(key) !== phased) {
    const isFirstObservation = !tracker.lastPhasedState.has(key);
    tracker.lastPhasedState.set(key, phased);
    if (!isFirstObservation) {
      events.push({ event: "rollout", status: "advanced", app: appName, platform: "ios", version, detail: phased });
    }
  }

  return events;
}
