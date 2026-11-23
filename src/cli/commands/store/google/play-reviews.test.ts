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

function describeParseRating() {
  function returnsUndefinedWhenTheFlagIsAbsent() {
    const playReviewRating = parsePlayReviewRating(undefined);
    expect(playReviewRating).toBeUndefined();
  }

  it('returns undefined when the flag is absent', returnsUndefinedWhenTheFlagIsAbsent);

  function acceptsWholeNumbers15() {
    const playReviewRating = parsePlayReviewRating('1');
    expect(playReviewRating).toBe(1);
    expect(parsePlayReviewRating('5')).toBe(5);
    expect(parsePlayReviewRating(' 3 ')).toBe(3);
  }

  it('accepts whole numbers 1-5', acceptsWholeNumbers15);

  function rejectsOutOfRangeAndNonNumericPieceInsteadOfSilentlyTruncating() {
    const ratingFailure = readRatingFailure('0');

    expect(ratingFailure).toMatchObject({ message: expect.stringContaining('1-5') });
    expect(readRatingFailure('6')).toMatchObject({ message: expect.stringContaining('1-5') });
    expect(readRatingFailure('3x')).toMatchObject({ message: expect.stringContaining('1-5') });
    expect(readRatingFailure('3.5')).toMatchObject({ message: expect.stringContaining('1-5') });
  }

  it(
    'rejects out-of-range and non-numeric input instead of silently truncating',
    rejectsOutOfRangeAndNonNumericPieceInsteadOfSilentlyTruncating,
  );
}

describe('parseRating', describeParseRating);
