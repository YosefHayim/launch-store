import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type {
  CustomerReviewResource,
  CustomerReviewResponseResource,
} from '../types/appleCatalog.js';
import { deleteReviewResponse, listReviews, replyToReview, type AscReviewsApi } from './reviews.js';

/** Build one customer-review fixture. */
const customerReview = (
  overrides: Partial<CustomerReviewResource> & { id: string; rating: number },
): CustomerReviewResource => ({ answered: false, ...overrides });

/** Build a deterministic reviews transport fake. */
const makeReviewsStore = (fixtures: {
  appIds?: Readonly<Record<string, string>>;
  customerReviews?: CustomerReviewResource[];
  existingReply?: CustomerReviewResponseResource | null;
}): AscReviewsApi => ({
  getAppId: vi.fn((bundleId: string) => {
    const appId = fixtures.appIds?.[bundleId];
    if (appId === undefined) return Effect.succeed(null);
    return Effect.succeed(appId);
  }),
  listCustomerReviews: vi.fn(() => {
    if (fixtures.customerReviews === undefined) return Effect.succeed([]);
    return Effect.succeed(fixtures.customerReviews);
  }),
  getCustomerReviewResponse: vi.fn(() => {
    if (fixtures.existingReply === undefined) return Effect.succeed(null);
    return Effect.succeed(fixtures.existingReply);
  }),
  createCustomerReviewResponse: vi.fn((reviewId: string, responseText: string) =>
    Effect.succeed({
      id: `resp-${reviewId}`,
      responseBody: responseText,
      state: 'PENDING_PUBLISH',
    }),
  ),
  deleteCustomerReviewResponse: vi.fn(() => Effect.void),
});

describe('listReviews', () => {
  it('returns an actionable failure when the app record is missing', async () => {
    const reviewsStore = makeReviewsStore({ appIds: {} });
    const missingApp = await Effect.runPromise(
      Effect.flip(listReviews(reviewsStore, 'com.x.missing')),
    );
    expect(missingApp.message).toContain('No App Store Connect app record');
  });

  it('pushes rating and territory to Apple and returns the list unchanged', async () => {
    const customerReviews = [
      customerReview({ id: 'r1', rating: 5 }),
      customerReview({ id: 'r2', rating: 5 }),
    ];
    const reviewsStore = makeReviewsStore({
      appIds: { 'com.x': 'app1' },
      customerReviews,
    });
    const listedReviews = await Effect.runPromise(
      listReviews(reviewsStore, 'com.x', { rating: 5, territory: 'USA' }),
    );
    expect(listedReviews).toBe(customerReviews);
    expect(reviewsStore.listCustomerReviews).toHaveBeenCalledWith('app1', {
      rating: 5,
      territory: 'USA',
    });
  });

  it('applies unanswered-only filtering after the server read', async () => {
    const customerReviews = [
      customerReview({ id: 'r1', rating: 5, answered: true }),
      customerReview({ id: 'r2', rating: 4, answered: false }),
    ];
    const reviewsStore = makeReviewsStore({
      appIds: { 'com.x': 'app1' },
      customerReviews,
    });
    const listedReviews = await Effect.runPromise(
      listReviews(reviewsStore, 'com.x', { unansweredOnly: true }),
    );
    expect(listedReviews.map((listedReview) => listedReview.id)).toEqual(['r2']);
    expect(reviewsStore.listCustomerReviews).toHaveBeenCalledWith('app1', {});
  });
});

describe('replyToReview', () => {
  it('posts a new reply and reports that it did not replace one', async () => {
    const reviewsStore = makeReviewsStore({ existingReply: null });
    const replyOutcome = await Effect.runPromise(
      replyToReview(reviewsStore, 'r1', 'Thanks for the feedback!'),
    );
    expect(replyOutcome.replaced).toBe(false);
    expect(replyOutcome.reviewReply).toMatchObject({ responseBody: 'Thanks for the feedback!' });
    expect(reviewsStore.createCustomerReviewResponse).toHaveBeenCalledWith(
      'r1',
      'Thanks for the feedback!',
    );
  });

  it('reports replacement when a reply already exists', async () => {
    const reviewsStore = makeReviewsStore({
      existingReply: { id: 'resp-old', responseBody: 'old' },
    });
    const replyOutcome = await Effect.runPromise(
      replyToReview(reviewsStore, 'r1', 'Updated reply'),
    );
    expect(replyOutcome.replaced).toBe(true);
  });
});

describe('deleteReviewResponse', () => {
  it('returns false when no reply exists', async () => {
    const reviewsStore = makeReviewsStore({ existingReply: null });
    expect(await Effect.runPromise(deleteReviewResponse(reviewsStore, 'r1'))).toBe(false);
    expect(reviewsStore.deleteCustomerReviewResponse).not.toHaveBeenCalled();
  });

  it('deletes the reply resource and returns true', async () => {
    const reviewsStore = makeReviewsStore({
      existingReply: { id: 'resp-1', responseBody: 'hi' },
    });
    expect(await Effect.runPromise(deleteReviewResponse(reviewsStore, 'r1'))).toBe(true);
    expect(reviewsStore.deleteCustomerReviewResponse).toHaveBeenCalledWith('resp-1');
  });
});
