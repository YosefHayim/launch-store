import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { parsePlayReviewRating } from '@core/store/playReviewsCommand.js';
describe('parseRating', () => {
  it('returns undefined when the flag is absent', () => {
    expect(Effect.runSync(parsePlayReviewRating(undefined))).toBeUndefined();
  });
  it('accepts whole numbers 1-5', () => {
    expect(Effect.runSync(parsePlayReviewRating('1'))).toBe(1);
    expect(Effect.runSync(parsePlayReviewRating('5'))).toBe(5);
    expect(Effect.runSync(parsePlayReviewRating(' 3 '))).toBe(3);
  });
  it('rejects out-of-range and non-numeric input instead of silently truncating', () => {
    expect(() => Effect.runSync(parsePlayReviewRating('0'))).toThrow(/1-5/);
    expect(() => Effect.runSync(parsePlayReviewRating('6'))).toThrow(/1-5/);
    expect(() => Effect.runSync(parsePlayReviewRating('3x'))).toThrow(/1-5/);
    expect(() => Effect.runSync(parsePlayReviewRating('3.5'))).toThrow(/1-5/);
  });
});
