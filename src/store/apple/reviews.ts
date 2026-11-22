import type {
  CustomerReviewResource,
  CustomerReviewResponseResource,
} from '../../types/apple-catalog.ts';
import { hasMessage } from '../../services/platform/error-message.ts';

/** The App Store transport operations required by the customer-reviews domain. */
export type AscReviewsApi = Readonly<{
  getAppId: (bundleId: string) => Promise<string | null>;
  listCustomerReviews: (
    appId: string,
    filters: Readonly<{ rating?: number; territory?: string }>,
  ) => Promise<CustomerReviewResource[]>;
  getCustomerReviewResponse: (reviewId: string) => Promise<CustomerReviewResponseResource | null>;
  createCustomerReviewResponse: (
    reviewId: string,
    responseText: string,
  ) => Promise<CustomerReviewResponseResource>;
  deleteCustomerReviewResponse: (reviewReplyId: string) => Promise<void>;
}>;

/** A customer-review validation or App Store request failed. */
type ReviewFailure = Readonly<{
  readonly _tag: 'ReviewFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeReviewFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): ReviewFailure {
  return { _tag: 'ReviewFailure', ...fields };
}

/** Optional filters for App Store customer reviews. */
type ReviewFilters = Readonly<{
  rating?: number | undefined;
  territory?: string | undefined;
  unansweredOnly?: boolean | undefined;
}>;

/** The stored developer reply and whether it replaced existing copy. */
type ReplyResult = Readonly<{
  reviewReply: CustomerReviewResponseResource;
  replaced: boolean;
}>;

/** Convert a transport failure to the reviews error channel. */
function reviewFailure(operation: string, cause: unknown): ReviewFailure {
  const fallback = `${operation} failed.`;
  const hasCauseMessage = hasMessage(cause);

  if (hasCauseMessage) return makeReviewFailure({ operation, message: cause.message, cause });

  return makeReviewFailure({ operation, message: fallback, cause });
}

/** Run one App Store review request in the reviews error channel. */
async function runReviewRequest<Success>(
  operation: string,
  request: Promise<Success>,
): Promise<Success> {
  try {
    return await request;
  } catch (cause) {
    throw reviewFailure(operation, cause);
  }
}

function isUnansweredReview(customerReview: CustomerReviewResource): boolean {
  const isAnswered = customerReview.answered == true;
  return isAnswered == false;
}

/** List an app's customer reviews, newest first. */
export async function listReviews(
  reviewsStore: AscReviewsApi,
  bundleId: string,
  filters: ReviewFilters = {},
): Promise<readonly CustomerReviewResource[]> {
  const appId = await runReviewRequest('resolve App Store app', reviewsStore.getAppId(bundleId));
  const isAppMissing = appId == null;

  if (isAppMissing) {
    throw makeReviewFailure({
      operation: 'resolve App Store app',
      message:
        `No App Store Connect app record for ${bundleId}. Confirm the bundle id and that this ` +
        'account can access the app.',
      cause: bundleId,
    });
  }

  const serverFilters: { rating?: number; territory?: string } = {};
  if (filters.rating != null) serverFilters.rating = filters.rating;
  if (filters.territory != null) serverFilters.territory = filters.territory;

  const customerReviews = await runReviewRequest(
    'list customer reviews',
    reviewsStore.listCustomerReviews(appId, serverFilters),
  );
  const isUnansweredOnly = filters.unansweredOnly == true;

  if (isUnansweredOnly) {
    return customerReviews.filter(isUnansweredReview);
  }

  return customerReviews;
}

/** Post or replace the developer reply to a customer review. */
export async function replyToReview(
  reviewsStore: AscReviewsApi,
  reviewId: string,
  responseText: string,
): Promise<ReplyResult> {
  const existingReply = await runReviewRequest(
    'read existing review reply',
    reviewsStore.getCustomerReviewResponse(reviewId),
  );
  const reviewReply = await runReviewRequest(
    'post review reply',
    reviewsStore.createCustomerReviewResponse(reviewId, responseText),
  );
  const replaced = existingReply != null;

  return { reviewReply, replaced };
}

/** Delete the developer reply to a customer review when one exists. */
export async function deleteReviewResponse(
  reviewsStore: AscReviewsApi,
  reviewId: string,
): Promise<boolean> {
  const existingReply = await runReviewRequest(
    'read existing review reply',
    reviewsStore.getCustomerReviewResponse(reviewId),
  );
  const isReplyMissing = existingReply == null;

  if (isReplyMissing) {
    return false;
  }

  await runReviewRequest(
    'delete review reply',
    reviewsStore.deleteCustomerReviewResponse(existingReply.id),
  );

  return true;
}
