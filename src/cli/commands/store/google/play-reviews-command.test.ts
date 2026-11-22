import { describe, expect, it } from 'vitest';
import {
  parsePlayReviewRating,
  PlayReviewsCommandInputSchema,
  renderPlayReview,
} from './play-reviews-command.ts';

describe('PlayReviewsCommandInputSchema', () => {
  it('decodes list and reply inputs without unset option fields', () => {
    const playReviewsCommandSchema = PlayReviewsCommandInputSchema({
      operation: 'list',
      unanswered: false,
      json: true,
    });
    expect(playReviewsCommandSchema).toEqual({ operation: 'list', unanswered: false, json: true });
    expect(
      PlayReviewsCommandInputSchema({
        operation: 'reply',
        reviewId: 'review-1',
        yes: false,
      }),
    ).toEqual({ operation: 'reply', reviewId: 'review-1', yes: false });
  });

  it('rejects explicit undefined exact optional fields', () => {
    expect(() =>
      PlayReviewsCommandInputSchema({
        operation: 'list',
        rating: undefined,
        unanswered: false,
        json: false,
      }),
    ).toThrow();
  });
});

describe('Play review presentation', () => {
  it('validates ratings through the tagged command channel', () => {
    const playReviewRating = parsePlayReviewRating(' 4 ');
    expect(playReviewRating).toBe(4);
    expect(() => parsePlayReviewRating('4.5')).toThrow(/1-5/);
  });

  it('renders an answered review with clean ASCII status text', () => {
    const playReview = renderPlayReview({
      reviewId: 'review-1',
      authorName: 'Ada',
      rating: 5,
      text: 'Useful.',
      reviewerLanguage: 'en',
      appVersionName: '2.0',
      lastModified: '2026-08-04T12:00:00Z',
      answered: true,
      developerReply: 'Thank you.',
    });
    expect(playReview).toBe(
      'review-1  5/5\n  en  2026-08-04  v2.0  by Ada  OK answered\n  Useful.\n  -> reply: Thank you.',
    );
  });
});
