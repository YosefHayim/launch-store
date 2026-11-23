// Decides which review and phased-rollout notices a status watch should send.

import type { ReleaseStatus, ReleaseVerdict } from './app-store-release.ts';
import type { NotifyEvent } from '../services/platform/notify.ts';

/** Memory of what's already been notified, owned by the watch loop for its lifetime. */
type TransitionTracker = {
  reviewed: Set<string>;
  lastPhasedState: Map<string, string>;
};

/** A fresh tracker for one `--watch` session. */
export function createTransitionTracker(): TransitionTracker {
  return { reviewed: new Set<string>(), lastPhasedState: new Map<string, string>() };
}

/** The review notification status for a verdict */
export function reviewStatusForVerdict(verdict: ReleaseVerdict): 'approved' | 'rejected' | null {
  if (verdict.state == 'rejected') return 'rejected';

  if (verdict.state == 'released') return 'approved';

  if (verdict.state == 'pending-release') return 'approved';

  return null;
}

/** Decide which notifications one app's latest reading should fire */
export function planTransitionNotifications(
  appName: string,
  status: ReleaseStatus,
  tracker: TransitionTracker,
): NotifyEvent[] {
  const events: NotifyEvent[] = [];
  let version = status.versionString;

  if (version == null) version = '';

  if (version == null) version = '';

  // Key transition memory by app *and* version so a new release of the same app during one watch
  // session is a fresh review/rollout, not blocked by the prior version's already-notified state.
  const key = `${appName}@${version}`;

  if (status.verdict.done && !tracker.reviewed.has(key)) {
    const reviewStatus = reviewStatusForVerdict(status.verdict);

    if (reviewStatus) {
      tracker.reviewed.add(key);
      events.push({
        event: 'review',
        status: reviewStatus,
        app: appName,
        platform: 'ios',
        version,
        detail: status.verdict.label,
      });
    }
  }

  const phased = status.phasedReleaseState;

  if (phased && tracker.lastPhasedState.get(key) != phased) {
    const isFirstObservation = !tracker.lastPhasedState.has(key);

    tracker.lastPhasedState.set(key, phased);

    if (!isFirstObservation) {
      events.push({
        event: 'rollout',
        status: 'advanced',
        app: appName,
        platform: 'ios',
        version,
        detail: phased,
      });
    }
  }

  return events;
}
