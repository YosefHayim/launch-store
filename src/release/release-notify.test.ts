import { describe, expect, it } from 'vitest';
import {
  createTransitionTracker,
  planTransitionNotifications,
  reviewStatusForVerdict,
} from './release-notify.ts';
import { classifyVerdict, type ReleaseStatus } from './app-store-release.ts';
/** A minimal {@link ReleaseStatus} for one poll; `appStoreState` drives the verdict unless overridden. */
function status(over: Partial<ReleaseStatus> = {}): ReleaseStatus {
  const base: ReleaseStatus = {
    bundleId: 'com.acme.app',
    versionString: '1.2.0',
    appStoreState: 'IN_REVIEW',
    buildNumber: '42',
    buildProcessingState: 'VALID',
    phasedReleaseState: null,
    verdict: classifyVerdict('IN_REVIEW'),
  };
  const merged: ReleaseStatus = { ...base, ...over };
  if (over.appStoreState != null && over.verdict == null) {
    let appStoreState = over.appStoreState;
    if (appStoreState == null) appStoreState = '';
    merged.verdict = classifyVerdict(appStoreState);
  }
  return merged;
}
function describeReviewStatusForVerdict() {
  function notifiesRejectedOnARejection() {
    const verdict = classifyVerdict('REJECTED');
    expect(reviewStatusForVerdict(verdict)).toBe('rejected');
  }

  it('notifies rejected on a rejection', notifiesRejectedOnARejection);
  function notifiesApprovedOnAReleasedVerdict() {
    const verdict = classifyVerdict('READY_FOR_SALE');
    expect(reviewStatusForVerdict(verdict)).toBe('approved');
  }

  it('notifies approved on a released verdict', notifiesApprovedOnAReleasedVerdict);
  function notifiesApprovedOnAPendingReleaseVerdict() {
    const verdict = classifyVerdict('PENDING_DEVELOPER_RELEASE');
    expect(reviewStatusForVerdict(verdict)).toBe('approved');
  }

  it('notifies approved on a pending-release verdict', notifiesApprovedOnAPendingReleaseVerdict);
  function staysSilentWhileInReview() {
    const verdict = classifyVerdict('IN_REVIEW');
    expect(reviewStatusForVerdict(verdict)).toBeNull();
  }

  it('stays silent while in review', staysSilentWhileInReview);
  function staysSilentOnAPreparingNotYetSubmittedVerdict() {
    const verdict = classifyVerdict('PREPARE_FOR_SUBMISSION');
    expect(reviewStatusForVerdict(verdict)).toBeNull();
  }

  it(
    'stays silent on a preparing (not-yet-submitted) verdict',
    staysSilentOnAPreparingNotYetSubmittedVerdict,
  );
}

describe('reviewStatusForVerdict', describeReviewStatusForVerdict);
function describePlanTransitionNotificationsReview() {
  function notifiesARealVerdictEvenAfterAnEarlierSilentTerminalPiece() {
    const tracker = createTransitionTracker();
    // `PREPARE_FOR_SUBMISSION` is terminal (`verdict.done`) but not a review outcome, so it must stay
    // silent AND must not mark the app reviewed - otherwise a later approved/rejected ping is suppressed.
    const transitionNotifications = planTransitionNotifications(
      'alpha',
      status({ appStoreState: 'PREPARE_FOR_SUBMISSION' }),
      tracker,
    );
    expect(transitionNotifications).toEqual([]);
    expect(tracker.reviewed.size).toBe(0);
    const events = planTransitionNotifications(
      'alpha',
      status({ appStoreState: 'REJECTED' }),
      tracker,
    );
    expect(events).toEqual([
      expect.objectContaining({
        event: 'review',
        status: 'rejected',
        app: 'alpha',
        platform: 'ios',
        version: '1.2.0',
      }),
    ]);
    expect(tracker.reviewed.size).toBe(1);
  }

  it(
    'notifies a real verdict even after an earlier silent terminal state',
    notifiesARealVerdictEvenAfterAnEarlierSilentTerminalPiece,
  );
  function firesAnApprovedReviewOnceThenStaysSilentOnRepeatPolls() {
    const tracker = createTransitionTracker();
    const transitionNotifications = planTransitionNotifications(
      'alpha',
      status({ appStoreState: 'READY_FOR_SALE' }),
      tracker,
    );
    expect(transitionNotifications).toEqual([
      expect.objectContaining({ event: 'review', status: 'approved', app: 'alpha' }),
    ]);
    expect(
      planTransitionNotifications('alpha', status({ appStoreState: 'READY_FOR_SALE' }), tracker),
    ).toEqual([]);
  }

  it(
    'fires an approved review once, then stays silent on repeat polls',
    firesAnApprovedReviewOnceThenStaysSilentOnRepeatPolls,
  );
  function staysSilentWhileTheVerdictIsStillInProgress() {
    const tracker = createTransitionTracker();
    const transitionNotifications = planTransitionNotifications(
      'alpha',
      status({ appStoreState: 'IN_REVIEW' }),
      tracker,
    );
    expect(transitionNotifications).toEqual([]);
    expect(tracker.reviewed.size).toBe(0);
  }

  it(
    'stays silent while the verdict is still in progress',
    staysSilentWhileTheVerdictIsStillInProgress,
  );
  function notifiesAgainForANewVersionOfTheSameAppInOneSession() {
    const tracker = createTransitionTracker();
    // v1.2.0 is rejected and notified.
    const transitionNotifications = planTransitionNotifications(
      'alpha',
      status({ appStoreState: 'REJECTED' }),
      tracker,
    );
    expect(transitionNotifications).toEqual([
      expect.objectContaining({ event: 'review', status: 'rejected', version: '1.2.0' }),
    ]);
    // A resubmitted v1.2.1 of the same app must still notify on its own verdict - the prior version's
    // state must not leak across the version change.
    const events = planTransitionNotifications(
      'alpha',
      status({ appStoreState: 'READY_FOR_SALE', versionString: '1.2.1' }),
      tracker,
    );
    expect(events).toEqual([
      expect.objectContaining({ event: 'review', status: 'approved', version: '1.2.1' }),
    ]);
  }

  it(
    'notifies again for a new version of the same app in one session',
    notifiesAgainForANewVersionOfTheSameAppInOneSession,
  );
}

describe('planTransitionNotifications - review', describePlanTransitionNotificationsReview);
function describePlanTransitionNotificationsRollout() {
  function treatsTheFirstPhasedPieceAsASilentBaselineThenNotifiesEachChangeOnce() {
    const tracker = createTransitionTracker();
    // Held at IN_REVIEW (not terminal) so the rollout transition is exercised without a review ping.
    const transitionNotifications = planTransitionNotifications(
      'alpha',
      status({ phasedReleaseState: 'INACTIVE' }),
      tracker,
    );
    expect(transitionNotifications).toEqual([]);
    const advanced = planTransitionNotifications(
      'alpha',
      status({ phasedReleaseState: 'ACTIVE' }),
      tracker,
    );
    expect(advanced).toEqual([
      expect.objectContaining({
        event: 'rollout',
        status: 'advanced',
        app: 'alpha',
        detail: 'ACTIVE',
      }),
    ]);
    expect(
      planTransitionNotifications('alpha', status({ phasedReleaseState: 'ACTIVE' }), tracker),
    ).toEqual([]);
  }

  it(
    'treats the first phased state as a silent baseline, then notifies each change once',
    treatsTheFirstPhasedPieceAsASilentBaselineThenNotifiesEachChangeOnce,
  );
  function tracksPhasedPiecePerAppIndependently() {
    const tracker = createTransitionTracker();
    planTransitionNotifications('alpha', status({ phasedReleaseState: 'ACTIVE' }), tracker);
    // beta's first observation is its own baseline, regardless of alpha's state.
    const transitionNotifications = planTransitionNotifications(
      'beta',
      status({ phasedReleaseState: 'ACTIVE' }),
      tracker,
    );
    expect(transitionNotifications).toEqual([]);
  }

  it('tracks phased state per app independently', tracksPhasedPiecePerAppIndependently);
}

describe('planTransitionNotifications - rollout', describePlanTransitionNotificationsRollout);
