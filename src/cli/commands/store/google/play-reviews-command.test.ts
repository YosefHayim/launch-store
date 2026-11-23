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
