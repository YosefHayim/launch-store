// Calls Google Analytics Admin and Data while a stats sync is reading one app.

import { errorMessage } from '@/services/platform/error-message.js';
import type { StatsFeedFailure } from '@/types/stats.js';
import { readPlainObject } from '@/services/platform/plain-object.js';
import { isFailureTag } from '@/services/platform/tagged-failure.js';

export const ANALYTICS_ADMIN_URL = 'https://analyticsadmin.googleapis.com/v1beta';
export const ANALYTICS_DATA_URL = 'https://analyticsdata.googleapis.com/v1beta';
const httpForbidden = 403;

export interface Ga4Session {
  readonly appKey: string;
  readonly accessToken: string;
  readonly projectId: string | null;
}

interface Ga4Call {
  readonly url: string;
  readonly requestDocument: unknown;
  readonly propertyId: string | null;
}

type Ga4SkipSignal = Readonly<{
  readonly _tag: 'Ga4SkipSignal';
  readonly reason: string;
}>;

type Ga4ErrorKind = 'permission-denied' | 'service-disabled' | 'other';

interface Ga4ErrorReading {
  readonly kind: Ga4ErrorKind;
  readonly message: string;
}

interface FetchReply {
  readonly status: number;
  readonly documentText: string;
}

function makeGa4SkipSignal(reason: string): Ga4SkipSignal {
  return { _tag: 'Ga4SkipSignal', reason };
}

function makeStatsFeedFailure(fields: {
  message: string;
  cause: unknown;
  appKey: string;
}): StatsFeedFailure {
  return {
    _tag: 'StatsFeedFailure',
    feed: 'ga4',
    appKey: fields.appKey,
    message: fields.message,
    cause: fields.cause,
  };
}

export function createGa4Failure(
  session: Ga4Session,
  message: string,
  cause: unknown,
): StatsFeedFailure {
  return makeStatsFeedFailure({ appKey: session.appKey, message, cause });
}

export function isGa4SkipSignal(cause: unknown): cause is Ga4SkipSignal {
  return isFailureTag(cause, 'Ga4SkipSignal');
}

function readGoogleMessage(googleMessage: string, fallbackMessage: string): string {
  if (googleMessage == '') {
    return fallbackMessage;
  }

  return googleMessage;
}

function hasServiceDisabledReason(details: unknown): boolean {
  if (Array.isArray(details) == false) {
    return false;
  }

  function isDisabled(detail: unknown): boolean {
    const detailObject = readPlainObject(detail);

    if (detailObject == null) {
      return false;
    }

    return detailObject['reason'] == 'SERVICE_DISABLED';
  }

  return details.some(isDisabled);
}

/** Google reports a disabled API as 403 too, so the SERVICE_DISABLED reason wins over PERMISSION_DENIED. */
export function readGa4Error(httpStatus: number, errorDocument: unknown): Ga4ErrorReading {
  const fallbackMessage = `Google Analytics replied with HTTP ${httpStatus}`;

  const errorDocumentObject = readPlainObject(errorDocument);

  if (errorDocumentObject == null) {
    return { kind: 'other', message: fallbackMessage };
  }

  const googleError = errorDocumentObject['error'];

  const googleErrorObject = readPlainObject(googleError);

  if (googleErrorObject == null) {
    return { kind: 'other', message: fallbackMessage };
  }

  let googleMessage = '';

  if (typeof googleErrorObject['message'] == 'string') {
    googleMessage = googleErrorObject['message'];
  }

  const message = readGoogleMessage(googleMessage, fallbackMessage);

  const isServiceDisabled = hasServiceDisabledReason(googleErrorObject['details']);

  if (isServiceDisabled) {
    return { kind: 'service-disabled', message };
  }

  const isForbidden = httpStatus == httpForbidden;
  const isPermissionStatus = googleErrorObject['status'] == 'PERMISSION_DENIED';

  if (isForbidden == false) {
    return { kind: 'other', message };
  }

  if (isPermissionStatus == false) {
    return { kind: 'other', message };
  }

  return { kind: 'permission-denied', message };
}

/** A service account email ends in `@<project id>.iam.gserviceaccount.com`; only the project id is read. */
export function readProjectIdFromClientEmail(clientEmail: string): string | null {
  // The project id is the label between @ and .iam.gserviceaccount.com.
  const projectIdCapture = /@([a-z][a-z0-9-]*)\.iam\.gserviceaccount\.com$/.exec(clientEmail);

  if (projectIdCapture == null) {
    return null;
  }

  const projectId = projectIdCapture[1];

  if (projectId == null) {
    return null;
  }

  return projectId;
}

export function createPermissionReason(propertyId: string | null): string {
  if (propertyId == null) {
    return 'Google Analytics refused to list properties; add the launch Google service account as a Viewer on a GA4 property';
  }

  return `Add the launch Google service account as a Viewer on GA4 property ${propertyId}`;
}

export function createServiceDisabledReason(url: string, projectId: string | null): string {
  const apiHost = new URL(url).host;

  if (projectId == null) {
    return `Enable the ${apiHost} API for the project of the launch Google service account`;
  }

  const enableLink = `https://console.developers.google.com/apis/api/${apiHost}/overview?project=${projectId}`;

  return `Enable the ${apiHost} API for the launch Google service account project: ${enableLink}`;
}

function isHttpSuccess(status: number): boolean {
  if (status < 200) {
    return false;
  }

  return status <= 299;
}

async function fetchGa4Get(url: string, accessToken: string): Promise<FetchReply> {
  const httpReply = await fetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const documentText = await httpReply.text();

  return { status: httpReply.status, documentText };
}

async function fetchGa4Post(
  url: string,
  accessToken: string,
  requestDocument: unknown,
): Promise<FetchReply> {
  const serialized = JSON.stringify(requestDocument);
  const httpReply = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: serialized,
  });
  const documentText = await httpReply.text();

  return { status: httpReply.status, documentText };
}

async function fetchGa4(call: Ga4Call, accessToken: string): Promise<FetchReply> {
  const isGet = call.requestDocument == null;

  if (isGet) {
    return fetchGa4Get(call.url, accessToken);
  }

  return fetchGa4Post(call.url, accessToken, call.requestDocument);
}

function readJsonDocument(session: Ga4Session, reply: FetchReply): unknown {
  try {
    return JSON.parse(reply.documentText);
  } catch (cause) {
    const failureMessage = errorMessage(cause);

    throw createGa4Failure(
      session,
      `Google Analytics reply (HTTP ${reply.status}) was not JSON: ${failureMessage}`,
      cause,
    );
  }
}

/** One Google Analytics call: a 2xx body comes back, permission and disabled-API errors become a skip signal. */
export async function requestGa4Document(session: Ga4Session, call: Ga4Call): Promise<unknown> {
  let analyticsReply: FetchReply;

  try {
    analyticsReply = await fetchGa4(call, session.accessToken);
  } catch (cause) {
    const failureMessage = errorMessage(cause);
    throw createGa4Failure(session, `Google Analytics request failed: ${failureMessage}`, cause);
  }

  const analyticsDocument = readJsonDocument(session, analyticsReply);

  const isSuccess = isHttpSuccess(analyticsReply.status);

  if (isSuccess) {
    return analyticsDocument;
  }

  const errorReading = readGa4Error(analyticsReply.status, analyticsDocument);

  if (errorReading.kind == 'permission-denied') {
    const permissionReason = createPermissionReason(call.propertyId);
    throw makeGa4SkipSignal(permissionReason);
  }

  if (errorReading.kind == 'service-disabled') {
    const serviceDisabledReason = createServiceDisabledReason(call.url, session.projectId);
    throw makeGa4SkipSignal(serviceDisabledReason);
  }

  throw createGa4Failure(
    session,
    `Google Analytics error: ${errorReading.message}`,
    analyticsDocument,
  );
}
