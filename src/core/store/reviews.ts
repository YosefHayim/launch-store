import { Data, Effect } from 'effect';
import type {
  CustomerReviewResource,
  CustomerReviewResponseResource,
} from '../types/appleCatalog.js';

/** The App Store transport operations required by the customer-reviews domain. */
export type AscReviewsApi = Readonly<{
  getAppId: (bundleId: string) => Effect.Effect<string | null, unknown>;
  listCustomerReviews: (
    appId: string,
    filters: Readonly<{ rating?: number; territory?: string }>,
  ) => Effect.Effect<CustomerReviewResource[], unknown>;
  getCustomerReviewResponse: (
    reviewId: string,
  ) => Effect.Effect<CustomerReviewResponseResource | null, unknown>;
  createCustomerReviewResponse: (
    reviewId: string,
    responseText: string,
  ) => Effect.Effect<CustomerReviewResponseResource, unknown>;
  deleteCustomerReviewResponse: (reviewReplyId: string) => Effect.Effect<void, unknown>;
}>;

/** A customer-review validation or App Store request failed. */
export type ReviewFailure = Readonly<{
  readonly _tag: 'ReviewFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeReviewFailure = Data.tagged<ReviewFailure>('ReviewFailure');

/** Optional filters for App Store customer reviews. */
export type ReviewFilters = Readonly<{
  rating?: number | undefined;
  territory?: string | undefined;
  unansweredOnly?: boolean | undefined;
}>;

/** The stored developer reply and whether it replaced existing copy. */
export type ReplyResult = Readonly<{
  reviewReply: CustomerReviewResponseResource;
  replaced: boolean;
}>;

/** Convert a transport failure to the reviews error channel. */
const reviewFailure = (operation: string, cause: unknown): ReviewFailure => {
  let message = `${operation} failed.`;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makeReviewFailure({ operation, message, cause });
};

/** Run one App Store review request in the reviews error channel. */
const runReviewRequest = <Success>(
  operation: string,
  requestEffect: Effect.Effect<Success, unknown>,
): Effect.Effect<Success, ReviewFailure> =>
  requestEffect.pipe(Effect.mapError((cause) => reviewFailure(operation, cause)));

/** List an app's customer reviews, newest first. */
export const listReviews = (
  reviewsStore: AscReviewsApi,
  bundleId: string,
  filters: ReviewFilters = {},
): Effect.Effect<readonly CustomerReviewResource[], ReviewFailure> =>
  Effect.gen(function* () {
    const appId = yield* runReviewRequest('resolve App Store app', reviewsStore.getAppId(bundleId));
    if (appId === null) {
      return yield* Effect.fail(
        makeReviewFailure({
          operation: 'resolve App Store app',
          message:
            `No App Store Connect app record for ${bundleId}. Confirm the bundle id and that this ` +
            'account can access the app.',
          cause: bundleId,
        }),
      );
    }
    const serverFilters: { rating?: number; territory?: string } = {};
    if (filters.rating !== undefined) serverFilters.rating = filters.rating;
    if (filters.territory !== undefined) serverFilters.territory = filters.territory;
    const customerReviews = yield* runReviewRequest(
      'list customer reviews',
      reviewsStore.listCustomerReviews(appId, serverFilters),
    );
    if (filters.unansweredOnly) {
      return customerReviews.filter((customerReview) => !customerReview.answered);
    }
    return customerReviews;
  });

/** Post or replace the developer reply to a customer review. */
export const replyToReview = (
  reviewsStore: AscReviewsApi,
  reviewId: string,
  responseText: string,
): Effect.Effect<ReplyResult, ReviewFailure> =>
  Effect.gen(function* () {
    const existingReply = yield* runReviewRequest(
      'read existing review reply',
      reviewsStore.getCustomerReviewResponse(reviewId),
    );
    const reviewReply = yield* runReviewRequest(
      'post review reply',
      reviewsStore.createCustomerReviewResponse(reviewId, responseText),
    );
    return { reviewReply, replaced: existingReply !== null };
  });

/** Delete the developer reply to a customer review when one exists. */
export const deleteReviewResponse = (
  reviewsStore: AscReviewsApi,
  reviewId: string,
): Effect.Effect<boolean, ReviewFailure> =>
  Effect.gen(function* () {
    const existingReply = yield* runReviewRequest(
      'read existing review reply',
      reviewsStore.getCustomerReviewResponse(reviewId),
    );
    if (existingReply === null) return false;
    yield* runReviewRequest(
      'delete review reply',
      reviewsStore.deleteCustomerReviewResponse(existingReply.id),
    );
    return true;
  });
