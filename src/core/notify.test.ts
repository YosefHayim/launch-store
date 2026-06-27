import { describe, expect, it } from 'vitest';
import { notifyEnv, notifyMessage, notifyPayload, type NotifyEvent } from './notify.js';

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
  detail: 'Rejected — open Resolution Center in App Store Connect',
};

const advanced: NotifyEvent = {
  event: 'rollout',
  status: 'advanced',
  app: 'acme',
  platform: 'ios',
  version: '1.2.3',
  detail: 'ACTIVE',
};

describe('notifyMessage', () => {
  it('summarizes a success with build number and destination', () => {
    expect(notifyMessage(success)).toBe('✅ Launch: acme 1.2.3 (42) submit succeeded → TestFlight');
  });

  it('summarizes a failure with the error', () => {
    expect(notifyMessage(failure)).toBe(
      '❌ Launch: acme 1.2.3 — build failed: gradle exited with code 1',
    );
  });

  it('summarizes an approved review with its detail', () => {
    expect(notifyMessage(approved)).toBe(
      '✅ Launch: acme 1.2.3 — review approved: Live on the App Store',
    );
  });

  it('summarizes a rejected review with its detail', () => {
    expect(notifyMessage(rejected)).toBe(
      '❌ Launch: acme 1.2.3 — review rejected: Rejected — open Resolution Center in App Store Connect',
    );
  });

  it('summarizes a rollout advance with the phased state', () => {
    expect(notifyMessage(advanced)).toBe('🚀 Launch: acme 1.2.3 — rollout advanced (ACTIVE)');
  });
});

describe('notifyPayload', () => {
  it('sets both text (Slack) and content (Discord) to the message and carries the event fields', () => {
    const payload = notifyPayload(success);
    const message = notifyMessage(success);
    expect(payload['text']).toBe(message);
    expect(payload['content']).toBe(message);
    expect(payload['status']).toBe('success');
    expect(payload['buildNumber']).toBe(42);
  });

  it('carries the review event fields', () => {
    const payload = notifyPayload(approved);
    expect(payload['text']).toBe(notifyMessage(approved));
    expect(payload['event']).toBe('review');
    expect(payload['status']).toBe('approved');
    expect(payload['detail']).toBe('Live on the App Store');
  });

  it('carries the rollout event fields', () => {
    const payload = notifyPayload(advanced);
    expect(payload['event']).toBe('rollout');
    expect(payload['status']).toBe('advanced');
    expect(payload['detail']).toBe('ACTIVE');
  });
});

describe('notifyEnv', () => {
  it('exposes the core fields as LAUNCH_* strings', () => {
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
  });

  it('omits absent optional fields and includes the error on failure', () => {
    const env = notifyEnv(failure);
    expect(env['LAUNCH_BUILD_NUMBER']).toBeUndefined();
    expect(env['LAUNCH_DESTINATION']).toBeUndefined();
    expect(env['LAUNCH_ERROR']).toBe('gradle exited with code 1');
    expect(env['LAUNCH_DETAIL']).toBeUndefined();
  });

  it('exposes LAUNCH_DETAIL for a review event and no completion-only fields', () => {
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
  });

  it('exposes LAUNCH_DETAIL for a rollout event', () => {
    const env = notifyEnv(advanced);
    expect(env['LAUNCH_EVENT']).toBe('rollout');
    expect(env['LAUNCH_STATUS']).toBe('advanced');
    expect(env['LAUNCH_DETAIL']).toBe('ACTIVE');
  });

  it('omits LAUNCH_DETAIL on a completion event', () => {
    expect(notifyEnv(success)['LAUNCH_DETAIL']).toBeUndefined();
  });
});
