import { describe, expect, it } from 'vitest';
import type { PlayReplyResult, PlayReview } from '../types/google-play.ts';
import { type PlayReviewsApi, listPlayReviews, replyToPlayReview } from './play-reviews.ts';

type PlayReviewsCalls = {
  readonly listOptions: { translationLanguage?: string }[];
  readonly replies: { reviewId: string; replyText: string }[];
};

function makePlayReviewsApi(cannedReviews: readonly PlayReview[]): Readonly<{
  playReviewsApi: PlayReviewsApi;
  calls: PlayReviewsCalls;
}> {
  const calls: PlayReviewsCalls = { listOptions: [], replies: [] };
  const reviewsById = new Map(
    cannedReviews.map(function reviewById(playReview: PlayReview) {
      return [playReview.reviewId, playReview] as const;
    }),
  );
  const playReviewsApi: PlayReviewsApi = {
    async listReviews(_packageName, reviewOptions) {
      calls.listOptions.push(reviewOptions);
      return cannedReviews;
    },
    async getReview(_packageName, reviewId) {
      return reviewsById.get(reviewId) ?? null;
    },
    async replyToReview(_packageName, reviewId, replyText) {
      calls.replies.push({ reviewId, replyText });

      const storedReply: PlayReplyResult = {
        replyText,
        lastEdited: '2026-06-14T00:00:00.000Z',
      };

      return storedReply;
    },
  };

  return { playReviewsApi, calls };
}

function makePlayReview(reviewFields: Partial<PlayReview> = {}): PlayReview {
  return {
    reviewId: 'r1',
    rating: 5,
    answered: false,
    ...reviewFields,
  };
}

function reviewIdOf(playReview: PlayReview): string {
  return playReview.reviewId;
}

function describeListPlayReviews() {
  async function filtersByRatingAndUnansweredStatusClientSide() {
    const playReview = makePlayReview({ reviewId: 'a', rating: 5, answered: false });
    const { playReviewsApi } = makePlayReviewsApi([
      playReview,
      makePlayReview({ reviewId: 'b', rating: 3, answered: false }),
      makePlayReview({ reviewId: 'c', rating: 5, answered: true }),
    ]);
    const fiveStarReviews = await listPlayReviews(playReviewsApi, 'com.acme.app', { rating: 5 });
    const unansweredReviews = await listPlayReviews(playReviewsApi, 'com.acme.app', {
      unansweredOnly: true,
    });

    expect(fiveStarReviews.map(reviewIdOf)).toEqual(['a', 'c']);
    expect(unansweredReviews.map(reviewIdOf)).toEqual(['a', 'b']);
  }

  it(
    'filters by rating and unanswered status client-side',
    filtersByRatingAndUnansweredStatusClientSide,
  );

  async function passesATranslationLanguageThroughAndOmitsItOtherwise() {
    const playReview = makePlayReview();
    const { playReviewsApi, calls } = makePlayReviewsApi([playReview]);

    await listPlayReviews(playReviewsApi, 'com.acme.app', { translationLanguage: 'en-US' });
    await listPlayReviews(playReviewsApi, 'com.acme.app', {});

    expect(calls.listOptions).toEqual([{ translationLanguage: 'en-US' }, {}]);
  }

  it(
    'passes a translation language through and omits it otherwise',
    passesATranslationLanguageThroughAndOmitsItOtherwise,
  );
}

describe('listPlayReviews', describeListPlayReviews);

function describeReplyToPlayReview() {
  async function reportsReplacedFalseWhenTheReviewHadNoDeveloperReply() {
    const playReview = makePlayReview({ reviewId: 'r1', answered: false });
    const { playReviewsApi, calls } = makePlayReviewsApi([playReview]);
    const replyOutcome = await replyToPlayReview(
      playReviewsApi,
      'com.acme.app',
      'r1',
      'Thanks!',
      makePlayReview({ reviewId: 'r1', answered: false }),
    );

    expect(replyOutcome.replaced).toBe(false);
    expect(replyOutcome.reply.replyText).toBe('Thanks!');
    expect(calls.replies).toEqual([{ reviewId: 'r1', replyText: 'Thanks!' }]);
  }

  it(
    'reports replaced=false when the review had no developer reply',
    reportsReplacedFalseWhenTheReviewHadNoDeveloperReply,
  );

  async function reportsReplacedTrueWhenADeveloperReplyAlreadyExisted() {
    const playReview = makePlayReview({
      reviewId: 'r1',
      answered: true,
      developerReply: 'Old reply',
    });
    const { playReviewsApi } = makePlayReviewsApi([playReview]);
    const replyOutcome = await replyToPlayReview(
      playReviewsApi,
      'com.acme.app',
      'r1',
      'New reply',
      makePlayReview({ reviewId: 'r1', answered: true, developerReply: 'Old reply' }),
    );

    expect(replyOutcome.replaced).toBe(true);
  }

  it(
    'reports replaced=true when a developer reply already existed',
    reportsReplacedTrueWhenADeveloperReplyAlreadyExisted,
  );
}

describe('replyToPlayReview', describeReplyToPlayReview);
