// Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/edits
import {
  androidpublisher,
  auth as androidPublisherAuth,
  type androidpublisher_v3,
} from '@googleapis/androidpublisher';
import type { ServiceAccount } from '@/core/types/credentials.js';
import type { MutableDeep } from '@/core/types/mutable.js';
import type { PlayMoneyUnits } from '@/core/types/playPricing.js';

const OAUTH_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

export type GooglePlayApiError = Readonly<{
  readonly _tag: 'GooglePlayApiError';
  readonly operation: string;
  readonly statusCode?: number;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeGooglePlayApiError = (
  failure: Omit<GooglePlayApiError, '_tag'>,
): GooglePlayApiError => ({ _tag: 'GooglePlayApiError', ...failure });

/** Raised when a package has no Play app record or the service account cannot reach it. */
export type PlayAppNotFoundError = Readonly<{
  readonly _tag: 'PlayAppNotFoundError';
  readonly packageName: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makePlayAppNotFoundError = (
  failure: Omit<PlayAppNotFoundError, '_tag'>,
): PlayAppNotFoundError => ({ _tag: 'PlayAppNotFoundError', ...failure });

/** A service-account key could not be decoded into the fields Google auth requires. */
type ServiceAccountParseError = Readonly<{
  readonly _tag: 'ServiceAccountParseError';
  readonly message: string;
  readonly cause: unknown;
}>;

const makeServiceAccountParseError = (
  failure: Omit<ServiceAccountParseError, '_tag'>,
): ServiceAccountParseError => ({ _tag: 'ServiceAccountParseError', ...failure });

const readTag = (failure: unknown): unknown => {
  if (typeof failure !== 'object') return undefined;
  if (failure === null) return undefined;
  if (!('_tag' in failure)) return undefined;
  return failure._tag;
};

export const isGooglePlayApiError = (failure: unknown): failure is GooglePlayApiError =>
  readTag(failure) === 'GooglePlayApiError';

export const isPlayAppNotFoundError = (failure: unknown): failure is PlayAppNotFoundError =>
  readTag(failure) === 'PlayAppNotFoundError';

/** Deep-clone a Launch boundary value into a mutable plain object for Google's generated client. */
export const mutableGoogleRequest = <GoogleRequest>(requestShape: unknown): GoogleRequest => {
  const clonedRequest: GoogleRequest = JSON.parse(JSON.stringify(requestShape));
  return clonedRequest;
};

const googleFailureStatus = (cause: unknown): number | undefined => {
  if (typeof cause !== 'object') return;
  if (cause === null) return;
  if (!('status' in cause)) return;
  if (typeof cause.status !== 'number') return;
  return cause.status;
};

const googleFailureMessage = (cause: unknown): string => {
  if (cause instanceof Error) return describePlayErrors(cause.message);
  return describePlayErrors(String(cause));
};

/** Retain a non-empty generated page token and collapse null/empty values to undefined. */
export const nonEmptyPageToken = (token: string | null | undefined): string | undefined => {
  if (typeof token !== 'string') return;
  if (token.length === 0) return;
  return token;
};

/** Walk every page of a token-bearing generated list into one Launch-owned collection. */
export const collectGeneratedPages = async <Page, Collected>(
  loadPage: (pageToken: string | undefined) => Promise<Page>,
  collectedFromPage: (page: Page) => readonly Collected[],
  nextTokenFromPage: (page: Page) => string | null | undefined,
): Promise<Collected[]> => {
  const collected: Collected[] = [];
  let pageToken: string | undefined;
  do {
    // biome-ignore lint/performance/noAwaitInLoops: each page token comes from the prior page, so the reads are sequential
    const page = await loadPage(pageToken);
    for (const pageEntry of collectedFromPage(page)) collected.push(pageEntry);
    pageToken = nonEmptyPageToken(nextTokenFromPage(page));
  } while (pageToken !== undefined);
  return collected;
};

/** Normalize Google's nullable Money DTO to Launch's consumed money fields. */
export const normalizeMoney = (
  money: androidpublisher_v3.Schema$Money | undefined,
): PlayMoneyUnits => {
  let currencyCode = '';
  let units = '0';
  let nanos = 0;
  if (typeof money?.currencyCode === 'string') currencyCode = money.currencyCode;
  if (typeof money?.units === 'string') units = money.units;
  if (typeof money?.nanos === 'number') nanos = money.nanos;
  return { currencyCode, units, nanos };
};

/** JWT options the official Google clients accept for one service-account key + OAuth scopes. */
export const serviceAccountJwtOptions = (
  account: ServiceAccount,
  scopes: readonly string[],
): {
  email: string;
  key: string;
  keyId?: string;
  scopes: string[];
} => {
  const authenticationOptions: {
    email: string;
    key: string;
    keyId?: string;
    scopes: string[];
  } = {
    email: account.clientEmail,
    key: account.privateKey,
    scopes: [...scopes],
  };
  if (account.privateKeyId !== undefined) authenticationOptions.keyId = account.privateKeyId;
  return authenticationOptions;
};

const readNonEmptyString = (
  document: Readonly<Record<string, unknown>>,
  field: string,
): string | undefined => {
  const fieldValue = document[field];
  if (typeof fieldValue !== 'string') return undefined;
  if (fieldValue.length === 0) return undefined;
  return fieldValue;
};

const isPlainDocument = (decoded: unknown): decoded is Readonly<Record<string, unknown>> => {
  if (typeof decoded !== 'object') return false;
  if (decoded === null) return false;
  return !Array.isArray(decoded);
};

/** Decode a Google Cloud service-account key once at the transport boundary. */
export const parseServiceAccount = (serviceAccountJson: string): ServiceAccount => {
  let decodedJson: unknown;
  try {
    decodedJson = JSON.parse(serviceAccountJson);
  } catch (cause) {
    throw makeServiceAccountParseError({
      message: 'Service-account key is not valid JSON. Pass the JSON file Google Cloud issued.',
      cause,
    });
  }
  const missingFieldsFailure = (): ServiceAccountParseError =>
    makeServiceAccountParseError({
      message:
        'Service-account key is missing `client_email`/`private_key`. Use a Google Cloud service-account JSON key (not an OAuth client or an API key).',
      cause: decodedJson,
    });
  if (!isPlainDocument(decodedJson)) throw missingFieldsFailure();
  const clientEmail = readNonEmptyString(decodedJson, 'client_email');
  const privateKey = readNonEmptyString(decodedJson, 'private_key');
  const privateKeyId = readNonEmptyString(decodedJson, 'private_key_id');
  const tokenUri = readNonEmptyString(decodedJson, 'token_uri');
  if (clientEmail === undefined) throw missingFieldsFailure();
  if (privateKey === undefined) throw missingFieldsFailure();
  const serviceAccount: MutableDeep<ServiceAccount> = {
    clientEmail,
    privateKey,
    tokenUri: 'https://oauth2.googleapis.com/token',
  };
  if (tokenUri !== undefined) serviceAccount.tokenUri = tokenUri;
  if (privateKeyId !== undefined) serviceAccount.privateKeyId = privateKeyId;
  return serviceAccount;
};

const readGoogleErrorMessage = (googleErrorText: string): string | undefined => {
  let decodedDocument: unknown;
  try {
    decodedDocument = JSON.parse(googleErrorText);
  } catch {
    return undefined;
  }
  if (!isPlainDocument(decodedDocument)) return undefined;
  const googleError = decodedDocument['error'];
  const errorDescription = decodedDocument['error_description'];
  const isDescriptionInvalid =
    errorDescription !== undefined && typeof errorDescription !== 'string';
  if (isDescriptionInvalid) return undefined;
  let message = '';
  if (typeof googleError === 'string') message = googleError;
  if (isPlainDocument(googleError)) {
    const isMessageInvalid =
      googleError['message'] !== undefined && typeof googleError['message'] !== 'string';
    const isStatusInvalid =
      googleError['status'] !== undefined && typeof googleError['status'] !== 'string';
    if (isMessageInvalid) return undefined;
    if (isStatusInvalid) return undefined;
    if (typeof googleError['message'] === 'string') message = googleError['message'];
    if (message.length === 0 && typeof googleError['status'] === 'string')
      message = googleError['status'];
  }
  const isErrorShapeInvalid =
    googleError !== undefined && typeof googleError !== 'string' && !isPlainDocument(googleError);
  if (isErrorShapeInvalid) return undefined;
  if (message.length === 0 && typeof errorDescription === 'string') message = errorDescription;
  return message;
};

/**
 * Extract Google's human-readable error detail, falling back to the raw transport text.
 * Recognizes the sensitive/high-risk permission rejection and appends the fix, so the CLI doesn't just
 * echo a 403 - it tells you the release was blocked on a permission declaration.
 */
export const describePlayErrors = (googleErrorText: string): string => {
  const emptyBodyMessage = 'no response body';
  const message = readGoogleErrorMessage(googleErrorText);
  if (message === undefined || message.length === 0) {
    if (googleErrorText.length > 0) return googleErrorText;
    return emptyBodyMessage;
  }
  if (/sensitive|high.?risk|permissions? declaration/i.test(message)) {
    return `${message} - a sensitive/high-risk permission likely needs pre-approval (a Permissions Declaration) in Play Console before this release is accepted.`;
  }
  return message;
};

type AndroidPublisher = androidpublisher_v3.Androidpublisher;

/** Generated Android Publisher methods used by Launch's adapter. */
export type GooglePlayTransport = Readonly<{
  edits: Pick<AndroidPublisher['edits'], 'insert' | 'commit' | 'delete'> &
    Readonly<{
      bundles: Pick<AndroidPublisher['edits']['bundles'], 'list' | 'upload'>;
      tracks: Pick<AndroidPublisher['edits']['tracks'], 'get' | 'list' | 'update'>;
      testers: Pick<AndroidPublisher['edits']['testers'], 'get' | 'update'>;
      countryavailability: Pick<AndroidPublisher['edits']['countryavailability'], 'get'>;
      listings: Pick<AndroidPublisher['edits']['listings'], 'list' | 'patch'>;
    }>;
  inappproducts: Pick<AndroidPublisher['inappproducts'], 'list' | 'insert' | 'update'>;
  monetization: Pick<AndroidPublisher['monetization'], 'convertRegionPrices'> &
    Readonly<{
      subscriptions: Pick<
        AndroidPublisher['monetization']['subscriptions'],
        'list' | 'create' | 'patch'
      > &
        Readonly<{
          basePlans: Pick<
            AndroidPublisher['monetization']['subscriptions']['basePlans'],
            'activate'
          > &
            Readonly<{
              offers: Pick<
                AndroidPublisher['monetization']['subscriptions']['basePlans']['offers'],
                'list' | 'create' | 'activate'
              >;
            }>;
        }>;
    }>;
  reviews: Pick<AndroidPublisher['reviews'], 'list' | 'get' | 'reply'>;
}>;

const createGeneratedPublisher = (account: ServiceAccount): GooglePlayTransport => {
  const googleAuthentication = new androidPublisherAuth.JWT(
    serviceAccountJwtOptions(account, [OAUTH_SCOPE]),
  );
  return androidpublisher({ version: 'v3', auth: googleAuthentication });
};

export const makePlayRequests = (
  account: ServiceAccount,
  generatedPublisher?: GooglePlayTransport,
) => {
  let publisher: GooglePlayTransport;
  if (generatedPublisher === undefined) {
    publisher = createGeneratedPublisher(account);
  } else {
    publisher = generatedPublisher;
  }

  const send = async <Reply>(
    operation: string,
    invoke: () => PromiseLike<{ data: Reply }>,
  ): Promise<Reply> => {
    try {
      const completedRequest = await invoke();
      return completedRequest.data;
    } catch (cause) {
      const statusCode = googleFailureStatus(cause);
      const message = `Google Play ${operation} failed: ${googleFailureMessage(cause)}`;
      if (statusCode === undefined) throw makeGooglePlayApiError({ operation, message, cause });
      throw makeGooglePlayApiError({ operation, statusCode, message, cause });
    }
  };

  /** Open a transactional edit (no changes committed); returns its id. A 404 means the app doesn't exist. */
  const openEdit = async (packageName: string): Promise<string> => {
    const editCreation = await send('create edit', () => publisher.edits.insert({ packageName }));
    if (typeof editCreation.id === 'string') return editCreation.id;
    throw makeGooglePlayApiError({
      operation: 'create edit',
      message: 'Google Play create edit failed: the generated client returned no edit id.',
      cause: editCreation,
    });
  };

  const commitEdit = async (packageName: string, editId: string): Promise<void> => {
    await send('commit edit', () => publisher.edits.commit({ packageName, editId }));
  };

  const discardEdit = async (packageName: string, editId: string): Promise<void> => {
    try {
      await send('delete edit', () => publisher.edits.delete({ packageName, editId }));
    } catch {
      // Best effort: an edit left open expires on Google's side.
    }
  };

  /** Run edit-scoped writes transactionally: commit on success, abandon the edit on any failure. */
  const withEdit = async <Applied>(
    packageName: string,
    apply: (editId: string) => Promise<Applied>,
  ): Promise<Applied> => {
    const editId = await openEdit(packageName);
    try {
      const applied = await apply(editId);
      await commitEdit(packageName, editId);
      return applied;
    } catch (failure) {
      await discardEdit(packageName, editId);
      throw failure;
    }
  };

  /** Open a throwaway edit for a read, run `read`, then always abandon it (reads never commit). */
  const withReadEdit = async <Read>(
    packageName: string,
    read: (editId: string) => Promise<Read>,
  ): Promise<Read> => {
    const editId = await openEdit(packageName);
    try {
      return await read(editId);
    } finally {
      await discardEdit(packageName, editId);
    }
  };

  return {
    publisher,
    serviceAccountEmail: account.clientEmail,
    send,
    openEdit,
    discardEdit,
    withEdit,
    withReadEdit,
  };
};

export type PlayRequests = ReturnType<typeof makePlayRequests>;
