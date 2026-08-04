import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { parseReviewRating } from '@core/store/reviewsCommand.js';
describe('parseRating', () => {
  it('returns undefined when the flag is absent', () => {
    expect(Effect.runSync(parseReviewRating(undefined))).toBeUndefined();
  });
  it('accepts whole numbers 1-5', () => {
    expect(Effect.runSync(parseReviewRating('1'))).toBe(1);
    expect(Effect.runSync(parseReviewRating('5'))).toBe(5);
    expect(Effect.runSync(parseReviewRating(' 3 '))).toBe(3);
  });
  it('rejects out-of-range values', () => {
    expect(Effect.runSync(Effect.flip(parseReviewRating('0'))).message).toContain('1-5');
    expect(Effect.runSync(Effect.flip(parseReviewRating('6'))).message).toContain('1-5');
  });
  it('rejects non-numeric input instead of silently truncating it', () => {
    expect(Effect.runSync(Effect.flip(parseReviewRating('3x'))).message).toContain('1-5');
    expect(Effect.runSync(Effect.flip(parseReviewRating('abc'))).message).toContain('1-5');
    expect(Effect.runSync(Effect.flip(parseReviewRating('3.5'))).message).toContain('1-5');
  });
});
