// Lists and downloads files from the Google Play reports bucket.

import { errorMessage } from '../../services/platform/error-message.ts';
import { readPlainObject } from '../../services/platform/plain-object.ts';
import { isFailureTag } from '../../services/platform/tagged-failure.ts';

export const STORAGE_READ_ONLY_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

const STORAGE_API_ROOT = 'https://storage.googleapis.com/storage/v1/b';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const httpNotFound = 404;

export type PlayReportsBucketFailure = Readonly<{
  readonly _tag: 'PlayReportsBucketFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

type BucketObjectReply =
  | { readonly status: 'found'; readonly bytes: Uint8Array }
  | { readonly status: 'missing' }
  | { readonly status: 'forbidden' };

type BucketListReply =
  | { readonly status: 'listed'; readonly objectNames: readonly string[] }
  | { readonly status: 'forbidden' };

interface BucketListing {
  readonly objectNames: readonly string[];
  readonly nextPageToken: string | null;
}

function makePlayReportsBucketFailure(fields: {
  message: string;
  cause: unknown;
}): PlayReportsBucketFailure {
  return { _tag: 'PlayReportsBucketFailure', message: fields.message, cause: fields.cause };
}

export function failBucketRead(operation: string, cause: unknown): PlayReportsBucketFailure {
  const failureMessage = errorMessage(cause);

  return makePlayReportsBucketFailure({
    message: `Could not ${operation}: ${failureMessage}`,
    cause,
  });
}

async function fetchBucket(
  url: string,
  accessToken: string,
): Promise<{ status: number; bytes: Uint8Array }> {
  const httpReply = await fetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const bytes = new Uint8Array(await httpReply.arrayBuffer());

  return { status: httpReply.status, bytes };
}

async function readBucketObject(
  bucket: string,
  objectName: string,
  accessToken: string,
): Promise<BucketObjectReply> {
  const objectUrl = `${STORAGE_API_ROOT}/${bucket}/o/${encodeURIComponent(objectName)}?alt=media`;
  const objectReply = await fetchBucket(objectUrl, accessToken);

  const isForbidden = objectReply.status == HTTP_FORBIDDEN;

  if (isForbidden) {
    return { status: 'forbidden' };
  }

  const isMissing = objectReply.status == httpNotFound;

  if (isMissing) {
    return { status: 'missing' };
  }

  const isReplyUnexpected = objectReply.status != HTTP_OK;

  if (isReplyUnexpected) {
    throw new Error(`Cloud Storage answered HTTP ${objectReply.status}`);
  }

  return { status: 'found', bytes: objectReply.bytes };
}

/** One object of the reports bucket (objects.get with alt=media): missing means Play has not published it yet. */
export async function downloadBucketObject(
  bucket: string,
  objectName: string,
  accessToken: string,
): Promise<BucketObjectReply> {
  try {
    return await readBucketObject(bucket, objectName, accessToken);
  } catch (cause) {
    if (isFailureTag(cause, 'PlayReportsBucketFailure')) {
      throw cause;
    }

    throw failBucketRead(`download ${objectName} from the Play reports bucket`, cause);
  }
}

function createListUrl(bucket: string, prefix: string, pageToken: string | null): string {
  const firstPageQuery = `prefix=${encodeURIComponent(prefix)}&fields=items(name),nextPageToken`;
  const listUrl = `${STORAGE_API_ROOT}/${bucket}/o?${firstPageQuery}`;

  if (pageToken == null) {
    return listUrl;
  }

  return `${listUrl}&pageToken=${encodeURIComponent(pageToken)}`;
}

function readListedName(listedObject: unknown): string {
  const listedObjectObject = readPlainObject(listedObject);

  if (listedObjectObject == null) {
    throw new Error('A bucket listing item is not an object.');
  }

  if (typeof listedObjectObject['name'] != 'string') {
    throw new Error('A bucket listing item has no name.');
  }

  return listedObjectObject['name'];
}

function decodeBucketListing(documentText: string): BucketListing {
  const parsed: unknown = JSON.parse(documentText);

  const parsedObject = readPlainObject(parsed);

  if (parsedObject == null) {
    throw new Error('A bucket listing is not an object.');
  }

  let objectNames: string[] = [];

  if (parsedObject['items'] != null) {
    if (Array.isArray(parsedObject['items']) == false) {
      throw new Error('Bucket listing items are not a list.');
    }

    objectNames = parsedObject['items'].map(readListedName);
  }

  const nextPageToken = parsedObject['nextPageToken'];

  if (nextPageToken == null) {
    return { objectNames, nextPageToken: null };
  }

  if (typeof nextPageToken != 'string') {
    throw new Error('A bucket listing page token is not a string.');
  }

  if (nextPageToken == '') {
    return { objectNames, nextPageToken: null };
  }

  return { objectNames, nextPageToken };
}

async function listBucketPage(
  bucket: string,
  prefix: string,
  accessToken: string,
  pageToken: string | null,
): Promise<BucketListReply> {
  const listUrl = createListUrl(bucket, prefix, pageToken);
  const listReply = await fetchBucket(listUrl, accessToken);

  const isForbidden = listReply.status == HTTP_FORBIDDEN;

  if (isForbidden) {
    return { status: 'forbidden' };
  }

  const isReplyUnexpected = listReply.status != HTTP_OK;

  if (isReplyUnexpected) {
    throw new Error(`Cloud Storage answered HTTP ${listReply.status}`);
  }

  const listing = decodeBucketListing(new TextDecoder().decode(listReply.bytes));
  const nextPageToken = listing.nextPageToken;

  if (nextPageToken == null) {
    return { status: 'listed', objectNames: listing.objectNames };
  }

  const nextPage = await listBucketPage(bucket, prefix, accessToken, nextPageToken);

  if (nextPage.status == 'forbidden') {
    return nextPage;
  }

  return {
    status: 'listed',
    objectNames: [...listing.objectNames, ...nextPage.objectNames],
  };
}

/** Names of the bucket objects that start with the prefix, over every page (objects.list). */
export async function listBucketObjectNames(
  bucket: string,
  prefix: string,
  accessToken: string,
): Promise<BucketListReply> {
  try {
    return await listBucketPage(bucket, prefix, accessToken, null);
  } catch (cause) {
    if (isFailureTag(cause, 'PlayReportsBucketFailure')) {
      throw cause;
    }

    throw failBucketRead('list the Play reports bucket', cause);
  }
}
