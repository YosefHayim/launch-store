const PLAY_REPORTS_BUCKET_PATTERN = /^pubsite_prod(_rev)?_[0-9]+$/;
const GOOGLE_STORAGE_URI_PREFIX = 'gs://';

/** The bucket name from a copied Cloud Storage URI (`gs://pubsite_prod_123/`) or a bare name; null when it is neither. */
export const parsePlayReportsBucket = (copiedBucketUri: string): string | null => {
  const trimmedUri = copiedBucketUri.trim();
  const hasUriPrefix = trimmedUri.startsWith(GOOGLE_STORAGE_URI_PREFIX);
  let withoutPrefix = trimmedUri;
  if (hasUriPrefix) withoutPrefix = trimmedUri.slice(GOOGLE_STORAGE_URI_PREFIX.length);
  const [bucketName] = withoutPrefix.split('/');
  const isBucketNameValid =
    bucketName !== undefined && PLAY_REPORTS_BUCKET_PATTERN.test(bucketName);
  if (!isBucketNameValid) return null;
  return bucketName;
};
