import { describe, expect, test } from 'vitest';
import {
  createPermissionReason,
  createServiceDisabledReason,
  readGa4Error,
  readProjectIdFromClientEmail,
} from './ga4-client.ts';

describe('readGa4Error', () => {
  test('reads a disabled API before a permission error', () => {
    const errorReading = readGa4Error(403, {
      error: {
        status: 'PERMISSION_DENIED',
        message: 'off',
        details: [{ reason: 'SERVICE_DISABLED' }],
      },
    });

    expect(errorReading).toEqual({ kind: 'service-disabled', message: 'off' });
  });

  test('reads a 403 PERMISSION_DENIED as permission denied', () => {
    const errorReading = readGa4Error(403, { error: { status: 'PERMISSION_DENIED' } });

    expect(errorReading.kind).toBe('permission-denied');
  });

  test('reads any other status as other with the Google message', () => {
    const errorReading = readGa4Error(429, { error: { message: 'slow down' } });

    expect(errorReading).toEqual({ kind: 'other', message: 'slow down' });
  });

  test('falls back to the HTTP status when the body is not a Google error', () => {
    const errorReading = readGa4Error(502, 'bad gateway');

    expect(errorReading).toEqual({
      kind: 'other',
      message: 'Google Analytics replied with HTTP 502',
    });
  });
});

describe('readProjectIdFromClientEmail', () => {
  test('reads the project id of a service account email', () => {
    const projectIdFromClientEmail = readProjectIdFromClientEmail(
      'bot@my-project-1.iam.gserviceaccount.com',
    );
    expect(projectIdFromClientEmail).toBe('my-project-1');
  });

  test('returns null for an email that is not a service account', () => {
    const projectIdFromClientEmail = readProjectIdFromClientEmail('person@example.com');
    expect(projectIdFromClientEmail).toBeNull();
  });
});

describe('createServiceDisabledReason', () => {
  test('names the API without a link when the project id is unknown', () => {
    const serviceDisabledReason = createServiceDisabledReason(
      'https://analyticsdata.googleapis.com/v1beta/x',
      null,
    );
    expect(serviceDisabledReason).toBe(
      'Enable the analyticsdata.googleapis.com API for the project of the launch Google service account',
    );
  });
});

describe('createPermissionReason', () => {
  test('names the property when there is one', () => {
    const permissionReason = createPermissionReason('42');
    expect(permissionReason).toBe(
      'Add the launch Google service account as a Viewer on GA4 property 42',
    );
  });
});
