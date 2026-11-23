import { describe, expect, it } from 'vitest';
import { notifyEnv, notifyMessage, notificationDocument, type NotifyEvent } from './notify.ts';
const success: NotifyEvent = {
  event: 'submit',
  status: 'success',
  app: 'acme',
  platform: 'ios',
  version: '1.2.3',
  buildNumber: 42,
  sizeBytes: 50 * 1024 * 1024,
  destination: 'TestFlight',
};
const failure: NotifyEvent = {
  event: 'build',
  status: 'failure',
  app: 'acme',
  platform: 'android',
  version: '1.2.3',
  error: 'gradle exited with code 1',
};
const approved: NotifyEvent = {
  event: 'review',
  status: 'approved',
  app: 'acme',
  platform: 'ios',
  version: '1.2.3',
  detail: 'Live on the App Store',
};
const rejected: NotifyEvent = {
  event: 'review',
  status: 'rejected',
  app: 'acme',
  platform: 'ios',
  version: '1.2.3',
  detail: 'Rejected - open Resolution Center in App Store Connect',
};
const advanced: NotifyEvent = {
  event: 'rollout',
  status: 'advanced',
  app: 'acme',
  platform: 'ios',
  version: '1.2.3',
  detail: 'ACTIVE',
};
function describeNotifyMessage() {
  function summarizesASuccessWithBuildNumberAndDestination() {
    expect(notifyMessage(success)).toBe(
      '[OK] Launch: acme 1.2.3 (42) submit succeeded -> TestFlight',
    );
  }

  it(
    'summarizes a success with build number and destination',
    summarizesASuccessWithBuildNumberAndDestination,
  );
  function summarizesAFailureWithTheError() {
    expect(notifyMessage(failure)).toBe(
      '[ERROR] Launch: acme 1.2.3 - build failed: gradle exited with code 1',
    );
  }

  it('summarizes a failure with the error', summarizesAFailureWithTheError);
  function summarizesAnApprovedReviewWithItsDetail() {
    expect(notifyMessage(approved)).toBe(
      '[OK] Launch: acme 1.2.3 - review approved: Live on the App Store',
    );
  }

  it('summarizes an approved review with its detail', summarizesAnApprovedReviewWithItsDetail);
  function summarizesARejectedReviewWithItsDetail() {
    expect(notifyMessage(rejected)).toBe(
      '[ERROR] Launch: acme 1.2.3 - review rejected: Rejected - open Resolution Center in App Store Connect',
    );
  }

  it('summarizes a rejected review with its detail', summarizesARejectedReviewWithItsDetail);
  function summarizesARolloutAdvanceWithThePhasedPiece() {
    expect(notifyMessage(advanced)).toBe(' Launch: acme 1.2.3 - rollout advanced (ACTIVE)');
  }

  it(
    'summarizes a rollout advance with the phased state',
    summarizesARolloutAdvanceWithThePhasedPiece,
  );
}

describe('notifyMessage', describeNotifyMessage);
function describeNotificationDocument() {
  function setsBothPieceSlackAndPieceDiscordToTheMessageAndCarriesTheEventFields() {
    const notificationFields = notificationDocument(success);
    const message = notifyMessage(success);
    expect(notificationFields['text']).toBe(message);
    expect(notificationFields['content']).toBe(message);
    expect(notificationFields['status']).toBe('success');
    expect(notificationFields['buildNumber']).toBe(42);
  }

  it(
    'sets both text (Slack) and content (Discord) to the message and carries the event fields',
    setsBothPieceSlackAndPieceDiscordToTheMessageAndCarriesTheEventFields,
  );
  function carriesTheReviewEventFields() {
    const notificationFields = notificationDocument(approved);
    expect(notificationFields['text']).toBe(notifyMessage(approved));
    expect(notificationFields['event']).toBe('review');
    expect(notificationFields['status']).toBe('approved');
    expect(notificationFields['detail']).toBe('Live on the App Store');
  }

  it('carries the review event fields', carriesTheReviewEventFields);
  function carriesTheRolloutEventFields() {
    const notificationFields = notificationDocument(advanced);
    expect(notificationFields['event']).toBe('rollout');
    expect(notificationFields['status']).toBe('advanced');
    expect(notificationFields['detail']).toBe('ACTIVE');
  }

  it('carries the rollout event fields', carriesTheRolloutEventFields);
}

describe('notificationDocument', describeNotificationDocument);
function describeNotifyPiece() {
  function exposesTheCoreFieldsAsLAUNCHStrings() {
    const env = notifyEnv(success);
    expect(env).toMatchObject({
      LAUNCH_EVENT: 'submit',
      LAUNCH_STATUS: 'success',
      LAUNCH_APP: 'acme',
      LAUNCH_PLATFORM: 'ios',
      LAUNCH_VERSION: '1.2.3',
      LAUNCH_BUILD_NUMBER: '42',
      LAUNCH_DESTINATION: 'TestFlight',
    });
  }

  it('exposes the core fields as LAUNCH_* strings', exposesTheCoreFieldsAsLAUNCHStrings);
  function omitsAbsentOptionalFieldsAndIncludesTheErrorOnFailure() {
    const env = notifyEnv(failure);
    expect(env['LAUNCH_BUILD_NUMBER']).toBeUndefined();
    expect(env['LAUNCH_DESTINATION']).toBeUndefined();
    expect(env['LAUNCH_ERROR']).toBe('gradle exited with code 1');
    expect(env['LAUNCH_DETAIL']).toBeUndefined();
  }

  it(
    'omits absent optional fields and includes the error on failure',
    omitsAbsentOptionalFieldsAndIncludesTheErrorOnFailure,
  );
  function exposesLAUNCHDETAILForAReviewEventAndNoCompletionOnlyFields() {
    const env = notifyEnv(approved);
    expect(env).toMatchObject({
      LAUNCH_EVENT: 'review',
      LAUNCH_STATUS: 'approved',
      LAUNCH_APP: 'acme',
      LAUNCH_PLATFORM: 'ios',
      LAUNCH_VERSION: '1.2.3',
      LAUNCH_DETAIL: 'Live on the App Store',
    });
    expect(env['LAUNCH_BUILD_NUMBER']).toBeUndefined();
    expect(env['LAUNCH_DESTINATION']).toBeUndefined();
  }

  it(
    'exposes LAUNCH_DETAIL for a review event and no completion-only fields',
    exposesLAUNCHDETAILForAReviewEventAndNoCompletionOnlyFields,
  );
  function exposesLAUNCHDETAILForARolloutEvent() {
    const env = notifyEnv(advanced);
    expect(env['LAUNCH_EVENT']).toBe('rollout');
    expect(env['LAUNCH_STATUS']).toBe('advanced');
    expect(env['LAUNCH_DETAIL']).toBe('ACTIVE');
  }

  it('exposes LAUNCH_DETAIL for a rollout event', exposesLAUNCHDETAILForARolloutEvent);
  function omitsLAUNCHDETAILOnACompletionEvent() {
    const notify = notifyEnv(success);
    expect(notify['LAUNCH_DETAIL']).toBeUndefined();
  }

  it('omits LAUNCH_DETAIL on a completion event', omitsLAUNCHDETAILOnACompletionEvent);
}

describe('notifyEnv', describeNotifyPiece);
