const PLAY_REPORTS_BUCKET_PATTERN = /^pubsite_prod(_rev)?_[0-9]+$/;

/** The bucket name from a copied Cloud Storage URI (`gs://pubsite_prod_123/`) or a bare name; null when it is neither. */
export const parsePlayReportsBucket = (copiedBucketUri: string): string | null => {
  const trimmedUri = copiedBucketUri.trim();
  const [bucketName] = trimmedUri.replace('gs://', '').split('/');
  const isBucketNameValid =
    bucketName !== undefined && PLAY_REPORTS_BUCKET_PATTERN.test(bucketName);
  if (!isBucketNameValid) return null;
  return bucketName;
};
