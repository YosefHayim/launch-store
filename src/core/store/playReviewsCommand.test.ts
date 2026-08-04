import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  parsePlayReviewRating,
  PlayReviewsCommandInputSchema,
  renderPlayReview,
} from './playReviewsCommand.js';

describe('PlayReviewsCommandInputSchema', () => {
  it('decodes list and reply inputs without unset option fields', () => {
    expect(
      Schema.decodeUnknownSync(PlayReviewsCommandInputSchema)({
        operation: 'list',
        unanswered: false,
        json: true,
      }),
    ).toEqual({ operation: 'list', unanswered: false, json: true });
    expect(
      Schema.decodeUnknownSync(PlayReviewsCommandInputSchema)({
        operation: 'reply',
        reviewId: 'review-1',
        yes: false,
      }),
    ).toEqual({ operation: 'reply', reviewId: 'review-1', yes: false });
  });

  it('rejects explicit undefined exact optional fields', () => {
    expect(() =>
      Schema.decodeUnknownSync(PlayReviewsCommandInputSchema)({
        operation: 'list',
        rating: undefined,
        unanswered: false,
        json: false,
      }),
    ).toThrow();
  });
});

describe('Play review presentation', () => {
  it('validates ratings through the tagged Effect channel', () => {
    expect(Effect.runSync(parsePlayReviewRating(' 4 '))).toBe(4);
    expect(() => Effect.runSync(parsePlayReviewRating('4.5'))).toThrow(/1-5/);
  });

  it('renders an answered review with clean ASCII status text', () => {
    expect(
      renderPlayReview({
        reviewId: 'review-1',
        authorName: 'Ada',
        rating: 5,
        text: 'Useful.',
        reviewerLanguage: 'en',
        appVersionName: '2.0',
        lastModified: '2026-08-04T12:00:00Z',
        answered: true,
        developerReply: 'Thank you.',
      }),
    ).toBe(
      'review-1  5/5\n  en  2026-08-04  v2.0  by Ada  OK answered\n  Useful.\n  -> reply: Thank you.',
    );
  });
});
