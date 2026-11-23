import { describe, expect, test } from 'vitest';
import {
  createPermissionReason,
  createServiceDisabledReason,
  readGa4Error,
  readProjectIdFromClientEmail,
} from './ga4-client.ts';
function describeReadGa4Error() {
  function readsADisabledAPIBeforeAPermissionError() {
    const errorReading = readGa4Error(403, {
      error: {
        status: 'PERMISSION_DENIED',
        message: 'off',
        details: [{ reason: 'SERVICE_DISABLED' }],
      },
    });

    expect(errorReading).toEqual({ kind: 'service-disabled', message: 'off' });
  }

  test('reads a disabled API before a permission error', readsADisabledAPIBeforeAPermissionError);

  function readsA403PERMISSIONDENIEDAsPermissionDenied() {
    const errorReading = readGa4Error(403, { error: { status: 'PERMISSION_DENIED' } });

    expect(errorReading.kind).toBe('permission-denied');
  }

  test(
    'reads a 403 PERMISSION_DENIED as permission denied',
    readsA403PERMISSIONDENIEDAsPermissionDenied,
  );

  function readsAnyOtherStatusAsOtherWithTheGoogleMessage() {
    const errorReading = readGa4Error(429, { error: { message: 'slow down' } });

    expect(errorReading).toEqual({ kind: 'other', message: 'slow down' });
  }

  test(
    'reads any other status as other with the Google message',
    readsAnyOtherStatusAsOtherWithTheGoogleMessage,
  );

  function fallsBackToTheHTTPStatusWhenThePieceIsNotAGoogleError() {
    const errorReading = readGa4Error(502, 'bad gateway');

    expect(errorReading).toEqual({
      kind: 'other',
      message: 'Google Analytics replied with HTTP 502',
    });
  }

  test(
    'falls back to the HTTP status when the body is not a Google error',
    fallsBackToTheHTTPStatusWhenThePieceIsNotAGoogleError,
  );
}

describe('readGa4Error', describeReadGa4Error);
function describeReadProjectIdFromClientEmail() {
  function readsTheProjectIdOfAServiceAccountEmail() {
    const projectIdFromClientEmail = readProjectIdFromClientEmail(
      'bot@my-project-1.iam.gserviceaccount.com',
    );
    expect(projectIdFromClientEmail).toBe('my-project-1');
  }

  test('reads the project id of a service account email', readsTheProjectIdOfAServiceAccountEmail);

  function returnsNullForAnEmailThatIsNotAServiceAccount() {
    const projectIdFromClientEmail = readProjectIdFromClientEmail('person@example.com');
    expect(projectIdFromClientEmail).toBeNull();
  }

  test(
    'returns null for an email that is not a service account',
    returnsNullForAnEmailThatIsNotAServiceAccount,
  );
}

describe('readProjectIdFromClientEmail', describeReadProjectIdFromClientEmail);
function describeCreateServiceDisabledReason() {
  function namesTheAPIWithoutALinkWhenTheProjectIdIsUnknown() {
    const serviceDisabledReason = createServiceDisabledReason(
      'https://analyticsdata.googleapis.com/v1beta/x',
      null,
    );

    expect(serviceDisabledReason).toBe(
      'Enable the analyticsdata.googleapis.com API for the project of the launch Google service account',
    );
  }

  test(
    'names the API without a link when the project id is unknown',
    namesTheAPIWithoutALinkWhenTheProjectIdIsUnknown,
  );
}

describe('createServiceDisabledReason', describeCreateServiceDisabledReason);
function describeCreatePermissionReason() {
  function namesThePropertyWhenThereIsOne() {
    const permissionReason = createPermissionReason('42');
    expect(permissionReason).toBe(
      'Add the launch Google service account as a Viewer on GA4 property 42',
    );
  }

  test('names the property when there is one', namesThePropertyWhenThereIsOne);
}

describe('createPermissionReason', describeCreatePermissionReason);
