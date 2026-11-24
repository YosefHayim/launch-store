// Lists Google Play reviews and stores a developer reply on one review.

import type { PlayReplyResult, PlayReview } from '../types/google/reviews.ts';

/** The Google Play review operations used by the reviews domain. */
export type PlayReviewsApi = Readonly<{
  readonly listReviews: (
    packageName: string,
    options: Readonly<{
      readonly translationLanguage?: string;
    }>,
  ) => Promise<readonly PlayReview[]>;
  readonly getReview: (packageName: string, reviewId: string) => Promise<PlayReview | null>;
  readonly replyToReview: (
    packageName: string,
    reviewId: string,
    replyText: string,
  ) => Promise<PlayReplyResult>;
}>;

/** Client-side filters for recent Google Play reviews. */
export type PlayReviewFilters = Readonly<{
  readonly rating?: number;
  readonly unansweredOnly?: boolean;
  readonly translationLanguage?: string;
}>;

/** The stored reply and whether it replaced an earlier developer reply. */
type PlayReplyOutcome = Readonly<{
  readonly reply: PlayReplyResult;
  readonly replaced: boolean;
}>;

function reviewMatches(playReview: PlayReview, reviewFilters: PlayReviewFilters): boolean {
  if (reviewFilters.rating != null) {
    if (playReview.rating != reviewFilters.rating) {
      return false;
    }
  }

  const wantsUnanswered = reviewFilters.unansweredOnly == true;

  if (wantsUnanswered) {
    if (playReview.answered) {
      return false;
    }
  }

  return true;
}

export async function listPlayReviews(
  playReviewsApi: PlayReviewsApi,
  packageName: string,
  reviewFilters: PlayReviewFilters = {},
): Promise<readonly PlayReview[]> {
  const reviewRequest: { translationLanguage?: string } = {};

  if (reviewFilters.translationLanguage != null) {
    reviewRequest.translationLanguage = reviewFilters.translationLanguage;
  }

  const recentReviews = await playReviewsApi.listReviews(packageName, reviewRequest);

  return recentReviews.filter(function keepReview(playReview: PlayReview) {
    return reviewMatches(playReview, reviewFilters);
  });
}

export async function replyToPlayReview(
  playReviewsApi: PlayReviewsApi,
  packageName: string,
  reviewId: string,
  replyText: string,
  existingReview: PlayReview | null,
): Promise<PlayReplyOutcome> {
  const storedReply = await playReviewsApi.replyToReview(packageName, reviewId, replyText);
  let replaced = false;

  if (existingReview != null) {
    replaced = existingReview.answered;
  }

  return { reply: storedReply, replaced };
}
