import { HttpClient, HttpClientRequest } from '@effect/platform';
import { Data, Effect, Option, Schema } from 'effect';
import { errorMessage } from '../../services/errorMessage.js';
import type { StatsFeedFailure } from '../../types/stats.js';

export const ANALYTICS_ADMIN_URL = 'https://analyticsadmin.googleapis.com/v1beta';
export const ANALYTICS_DATA_URL = 'https://analyticsdata.googleapis.com/v1beta';
const SERVICE_DISABLED_REASON = 'SERVICE_DISABLED';
const PERMISSION_DENIED_STATUS = 'PERMISSION_DENIED';
const HTTP_FORBIDDEN = 403;
const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 299;

export interface Ga4Session {
  readonly appKey: string;
  readonly accessToken: string;
  readonly projectId: string | null;
}

export interface Ga4Call {
  readonly url: string;
  readonly requestDocument: unknown;
  readonly propertyId: string | null;
}

type Ga4SkipSignal = Readonly<{
  readonly _tag: 'Ga4SkipSignal';
  readonly reason: string;
}>;

export type Ga4Failure = StatsFeedFailure | Ga4SkipSignal;

const makeGa4SkipSignal = Data.tagged<Ga4SkipSignal>('Ga4SkipSignal');
const makeStatsFeedFailure = Data.tagged<StatsFeedFailure>('StatsFeedFailure');

export const createGa4Failure = (
  session: Ga4Session,
  message: string,
  cause: unknown,
): StatsFeedFailure =>
  makeStatsFeedFailure({ feed: 'ga4', appKey: session.appKey, message, cause });

const Ga4ErrorReplySchema = Schema.Struct({
  error: Schema.Struct({
    status: Schema.optional(Schema.String),
    message: Schema.optionalWith(Schema.String, { default: () => '' }),
    details: Schema.optionalWith(
      Schema.Array(Schema.Struct({ reason: Schema.optional(Schema.String) })),
      { default: () => [] },
    ),
  }),
});

type Ga4ErrorKind = 'permission-denied' | 'service-disabled' | 'other';

interface Ga4ErrorReading {
  readonly kind: Ga4ErrorKind;
  readonly message: string;
}

const readGoogleMessage = (googleMessage: string, fallbackMessage: string): string => {
  if (googleMessage === '') return fallbackMessage;
  return googleMessage;
};

/** Google reports a disabled API as 403 too, so the SERVICE_DISABLED reason wins over PERMISSION_DENIED. */
export const readGa4Error = (httpStatus: number, errorDocument: unknown): Ga4ErrorReading => {
  const decodedErrorReply = Schema.decodeUnknownOption(Ga4ErrorReplySchema)(errorDocument);
  const fallbackMessage = `Google Analytics replied with HTTP ${httpStatus}`;
  if (Option.isNone(decodedErrorReply)) return { kind: 'other', message: fallbackMessage };
  const googleError = decodedErrorReply.value.error;
  const message = readGoogleMessage(googleError.message, fallbackMessage);
  const isServiceDisabled = googleError.details.some(
    (detail) => detail.reason === SERVICE_DISABLED_REASON,
  );
  if (isServiceDisabled) return { kind: 'service-disabled', message };
  const isPermissionDenied =
    httpStatus === HTTP_FORBIDDEN && googleError.status === PERMISSION_DENIED_STATUS;
  if (isPermissionDenied) return { kind: 'permission-denied', message };
  return { kind: 'other', message };
};

/** A service account email ends in `@<project id>.iam.gserviceaccount.com`; only the project id is read. */
export const readProjectIdFromClientEmail = (clientEmail: string): string | null => {
  const projectIdCapture = /@([a-z][a-z0-9-]*)\.iam\.gserviceaccount\.com$/.exec(clientEmail);
  if (projectIdCapture === null) return null;
  const projectId = projectIdCapture[1];
  if (projectId === undefined) return null;
  return projectId;
};

export const createPermissionReason = (propertyId: string | null): string => {
  if (propertyId === null) {
    return 'Google Analytics refused to list properties; add the launch Google service account as a Viewer on a GA4 property';
  }
  return `Add the launch Google service account as a Viewer on GA4 property ${propertyId}`;
};

export const createServiceDisabledReason = (url: string, projectId: string | null): string => {
  const apiHost = new URL(url).host;
  if (projectId === null) {
    return `Enable the ${apiHost} API for the project of the launch Google service account`;
  }
  const enableLink = `https://console.developers.google.com/apis/api/${apiHost}/overview?project=${projectId}`;
  return `Enable the ${apiHost} API for the launch Google service account project: ${enableLink}`;
};

const createRequest = (call: Ga4Call, accessToken: string) => {
  if (call.requestDocument === null) {
    return HttpClientRequest.get(call.url).pipe(HttpClientRequest.bearerToken(accessToken));
  }
  return HttpClientRequest.post(call.url).pipe(
    HttpClientRequest.bearerToken(accessToken),
    HttpClientRequest.bodyUnsafeJson(call.requestDocument),
  );
};

/** One Google Analytics call: a 2xx body comes back, permission and disabled-API errors become a skip signal. */
export const requestGa4Document = (
  session: Ga4Session,
  call: Ga4Call,
): Effect.Effect<unknown, Ga4Failure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const analyticsReply = yield* httpClient
      .execute(createRequest(call, session.accessToken))
      .pipe(
        Effect.mapError((cause) =>
          createGa4Failure(
            session,
            `Google Analytics request failed: ${errorMessage(cause)}`,
            cause,
          ),
        ),
      );
    const analyticsDocument: unknown = yield* analyticsReply.json.pipe(
      Effect.mapError((cause) =>
        createGa4Failure(
          session,
          `Google Analytics reply (HTTP ${analyticsReply.status}) was not JSON: ${errorMessage(cause)}`,
          cause,
        ),
      ),
    );
    const isSuccess =
      analyticsReply.status >= HTTP_SUCCESS_MIN && analyticsReply.status <= HTTP_SUCCESS_MAX;
    if (isSuccess) return analyticsDocument;
    const errorReading = readGa4Error(analyticsReply.status, analyticsDocument);
    if (errorReading.kind === 'permission-denied') {
      return yield* Effect.fail(
        makeGa4SkipSignal({ reason: createPermissionReason(call.propertyId) }),
      );
    }
    if (errorReading.kind === 'service-disabled') {
      return yield* Effect.fail(
        makeGa4SkipSignal({ reason: createServiceDisabledReason(call.url, session.projectId) }),
      );
    }
    return yield* Effect.fail(
      createGa4Failure(
        session,
        `Google Analytics error: ${errorReading.message}`,
        analyticsDocument,
      ),
    );
  });
