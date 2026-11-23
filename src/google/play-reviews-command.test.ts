import { describe, expect, it } from 'vitest';
import {
  parsePlayReviewRating,
  PlayReviewsCommandInputSchema,
  renderPlayReview,
} from './play-reviews-command.ts';

function describePlayReviewsCommandPieceSchema() {
  function decodesListAndReplyInputsWithoutUnsetOptionFields() {
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
  }

  it(
    'decodes list and reply inputs without unset option fields',
    decodesListAndReplyInputsWithoutUnsetOptionFields,
  );

  function rejectsExplicitUndefinedExactOptionalFields() {
    function callPlayReviewsCommandPieceSchema() {
      return PlayReviewsCommandInputSchema({
        operation: 'list',
        rating: undefined,
        unanswered: false,
        json: false,
      });
    }

    expect(callPlayReviewsCommandPieceSchema).toThrow();
  }

  it(
    'rejects explicit undefined exact optional fields',
    rejectsExplicitUndefinedExactOptionalFields,
  );
}

describe('PlayReviewsCommandInputSchema', describePlayReviewsCommandPieceSchema);

function describePlayReviewPresentation() {
  function validatesRatingsThroughTheTaggedCommandChannel() {
    const playReviewRating = parsePlayReviewRating(' 4 ');

    expect(playReviewRating).toBe(4);

    function callParsePlayReviewRating() {
      return parsePlayReviewRating('4.5');
    }

    expect(callParsePlayReviewRating).toThrow(/1-5/);
  }

  it(
    'validates ratings through the tagged command channel',
    validatesRatingsThroughTheTaggedCommandChannel,
  );

  function rendersAnAnsweredReviewWithCleanASCIIStatusPiece() {
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
  }

  it(
    'renders an answered review with clean ASCII status text',
    rendersAnAnsweredReviewWithCleanASCIIStatusPiece,
  );
}

describe('Play review presentation', describePlayReviewPresentation);

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
