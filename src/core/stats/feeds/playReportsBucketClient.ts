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
    const objectResponse = yield* httpClient.execute(objectRequest);
    const isForbidden = objectResponse.status === HTTP_FORBIDDEN;
    if (isForbidden) return { status: 'forbidden' } satisfies BucketObjectReply;
    const isMissing = objectResponse.status === HTTP_NOT_FOUND;
    if (isMissing) return { status: 'missing' } satisfies BucketObjectReply;
    const isReplyUnexpected = objectResponse.status !== HTTP_OK;
    if (isReplyUnexpected) {
      return yield* Effect.fail(`Cloud Storage answered HTTP ${objectResponse.status}`);
    }
    const objectBuffer = yield* objectResponse.arrayBuffer;
    return { status: 'found', bytes: new Uint8Array(objectBuffer) } satisfies BucketObjectReply;
  }).pipe(
    Effect.mapError((cause) =>
      failBucketRead(`download ${objectName} from the Play reports bucket`, cause),
    ),
  );

/** Names of the bucket objects that start with the prefix, over every page (objects.list). */
export const listBucketObjectNames = (
  bucket: string,
  prefix: string,
  accessToken: string,
): Effect.Effect<BucketListReply, PlayReportsBucketFailure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const objectNames: string[] = [];
    let pageToken: string | null = null;
    do {
      let pageQuery = `prefix=${encodeURIComponent(prefix)}&fields=items(name),nextPageToken`;
      if (pageToken !== null) pageQuery = `${pageQuery}&pageToken=${encodeURIComponent(pageToken)}`;
      const listRequest = HttpClientRequest.get(
        `${STORAGE_API_ROOT}/${bucket}/o?${pageQuery}`,
      ).pipe(HttpClientRequest.bearerToken(accessToken));
      const listResponse = yield* httpClient.execute(listRequest);
      const isForbidden = listResponse.status === HTTP_FORBIDDEN;
      if (isForbidden) return { status: 'forbidden' } satisfies BucketListReply;
      const isReplyUnexpected = listResponse.status !== HTTP_OK;
      if (isReplyUnexpected) {
        return yield* Effect.fail(`Cloud Storage answered HTTP ${listResponse.status}`);
      }
      const listing = yield* listResponse.json.pipe(
        Effect.flatMap(Schema.decodeUnknown(BucketListingSchema)),
      );
      objectNames.push(...listing.items.map((listedObject) => listedObject.name));
      const nextPageToken = listing.nextPageToken;
      pageToken = null;
      if (nextPageToken !== undefined) pageToken = nextPageToken;
    } while (pageToken !== null);
    return { status: 'listed', objectNames } satisfies BucketListReply;
  }).pipe(Effect.mapError((cause) => failBucketRead('list the Play reports bucket', cause)));
