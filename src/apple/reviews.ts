// Lists App Store Connect reviews and posts or deletes developer replies.

import type {
  CustomerReviewResource,
  CustomerReviewResponseResource,
} from '../types/apple/customer-reviews.ts';
import { errorMessage } from '../services/platform/error-message.ts';

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

/** Run one App Store review request in the reviews error channel. */
async function runReviewRequest<Success>(request: Promise<Success>): Promise<Success> {
  try {
    return await request;
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
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
  const appId = await runReviewRequest(reviewsStore.getAppId(bundleId));

  const isAppMissing = appId == null;

  if (isAppMissing) {
    throw new Error(
      `No App Store Connect app record for ${bundleId}. Confirm the bundle id and that this ` +
        'account can access the app.',
      { cause: bundleId },
    );
  }

  const serverFilters: { rating?: number; territory?: string } = {};

  if (filters.rating != null) serverFilters.rating = filters.rating;

  if (filters.territory != null) serverFilters.territory = filters.territory;

  const customerReviews = await runReviewRequest(
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
  const existingReply = await runReviewRequest(reviewsStore.getCustomerReviewResponse(reviewId));
  const reviewReply = await runReviewRequest(
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
  const existingReply = await runReviewRequest(reviewsStore.getCustomerReviewResponse(reviewId));

  const isReplyMissing = existingReply == null;

  if (isReplyMissing) {
    return false;
  }

  await runReviewRequest(reviewsStore.deleteCustomerReviewResponse(existingReply.id));

  return true;
}
