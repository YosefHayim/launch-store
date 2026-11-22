import { describe, expect, it } from 'vitest';
import { parsePlayReviewRating } from './play-reviews-command.ts';

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
    const playReviewRating = parsePlayReviewRating(undefined);
    expect(playReviewRating).toBeUndefined();
  });
  it('accepts whole numbers 1-5', () => {
    const playReviewRating = parsePlayReviewRating('1');
    expect(playReviewRating).toBe(1);
    expect(parsePlayReviewRating('5')).toBe(5);
    expect(parsePlayReviewRating(' 3 ')).toBe(3);
  });
  it('rejects out-of-range and non-numeric input instead of silently truncating', () => {
    const ratingFailure = readRatingFailure('0');
    expect(ratingFailure).toMatchObject({ message: expect.stringContaining('1-5') });
    expect(readRatingFailure('6')).toMatchObject({ message: expect.stringContaining('1-5') });
    expect(readRatingFailure('3x')).toMatchObject({ message: expect.stringContaining('1-5') });
    expect(readRatingFailure('3.5')).toMatchObject({ message: expect.stringContaining('1-5') });
  });
});
