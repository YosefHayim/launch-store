import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { PlayReplyResult, PlayReview } from '../types/googlePlay.js';
import { type PlayReviewsApi, listPlayReviews, replyToPlayReview } from './playReviews.js';

/** Calls recorded by the in-memory Play reviews fake. */
type PlayReviewsCalls = {
  readonly listOptions: { translationLanguage?: string }[];
  readonly replies: { reviewId: string; replyText: string }[];
};

/** Build an in-memory Play reviews API and its call log. */
const makePlayReviewsApi = (
  cannedReviews: readonly PlayReview[],
): Readonly<{
  playReviewsApi: PlayReviewsApi;
  calls: PlayReviewsCalls;
}> => {
  const calls: PlayReviewsCalls = { listOptions: [], replies: [] };
  const reviewsById = new Map(cannedReviews.map((playReview) => [playReview.reviewId, playReview]));
  const playReviewsApi: PlayReviewsApi = {
    listReviews: (_packageName, reviewOptions) => {
      calls.listOptions.push(reviewOptions);
      return Effect.succeed(cannedReviews);
    },
    getReview: (_packageName, reviewId) => {
      const matchingReview = reviewsById.get(reviewId);
      if (matchingReview === undefined) return Effect.succeed(null);
      return Effect.succeed(matchingReview);
    },
    replyToReview: (_packageName, reviewId, replyText) => {
      calls.replies.push({ reviewId, replyText });
      const storedReply: PlayReplyResult = {
        replyText,
        lastEdited: '2026-06-14T00:00:00.000Z',
      };
      return Effect.succeed(storedReply);
    },
  };
  return { playReviewsApi, calls };
};

/** Build a review with concise defaults. */
const makePlayReview = (reviewFields: Partial<PlayReview> = {}): PlayReview => ({
  reviewId: 'r1',
  rating: 5,
  answered: false,
  ...reviewFields,
});

describe('listPlayReviews', () => {
  it('filters by rating and unanswered status client-side', () => {
    const { playReviewsApi } = makePlayReviewsApi([
      makePlayReview({ reviewId: 'a', rating: 5, answered: false }),
      makePlayReview({ reviewId: 'b', rating: 3, answered: false }),
      makePlayReview({ reviewId: 'c', rating: 5, answered: true }),
    ]);
    const fiveStarReviews = Effect.runSync(
      listPlayReviews(playReviewsApi, 'com.acme.app', { rating: 5 }),
    );
    const unansweredReviews = Effect.runSync(
      listPlayReviews(playReviewsApi, 'com.acme.app', { unansweredOnly: true }),
    );
    expect(fiveStarReviews.map((playReview) => playReview.reviewId)).toEqual(['a', 'c']);
    expect(unansweredReviews.map((playReview) => playReview.reviewId)).toEqual(['a', 'b']);
  });

  it('passes a translation language through and omits it otherwise', () => {
    const { playReviewsApi, calls } = makePlayReviewsApi([makePlayReview()]);
    Effect.runSync(
      listPlayReviews(playReviewsApi, 'com.acme.app', { translationLanguage: 'en-US' }),
    );
    Effect.runSync(listPlayReviews(playReviewsApi, 'com.acme.app', {}));
    expect(calls.listOptions).toEqual([{ translationLanguage: 'en-US' }, {}]);
  });
});

describe('replyToPlayReview', () => {
  it('reports replaced=false when the review had no developer reply', () => {
    const { playReviewsApi, calls } = makePlayReviewsApi([
      makePlayReview({ reviewId: 'r1', answered: false }),
    ]);
    const replyOutcome = Effect.runSync(
      replyToPlayReview(
        playReviewsApi,
        'com.acme.app',
        'r1',
        'Thanks!',
        makePlayReview({ reviewId: 'r1', answered: false }),
      ),
    );
    expect(replyOutcome.replaced).toBe(false);
    expect(replyOutcome.reply.replyText).toBe('Thanks!');
    expect(calls.replies).toEqual([{ reviewId: 'r1', replyText: 'Thanks!' }]);
  });

  it('reports replaced=true when a developer reply already existed', () => {
    const { playReviewsApi } = makePlayReviewsApi([
      makePlayReview({ reviewId: 'r1', answered: true, developerReply: 'Old reply' }),
    ]);
    const replyOutcome = Effect.runSync(
      replyToPlayReview(
        playReviewsApi,
        'com.acme.app',
        'r1',
        'New reply',
        makePlayReview({ reviewId: 'r1', answered: true, developerReply: 'Old reply' }),
      ),
    );
    expect(replyOutcome.replaced).toBe(true);
  });
});
