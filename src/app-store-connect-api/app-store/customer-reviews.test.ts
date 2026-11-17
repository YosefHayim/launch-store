import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppStoreConnectApi,
  type AppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
import {
  fakeResponse,
  makeKey,
  readRequestDocument,
} from '@/app-store-connect-api/test-helpers.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
const fetchMock = vi.fn();
let client: AppStoreConnectApi;
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  client = makeAppStoreConnectApi(makeKey());
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('Customer reviews API', () => {
  it('lists reviews with include=response, computing `answered` from the response relationship', async () => {
    const page2 = 'https://api.appstoreconnect.apple.com/v1/apps/app1/customerReviews?cursor=P2';
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              {
                id: 'r1',
                attributes: {
                  rating: 5,
                  title: 'Love it',
                  body: 'Great',
                  reviewerNickname: 'fan',
                  territory: 'USA',
                },
                relationships: { response: { data: { id: 'resp1' } } },
              },
            ],
            links: { next: page2 },
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              { id: 'r2', attributes: { rating: 1 }, relationships: { response: { data: null } } },
            ],
          }),
        ),
      );
    const reviews = await client.listCustomerReviews('app1', { rating: 5, territory: 'USA' });
    expect(reviews).toEqual([
      {
        id: 'r1',
        rating: 5,
        title: 'Love it',
        body: 'Great',
        reviewerNickname: 'fan',
        territory: 'USA',
        answered: true,
      },
      { id: 'r2', rating: 1, answered: false },
    ]);
    const firstUrl = String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]);
    expect(firstUrl).toContain('/apps/app1/customerReviews?include=response&sort=-createdDate');
    expect(firstUrl).toContain('filter[rating]=5');
    expect(firstUrl).toContain('filter[territory]=USA');
    // Page 2 follows the absolute cursor verbatim - no /v1/v1 double-prefix.
    expect(String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0])).toBe(page2);
  });
  it('returns null for a review with no developer response (Apple 404s)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    expect(await client.getCustomerReviewResponse('r1')).toBeNull();
  });
  it('creates/replaces a response with the review relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'resp1', attributes: { responseBody: 'Thanks!', state: 'PENDING_PUBLISH' } },
        }),
      ),
    );
    const reviewResponse = await client.createCustomerReviewResponse('r1', 'Thanks!');
    expect(reviewResponse).toEqual({
      id: 'resp1',
      responseBody: 'Thanks!',
      state: 'PENDING_PUBLISH',
    });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/customerReviewResponses');
    expect(init.method).toBe('POST');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'customerReviewResponses',
        attributes: { responseBody: 'Thanks!' },
        relationships: { review: { data: { type: 'customerReviews', id: 'r1' } } },
      },
    });
  });
  it('deletes a response by id', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await client.deleteCustomerReviewResponse('resp1');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('DELETE');
    expect(url).toContain('/customerReviewResponses/resp1');
  });
});
