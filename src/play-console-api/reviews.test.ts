import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getReview, listReviews, makeTestApi, replyToReview } from './test-helpers.js';
let client: ReturnType<typeof makeTestApi>;
beforeEach(() => {
  vi.clearAllMocks();
  client = makeTestApi();
});
describe('reviews', () => {
  it('lists, gets, and replies to reviews with flattened fields', async () => {
    listReviews.mockResolvedValue({
      data: {
        reviews: [
          {
            reviewId: 'r1',
            authorName: 'Alex',
            comments: [
              {
                userComment: {
                  text: 'Great app',
                  starRating: 5,
                  reviewerLanguage: 'en',
                  device: 'Pixel',
                  appVersionName: '1.2.0',
                  lastModified: { seconds: '1710000000' },
                },
              },
              { developerComment: { text: 'Thanks!' } },
            ],
          },
          { authorName: 'no-id' },
        ],
      },
    });
    getReview
      .mockResolvedValueOnce({
        data: {
          reviewId: 'r1',
          comments: [{ userComment: { text: 'Great app', starRating: 5 } }],
        },
      })
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { status: 404 }));
    replyToReview.mockResolvedValue({
      data: {
        result: {
          replyText: 'Thanks for the review!',
          lastEdited: { seconds: '1710000100' },
        },
      },
    });
    const reviews = await client.listReviews('com.example.app', { translationLanguage: 'en' });
    expect(reviews).toEqual([
      {
        reviewId: 'r1',
        authorName: 'Alex',
        rating: 5,
        text: 'Great app',
        reviewerLanguage: 'en',
        device: 'Pixel',
        appVersionName: '1.2.0',
        lastModified: new Date(1710000000 * 1000).toISOString(),
        answered: true,
        developerReply: 'Thanks!',
      },
    ]);
    expect(listReviews.mock.calls[0]?.[0].translationLanguage).toBe('en');
    expect(await client.getReview('com.example.app', 'r1')).toMatchObject({
      reviewId: 'r1',
      rating: 5,
      answered: false,
    });
    expect(await client.getReview('com.example.app', 'missing')).toBeNull();
    expect(await client.replyToReview('com.example.app', 'r1', 'Thanks!')).toEqual({
      replyText: 'Thanks for the review!',
      lastEdited: new Date(1710000100 * 1000).toISOString(),
    });
  });
});
