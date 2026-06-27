import { describe, expect, it, vi } from 'vitest';
import type { CustomerReviewResource, CustomerReviewResponseResource } from '../apple/ascClient.js';
import { deleteReviewResponse, listReviews, replyToReview, type AscReviewsApi } from './reviews.js';

/** Build a fake review with sensible defaults; override what a test cares about. */
function review(
  overrides: Partial<CustomerReviewResource> & { id: string; rating: number },
): CustomerReviewResource {
  return { answered: false, ...overrides };
}

/**
 * A hand-rolled {@link AscReviewsApi}. `appId` maps bundle ids to app records (absent → no record);
 * `reviews` is what the list call returns; `existingResponse` is the current developer reply, if any.
 */
function makeApi(opts: {
  appId?: Record<string, string>;
  reviews?: CustomerReviewResource[];
  existingResponse?: CustomerReviewResponseResource | null;
}): AscReviewsApi {
  return {
    getAppId: vi.fn((bundleId: string) => Promise.resolve(opts.appId?.[bundleId] ?? null)),
    listCustomerReviews: vi.fn(() => Promise.resolve(opts.reviews ?? [])),
    getCustomerReviewResponse: vi.fn(() => Promise.resolve(opts.existingResponse ?? null)),
    createCustomerReviewResponse: vi.fn((reviewId: string, responseBody: string) =>
      Promise.resolve({ id: `resp-${reviewId}`, responseBody, state: 'PENDING_PUBLISH' }),
    ),
    deleteCustomerReviewResponse: vi.fn(() => Promise.resolve()),
  };
}

describe('listReviews', () => {
  it('throws an actionable error when the app record is missing', async () => {
    const api = makeApi({ appId: {} });
    await expect(listReviews(api, 'com.x.missing')).rejects.toThrow(
      /No App Store Connect app record/,
    );
  });

  it('pushes rating + territory to the server and returns the list unchanged', async () => {
    const reviews = [review({ id: 'r1', rating: 5 }), review({ id: 'r2', rating: 5 })];
    const api = makeApi({ appId: { 'com.x': 'app1' }, reviews });
    const result = await listReviews(api, 'com.x', { rating: 5, territory: 'USA' });
    expect(result).toBe(reviews);
    expect(api.listCustomerReviews).toHaveBeenCalledWith('app1', { rating: 5, territory: 'USA' });
  });

  it('applies unansweredOnly client-side over the answered flag', async () => {
    const reviews = [
      review({ id: 'r1', rating: 5, answered: true }),
      review({ id: 'r2', rating: 4, answered: false }),
    ];
    const api = makeApi({ appId: { 'com.x': 'app1' }, reviews });
    const result = await listReviews(api, 'com.x', { unansweredOnly: true });
    expect(result.map((review) => review.id)).toEqual(['r2']);
    // unansweredOnly is not a server filter — only rating/territory reach Apple.
    expect(api.listCustomerReviews).toHaveBeenCalledWith('app1', {});
  });
});

describe('replyToReview', () => {
  it("reports replaced=false and posts the body when there's no existing reply", async () => {
    const api = makeApi({ existingResponse: null });
    const { response, replaced } = await replyToReview(api, 'r1', 'Thanks for the feedback!');
    expect(replaced).toBe(false);
    expect(response).toMatchObject({ responseBody: 'Thanks for the feedback!' });
    expect(api.createCustomerReviewResponse).toHaveBeenCalledWith('r1', 'Thanks for the feedback!');
  });

  it('reports replaced=true when a reply already existed (upsert overwrites it)', async () => {
    const api = makeApi({ existingResponse: { id: 'resp-old', responseBody: 'old' } });
    const { replaced } = await replyToReview(api, 'r1', 'Updated reply');
    expect(replaced).toBe(true);
  });
});

describe('deleteReviewResponse', () => {
  it("returns false when there's no response to delete", async () => {
    const api = makeApi({ existingResponse: null });
    expect(await deleteReviewResponse(api, 'r1')).toBe(false);
    expect(api.deleteCustomerReviewResponse).not.toHaveBeenCalled();
  });

  it("deletes by the response's resource id and returns true", async () => {
    const api = makeApi({ existingResponse: { id: 'resp-1', responseBody: 'hi' } });
    expect(await deleteReviewResponse(api, 'r1')).toBe(true);
    expect(api.deleteCustomerReviewResponse).toHaveBeenCalledWith('resp-1');
  });
});
