import { describe, expect, it } from 'vitest';
import { parseReviewRating } from './reviews-command.ts';

function readRatingFailure(ratingText: string): unknown {
  try {
    parseReviewRating(ratingText);
  } catch (caught) {
    return caught;
  }

  return null;
}
function describeParseRating() {
  function returnsUndefinedWhenTheFlagIsAbsent() {
    const reviewRating = parseReviewRating(undefined);
    expect(reviewRating).toBeUndefined();
  }

  it('returns undefined when the flag is absent', returnsUndefinedWhenTheFlagIsAbsent);

  function acceptsWholeNumbers15() {
    const reviewRating = parseReviewRating('1');
    expect(reviewRating).toBe(1);
    expect(parseReviewRating('5')).toBe(5);
    expect(parseReviewRating(' 3 ')).toBe(3);
  }

  it('accepts whole numbers 1-5', acceptsWholeNumbers15);

  function rejectsOutOfRangeValues() {
    const ratingFailure = readRatingFailure('0');
    expect(ratingFailure).toMatchObject({ message: expect.stringContaining('1-5') });
    expect(readRatingFailure('6')).toMatchObject({ message: expect.stringContaining('1-5') });
  }

  it('rejects out-of-range values', rejectsOutOfRangeValues);

  function rejectsNonNumericPieceInsteadOfSilentlyTruncatingIt() {
    const ratingFailure = readRatingFailure('3x');
    expect(ratingFailure).toMatchObject({ message: expect.stringContaining('1-5') });
    expect(readRatingFailure('abc')).toMatchObject({ message: expect.stringContaining('1-5') });
    expect(readRatingFailure('3.5')).toMatchObject({ message: expect.stringContaining('1-5') });
  }

  it(
    'rejects non-numeric input instead of silently truncating it',
    rejectsNonNumericPieceInsteadOfSilentlyTruncatingIt,
  );
}

describe('parseRating', describeParseRating);
