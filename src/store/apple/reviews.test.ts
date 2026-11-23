import { describe, expect, it, vi } from 'vitest';
import type {
  CustomerReviewResource,
  CustomerReviewResponseResource,
} from '@/types/apple-catalog.js';
import { deleteReviewResponse, listReviews, replyToReview, type AscReviewsApi } from './reviews.ts';

function readThrownMessage(cause: unknown): string | null {
  const isMissing = cause == null;

  if (isMissing) return null;

  const isNotObject = typeof cause != 'object';

  if (isNotObject) return null;

  const fields = Object.entries(cause);

  for (const field of fields) {
    const message = readMessageField(field[0], field[1]);

    const hasMessage = message != null;

    if (hasMessage) return message;
  }

  return null;
}

function readMessageField(fieldName: string | undefined, fieldText: unknown): string | null {
  const isNotMessage = fieldName != 'message';

  if (isNotMessage) return null;

  const fieldTextIsString = typeof fieldText == 'string';

  if (fieldTextIsString) return fieldText;

  return null;
}

async function captureThrown(work: Promise<unknown>): Promise<{ message: string }> {
  try {
    await work;
  } catch (cause) {
    const message = readThrownMessage(cause);

    const isMissingMessage = message == null;

    if (isMissingMessage) throw new Error('expected a failure');

    return { message };
  }

  throw new Error('expected a failure');
}

/** Build one customer-review fixture. */
function customerReview(
  overrides: Partial<CustomerReviewResource> & { id: string; rating: number },
): CustomerReviewResource {
  return { answered: false, ...overrides };
}
function mockCall(reviewId: string, responseText: string) {
  return Promise.resolve({
    id: `resp-${reviewId}`,
    responseBody: responseText,
    state: 'PENDING_PUBLISH',
  });
}

function mockCall2() {
  return Promise.resolve();
}

/** Build a deterministic reviews transport fake. */
function makeReviewsStore(fixtures: {
  appIds?: Readonly<Record<string, string>>;
  customerReviews?: CustomerReviewResource[];
  existingReply?: CustomerReviewResponseResource | null;
}): AscReviewsApi {
  function mockCall3(bundleId: string) {
    const appId = fixtures.appIds?.[bundleId];

    if (appId == null) return Promise.resolve(null);

    return Promise.resolve(appId);
  }

  function mockCall4() {
    if (fixtures.customerReviews == null) return Promise.resolve([]);

    return Promise.resolve(fixtures.customerReviews);
  }

  function mockCall5() {
    if (fixtures.existingReply == null) return Promise.resolve(null);

    return Promise.resolve(fixtures.existingReply);
  }

  return {
    getAppId: vi.fn(mockCall3),
    listCustomerReviews: vi.fn(mockCall4),
    getCustomerReviewResponse: vi.fn(mockCall5),
    createCustomerReviewResponse: vi.fn(mockCall),
    deleteCustomerReviewResponse: vi.fn(mockCall2),
  };
}

describe('listReviews', () => {
  async function returnsAnActionableFailureWhenTheAppPieceIsMissing() {
    const reviewsStore = makeReviewsStore({ appIds: {} });
    const reviews = listReviews(reviewsStore, 'com.x.missing');
    const missingApp = await captureThrown(reviews);
    expect(missingApp.message).toContain('No App Store Connect app record');
  }

  it(
    'returns an actionable failure when the app record is missing',
    returnsAnActionableFailureWhenTheAppPieceIsMissing,
  );

  async function pushesRatingAndTerritoryToAppleAndReturnsTheListUnchanged() {
    const customerReviews = [
      customerReview({ id: 'r1', rating: 5 }),
      customerReview({ id: 'r2', rating: 5 }),
    ];
    const reviewsStore = makeReviewsStore({
      appIds: { 'com.x': 'app1' },
      customerReviews,
    });
    const listedReviews = await listReviews(reviewsStore, 'com.x', { rating: 5, territory: 'USA' });

    expect(listedReviews).toBe(customerReviews);
    expect(reviewsStore.listCustomerReviews).toHaveBeenCalledWith('app1', {
      rating: 5,
      territory: 'USA',
    });
  }

  it(
    'pushes rating and territory to Apple and returns the list unchanged',
    pushesRatingAndTerritoryToAppleAndReturnsTheListUnchanged,
  );

  it('applies unanswered-only filtering after the server read', async () => {
    const customerReviews = [
      customerReview({ id: 'r1', rating: 5, answered: true }),
      customerReview({ id: 'r2', rating: 4, answered: false }),
    ];
    const reviewsStore = makeReviewsStore({
      appIds: { 'com.x': 'app1' },
      customerReviews,
    });
    const listedReviews = await listReviews(reviewsStore, 'com.x', { unansweredOnly: true });

    expect(listedReviews.map((listedReview) => listedReview.id)).toEqual(['r2']);
    expect(reviewsStore.listCustomerReviews).toHaveBeenCalledWith('app1', {});
  });
});
function describeReplyToReview() {
  async function postsANewReplyAndReportsThatItDidNotReplaceOne() {
    const reviewsStore = makeReviewsStore({ existingReply: null });
    const replyOutcome = await replyToReview(reviewsStore, 'r1', 'Thanks for the feedback!');

    expect(replyOutcome.replaced).toBe(false);
    expect(replyOutcome.reviewReply).toMatchObject({ responseBody: 'Thanks for the feedback!' });
    expect(reviewsStore.createCustomerReviewResponse).toHaveBeenCalledWith(
      'r1',
      'Thanks for the feedback!',
    );
  }

  it(
    'posts a new reply and reports that it did not replace one',
    postsANewReplyAndReportsThatItDidNotReplaceOne,
  );

  async function reportsReplacementWhenAReplyAlreadyExists() {
    const reviewsStore = makeReviewsStore({
      existingReply: { id: 'resp-old', responseBody: 'old' },
    });
    const replyOutcome = await replyToReview(reviewsStore, 'r1', 'Updated reply');

    expect(replyOutcome.replaced).toBe(true);
  }

  it('reports replacement when a reply already exists', reportsReplacementWhenAReplyAlreadyExists);
}

describe('replyToReview', describeReplyToReview);
function describeDeleteReviewPiece() {
  async function returnsFalseWhenNoReplyExists() {
    const reviewsStore = makeReviewsStore({ existingReply: null });
    const deleteReview = await deleteReviewResponse(reviewsStore, 'r1');
    expect(deleteReview).toBe(false);
    expect(reviewsStore.deleteCustomerReviewResponse).not.toHaveBeenCalled();
  }

  it('returns false when no reply exists', returnsFalseWhenNoReplyExists);

  async function deletesTheReplyResourceAndReturnsTrue() {
    const reviewsStore = makeReviewsStore({
      existingReply: { id: 'resp-1', responseBody: 'hi' },
    });
    const deleteReview = await deleteReviewResponse(reviewsStore, 'r1');

    expect(deleteReview).toBe(true);
    expect(reviewsStore.deleteCustomerReviewResponse).toHaveBeenCalledWith('resp-1');
  }

  it('deletes the reply resource and returns true', deletesTheReplyResourceAndReturnsTrue);
}

describe('deleteReviewResponse', describeDeleteReviewPiece);
