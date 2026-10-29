import { HttpClient, HttpClientRequest } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../../services/errorMessage.js';

export const STORAGE_READ_ONLY_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

const STORAGE_API_ROOT = 'https://storage.googleapis.com/storage/v1/b';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

export type PlayReportsBucketFailure = Readonly<{
  readonly _tag: 'PlayReportsBucketFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

const makePlayReportsBucketFailure = Data.tagged<PlayReportsBucketFailure>(
  'PlayReportsBucketFailure',
);

export type BucketObjectReply =
  | { readonly status: 'found'; readonly bytes: Uint8Array }
  | { readonly status: 'missing' }
  | { readonly status: 'forbidden' };

export type BucketListReply =
  | { readonly status: 'listed'; readonly objectNames: readonly string[] }
  | { readonly status: 'forbidden' };

const BucketListingSchema = Schema.Struct({
  items: Schema.optionalWith(Schema.Array(Schema.Struct({ name: Schema.String })), {
    default: () => [],
  }),
  nextPageToken: Schema.optional(Schema.String),
});

export const failBucketRead = (operation: string, cause: unknown): PlayReportsBucketFailure =>
  makePlayReportsBucketFailure({
    message: `Could not ${operation}: ${errorMessage(cause)}`,
    cause,
  });

/** One object of the reports bucket (objects.get with alt=media): missing means Play has not published it yet. */
export const downloadBucketObject = (
  bucket: string,
  objectName: string,
  accessToken: string,
): Effect.Effect<BucketObjectReply, PlayReportsBucketFailure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const objectUrl = `${STORAGE_API_ROOT}/${bucket}/o/${encodeURIComponent(objectName)}?alt=media`;
    const objectRequest = HttpClientRequest.get(objectUrl).pipe(
      HttpClientRequest.bearerToken(accessToken),
    );
    const objectReply = yield* httpClient.execute(objectRequest);
    const isForbidden = objectReply.status === HTTP_FORBIDDEN;
    if (isForbidden) return { status: 'forbidden' } satisfies BucketObjectReply;
    const isMissing = objectReply.status === HTTP_NOT_FOUND;
    if (isMissing) return { status: 'missing' } satisfies BucketObjectReply;
    const isReplyUnexpected = objectReply.status !== HTTP_OK;
    if (isReplyUnexpected) {
      return yield* Effect.fail(`Cloud Storage answered HTTP ${objectReply.status}`);
    }
    const objectBuffer = yield* objectReply.arrayBuffer;
    return { status: 'found', bytes: new Uint8Array(objectBuffer) } satisfies BucketObjectReply;
  }).pipe(
    Effect.mapError((cause) =>
      failBucketRead(`download ${objectName} from the Play reports bucket`, cause),
    ),
  );

const createListUrl = (bucket: string, prefix: string, pageToken: string | null): string => {
  const firstPageQuery = `prefix=${encodeURIComponent(prefix)}&fields=items(name),nextPageToken`;
  const listUrl = `${STORAGE_API_ROOT}/${bucket}/o?${firstPageQuery}`;
  if (pageToken === null) return listUrl;
  return `${listUrl}&pageToken=${encodeURIComponent(pageToken)}`;
};

const listBucketPage = (
  bucket: string,
  prefix: string,
  accessToken: string,
  pageToken: string | null,
): Effect.Effect<BucketListReply, unknown, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const listRequest = HttpClientRequest.get(createListUrl(bucket, prefix, pageToken)).pipe(
      HttpClientRequest.bearerToken(accessToken),
    );
    const listReply = yield* httpClient.execute(listRequest);
    const isForbidden = listReply.status === HTTP_FORBIDDEN;
    if (isForbidden) return { status: 'forbidden' } satisfies BucketListReply;
    const isReplyUnexpected = listReply.status !== HTTP_OK;
    if (isReplyUnexpected) {
      return yield* Effect.fail(`Cloud Storage answered HTTP ${listReply.status}`);
    }
    const listing = yield* listReply.json.pipe(
      Effect.flatMap(Schema.decodeUnknown(BucketListingSchema)),
    );
    const pageObjectNames = listing.items.map((listedObject) => listedObject.name);
    const nextPageToken = listing.nextPageToken;
    if (nextPageToken === undefined) {
      return { status: 'listed', objectNames: pageObjectNames } satisfies BucketListReply;
    }
    const nextPage = yield* listBucketPage(bucket, prefix, accessToken, nextPageToken);
    if (nextPage.status === 'forbidden') return nextPage;
    return {
      status: 'listed',
      objectNames: [...pageObjectNames, ...nextPage.objectNames],
    } satisfies BucketListReply;
  });

/** Names of the bucket objects that start with the prefix, over every page (objects.list). */
export const listBucketObjectNames = (
  bucket: string,
  prefix: string,
  accessToken: string,
): Effect.Effect<BucketListReply, PlayReportsBucketFailure, HttpClient.HttpClient> =>
  listBucketPage(bucket, prefix, accessToken, null).pipe(
    Effect.mapError((cause) => failBucketRead('list the Play reports bucket', cause)),
  );
