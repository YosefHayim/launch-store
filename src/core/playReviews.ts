/**
 * The `launch play-reviews` domain: read a Play app's customer reviews and manage the developer reply,
 * entirely through the Play service account (no Play Console web session). The Play twin of
 * `core/reviews.ts`.
 *
 * Design (mirrors `core/reviews.ts`):
 * - **Stateless & read-first.** Every call reads the live account; there's no local cache to drift.
 *   `listPlayReviews` pulls all pages and applies the rating / unanswered filters client-side over the
 *   `answered` flag and `rating` the client already flattened out of each review's nested comments.
 * - **One write path, made safe.** A reply is a public, moderated post, so the command confirms before
 *   posting. Play's reply endpoint is an upsert (it edits an existing reply in place), so
 *   {@link replyToPlayReview} reports whether it *replaced* one — letting the command warn before
 *   overwriting — without a delete-then-recreate dance. Play has no delete-reply endpoint, so (unlike
 *   the Apple side) there's no delete path.
 *
 * The {@link PlayReviewsApi} slice names the exact client surface this module needs, so the logic is
 * unit-testable with a hand-rolled fake and `GooglePlayClient` satisfies it structurally.
 */

import type { PlayReplyResult, PlayReview } from '../google/playClient.js';

/** The exact slice of {@link GooglePlayClient} the reviews domain depends on. */
export interface PlayReviewsApi {
  listReviews(
    packageName: string,
    options: { translationLanguage?: string },
  ): Promise<PlayReview[]>;
  getReview(packageName: string, reviewId: string): Promise<PlayReview | null>;
  replyToReview(packageName: string, reviewId: string, replyText: string): Promise<PlayReplyResult>;
}

/** Filters for {@link listPlayReviews}, all applied client-side (the Play API has no server-side equivalents). */
export interface PlayReviewFilters {
  /** Keep only this star rating (1–5). */
  rating?: number;
  /** Keep only reviews without a developer reply yet. */
  unansweredOnly?: boolean;
  /** Ask Play to machine-translate review text into this BCP-47 language. */
  translationLanguage?: string;
}

/** Outcome of {@link replyToPlayReview}: the stored reply and whether it overwrote an existing one. */
export interface PlayReplyOutcome {
  result: PlayReplyResult;
  /** True when a prior reply existed and this call overwrote it (Play's reply is an upsert). */
  replaced: boolean;
}

/**
 * List an app's customer reviews, narrowed by the given filters. Play returns only reviews with text from
 * roughly the last week (a platform limit); rating and unanswered are applied here over the flattened
 * fields each review carries.
 */
export async function listPlayReviews(
  api: PlayReviewsApi,
  packageName: string,
  filters: PlayReviewFilters = {},
): Promise<PlayReview[]> {
  const reviews = await api.listReviews(
    packageName,
    filters.translationLanguage ? { translationLanguage: filters.translationLanguage } : {},
  );
  return reviews.filter((review) => {
    if (filters.rating !== undefined && review.rating !== filters.rating) return false;
    if (filters.unansweredOnly && review.answered) return false;
    return true;
  });
}

/**
 * Post (or replace) the developer reply to a review. Reads the review first only to report `replaced` so
 * the command can warn before overwriting; the write itself is one upsert.
 */
export async function replyToPlayReview(
  api: PlayReviewsApi,
  packageName: string,
  reviewId: string,
  replyText: string,
): Promise<PlayReplyOutcome> {
  const existing = await api.getReview(packageName, reviewId);
  const result = await api.replyToReview(packageName, reviewId, replyText);
  return { result, replaced: existing?.answered === true };
}
