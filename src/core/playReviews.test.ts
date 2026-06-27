import { describe, expect, it } from 'vitest';
import type { PlayReplyResult, PlayReview } from '../google/playClient.js';
import { type PlayReviewsApi, listPlayReviews, replyToPlayReview } from './playReviews.js';

/** Records the calls the domain makes, so a test can assert what was sent and replay canned reviews. */
interface Calls {
  listOptions: { translationLanguage?: string }[];
  replies: { reviewId: string; replyText: string }[];
}

/** A hand-rolled {@link PlayReviewsApi} — no network — serving canned reviews and recording the writes. */
function makeApi(reviews: PlayReview[]): { api: PlayReviewsApi; calls: Calls } {
  const calls: Calls = { listOptions: [], replies: [] };
  const byId = new Map(reviews.map((review) => [review.reviewId, review]));
  const api: PlayReviewsApi = {
    listReviews: (_pkg, options) => {
      calls.listOptions.push(options);
      return Promise.resolve(reviews);
    },
    getReview: (_pkg, reviewId) => Promise.resolve(byId.get(reviewId) ?? null),
    replyToReview: (_pkg, reviewId, replyText) => {
      calls.replies.push({ reviewId, replyText });
      const result: PlayReplyResult = { replyText, lastEdited: '2026-06-14T00:00:00.000Z' };
      return Promise.resolve(result);
    },
  };
  return { api, calls };
}

function review(overrides: Partial<PlayReview> = {}): PlayReview {
  return { reviewId: 'r1', rating: 5, answered: false, ...overrides };
}

describe('listPlayReviews', () => {
  it('filters by rating and unanswered, client-side', async () => {
    const { api } = makeApi([
      review({ reviewId: 'a', rating: 5, answered: false }),
      review({ reviewId: 'b', rating: 3, answered: false }),
      review({ reviewId: 'c', rating: 5, answered: true }),
    ]);
    expect(
      (await listPlayReviews(api, 'com.acme.app', { rating: 5 })).map((r) => r.reviewId),
    ).toEqual(['a', 'c']);
    expect(
      (await listPlayReviews(api, 'com.acme.app', { unansweredOnly: true })).map((r) => r.reviewId),
    ).toEqual(['a', 'b']);
  });

  it('passes a translation language through to the client, and omits it otherwise', async () => {
    const { api, calls } = makeApi([review()]);
    await listPlayReviews(api, 'com.acme.app', { translationLanguage: 'en-US' });
    await listPlayReviews(api, 'com.acme.app', {});
    expect(calls.listOptions).toEqual([{ translationLanguage: 'en-US' }, {}]);
  });
});

describe('replyToPlayReview', () => {
  it('reports replaced=false when the review had no developer reply', async () => {
    const { api, calls } = makeApi([review({ reviewId: 'r1', answered: false })]);
    const outcome = await replyToPlayReview(api, 'com.acme.app', 'r1', 'Thanks!');
    expect(outcome.replaced).toBe(false);
    expect(outcome.result.replyText).toBe('Thanks!');
    expect(calls.replies).toEqual([{ reviewId: 'r1', replyText: 'Thanks!' }]);
  });

  it('reports replaced=true when a developer reply already existed', async () => {
    const { api } = makeApi([
      review({ reviewId: 'r1', answered: true, developerReply: 'Old reply' }),
    ]);
    const outcome = await replyToPlayReview(api, 'com.acme.app', 'r1', 'New reply');
    expect(outcome.replaced).toBe(true);
  });
});
