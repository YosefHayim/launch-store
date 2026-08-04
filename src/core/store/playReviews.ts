import { Effect } from 'effect';
import type { PlayReplyResult, PlayReview } from '../types/googlePlay.js';

/** The Google Play review operations used by the reviews domain. */
export type PlayReviewsApi = Readonly<{
  readonly listReviews: (
    packageName: string,
    options: Readonly<{
      readonly translationLanguage?: string;
    }>,
  ) => Effect.Effect<readonly PlayReview[], unknown>;
  readonly getReview: (
    packageName: string,
    reviewId: string,
  ) => Effect.Effect<PlayReview | null, unknown>;
  readonly replyToReview: (
    packageName: string,
    reviewId: string,
    replyText: string,
  ) => Effect.Effect<PlayReplyResult, unknown>;
}>;

/** Client-side filters for recent Google Play reviews. */
export type PlayReviewFilters = Readonly<{
  readonly rating?: number;
  readonly unansweredOnly?: boolean;
  readonly translationLanguage?: string;
}>;

/** The stored reply and whether it replaced an earlier developer reply. */
export type PlayReplyOutcome = Readonly<{
  readonly reply: PlayReplyResult;
  readonly replaced: boolean;
}>;

export const listPlayReviews = (
  playReviewsApi: PlayReviewsApi,
  packageName: string,
  reviewFilters: PlayReviewFilters = {},
): Effect.Effect<readonly PlayReview[], unknown> =>
  Effect.gen(function* () {
    const reviewRequest: { translationLanguage?: string } = {};
    if (reviewFilters.translationLanguage !== undefined) {
      reviewRequest.translationLanguage = reviewFilters.translationLanguage;
    }
    const recentReviews = yield* playReviewsApi.listReviews(packageName, reviewRequest);
    return recentReviews.filter((playReview) => {
      if (reviewFilters.rating !== undefined && playReview.rating !== reviewFilters.rating) {
        return false;
      }
      if (reviewFilters.unansweredOnly === true && playReview.answered) return false;
      return true;
    });
  });

export const replyToPlayReview = (
  playReviewsApi: PlayReviewsApi,
  packageName: string,
  reviewId: string,
  replyText: string,
  existingReview: PlayReview | null,
): Effect.Effect<PlayReplyOutcome, unknown> =>
  Effect.gen(function* () {
    const storedReply = yield* playReviewsApi.replyToReview(packageName, reviewId, replyText);
    let replaced = existingReview?.answered;
    if (replaced === undefined) replaced = false;
    return { reply: storedReply, replaced };
  });
