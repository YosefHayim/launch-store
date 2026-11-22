import { describe, expect, it } from 'vitest';
import { parsePlayReviewRating } from '@/store/google/playReviewsCommand.js';

function readRatingFailure(ratingText: string): unknown {
  try {
    parsePlayReviewRating(ratingText);
  } catch (caught) {
    return caught;
  }

  return null;
}

describe('parseRating', () => {
  it('returns undefined when the flag is absent', () => {
    expect(parsePlayReviewRating(undefined)).toBeUndefined();
  });
  it('accepts whole numbers 1-5', () => {
    expect(parsePlayReviewRating('1')).toBe(1);
    expect(parsePlayReviewRating('5')).toBe(5);
    expect(parsePlayReviewRating(' 3 ')).toBe(3);
  });
  it('rejects out-of-range and non-numeric input instead of silently truncating', () => {
    expect(readRatingFailure('0')).toMatchObject({ message: expect.stringContaining('1-5') });
    expect(readRatingFailure('6')).toMatchObject({ message: expect.stringContaining('1-5') });
    expect(readRatingFailure('3x')).toMatchObject({ message: expect.stringContaining('1-5') });
    expect(readRatingFailure('3.5')).toMatchObject({ message: expect.stringContaining('1-5') });
  });
});
