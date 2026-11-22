import { readFile } from 'node:fs/promises';
import { createLogger } from '../../services/platform/logger.js';
import { LaunchPrompt } from '../../services/platform/prompt.js';
import { checkTerminalIsInteractive } from '../../services/platform/progress.js';
import type { CustomerReviewResource } from '../../types/appleCatalog.js';
import { loadActiveAppleStore } from './appleStoreCommand.js';
import { deleteReviewResponse, listReviews, replyToReview } from './reviews.js';
import { resolveStoreBundleId } from '../shared/selectStoreApp.js';
import { hasMessage } from '../../services/platform/errorMessage.js';

/** Options for listing App Store customer reviews. */
export type ReviewsListCommandInput = Readonly<{
  operation: 'list';
  app?: string | undefined;
  rating?: string | undefined;
  territory?: string | undefined;
  unanswered: boolean;
  json: boolean;
}>;

/** Options for posting or replacing a developer reply. */
export type ReviewReplyCommandInput = Readonly<{
  operation: 'reply';
  reviewId: string;
  message?: string | undefined;
  file?: string | undefined;
  yes: boolean;
}>;

/** One customer-reviews operation selected by Commander. */
type ReviewsCommandInput =
  | ReviewsListCommandInput
  | ReviewReplyCommandInput
  | Readonly<{ operation: 'delete'; reviewId: string; yes: boolean }>;

/** A customer-reviews command failed before it could complete. */
type ReviewsCommandFailure = Readonly<{
  readonly _tag: 'ReviewsCommandFailure';
  readonly operation: ReviewsCommandInput['operation'];
  readonly message: string;
  readonly cause: unknown;
}>;

function makeReviewsCommandFailure(fields: {
  operation: ReviewsCommandInput['operation'];
  message: string;
  cause: unknown;
}): ReviewsCommandFailure {
  return { _tag: 'ReviewsCommandFailure', ...fields };
}

/** Convert any dependency failure into the reviews command channel. */
function reviewsFailure(
  operation: ReviewsCommandInput['operation'],
  cause: unknown,
): ReviewsCommandFailure {
  if (hasMessage(cause)) {
    return makeReviewsCommandFailure({ operation, message: cause.message, cause });
  }

  return makeReviewsCommandFailure({
    operation,
    message: `Reviews ${operation} failed.`,
    cause,
  });
}

function isValidReviewRating(isWholeNumber: boolean, parsedRating: number): boolean {
  if (isWholeNumber == false) {
    return false;
  }

  if (parsedRating < 1) {
    return false;
  }

  return parsedRating <= 5;
}

/** Parse and validate an optional one-to-five-star rating filter. */
export function parseReviewRating(ratingText: string | undefined): number | undefined {
  const isMissing = ratingText == null;

  if (isMissing) {
    return undefined;
  }

  const trimmedRating = ratingText.trim();
  const parsedRating = Number(trimmedRating);
  // Matches a whole number made only of digits.
  const isWholeNumber = /^\d+$/.test(trimmedRating);
  const isValidRating = isValidReviewRating(isWholeNumber, parsedRating);

  if (isValidRating) {
    return parsedRating;
  }

  throw makeReviewsCommandFailure({
    operation: 'list',
    message: `--rating must be a whole number 1-5 (got "${ratingText}").`,
    cause: ratingText,
  });
}

function isPresentDetail(reviewDetail: string | undefined): reviewDetail is string {
  return reviewDetail != null;
}

/** Render one App Store customer review as a readable block. */
function renderCustomerReview(customerReview: CustomerReviewResource): string {
  const reviewDetails = [customerReview.territory];
  const hasCreatedDate = customerReview.createdDate != null;

  if (hasCreatedDate) {
    reviewDetails.push(customerReview.createdDate.slice(0, 10));
  }

  const hasNickname = customerReview.reviewerNickname != null;

  if (hasNickname) {
    reviewDetails.push(`by ${customerReview.reviewerNickname}`);
  }

  const isAnswered = customerReview.answered == true;

  if (isAnswered) {
    reviewDetails.push('OK answered');
  }

  const isUnanswered = customerReview.answered == false;

  if (isUnanswered) {
    reviewDetails.push('- unanswered');
  }

  const reviewLines = [
    `${customerReview.id}  ${customerReview.rating}/5`,
    `  ${reviewDetails.filter(isPresentDetail).join('  ')}`,
  ];
  const hasTitle = customerReview.title != null;

  if (hasTitle) {
    reviewLines.push(`  "${customerReview.title}"`);
  }

  const hasReviewText = customerReview.body != null;

  if (hasReviewText) {
    reviewLines.push(`  ${customerReview.body}`);
  }

  return reviewLines.join('\n');
}

function reviewBlock(customerReview: CustomerReviewResource): string {
  return renderCustomerReview(customerReview);
}

/** Confirm an outward-facing review write. */
async function confirmReviewWrite(
  operation: 'reply' | 'delete',
  confirmationMessage: string,
  confirmed: boolean,
): Promise<boolean> {
  const isConfirmed = confirmed == true;

  if (isConfirmed) {
    return true;
  }

  const terminalIsInteractive = checkTerminalIsInteractive();
  const needsATerminal = terminalIsInteractive == false;

  if (needsATerminal) {
    let refusalMessage =
      'Refusing to post without confirmation. Re-run with --yes (non-interactive).';
    const isDelete = operation == 'delete';

    if (isDelete) {
      refusalMessage =
        'Refusing to delete without confirmation. Re-run with --yes (non-interactive).';
    }

    throw makeReviewsCommandFailure({
      operation,
      message: refusalMessage,
      cause: 'confirmation-required',
    });
  }

  let shouldWrite = false;

  try {
    shouldWrite = await LaunchPrompt.confirm(confirmationMessage);
  } catch (cause) {
    throw reviewsFailure(operation, cause);
  }

  if (shouldWrite) {
    return true;
  }

  LaunchPrompt.cancel('Aborted - nothing posted.');
  return false;
}

/** List customer reviews for the selected app. */
async function listReviewsProgram(commandInput: ReviewsListCommandInput): Promise<void> {
  try {
    const rating = parseReviewRating(commandInput.rating);
    const reviewFilters: {
      rating?: number;
      territory?: string;
      unansweredOnly: boolean;
    } = { unansweredOnly: commandInput.unanswered };
    const hasRating = rating != null;

    if (hasRating) {
      reviewFilters.rating = rating;
    }

    const hasTerritory = commandInput.territory != null;

    if (hasTerritory) {
      reviewFilters.territory = commandInput.territory;
    }

    const bundleId = await resolveStoreBundleId(commandInput.app);
    const appleStore = await loadActiveAppleStore();
    const customerReviews = await listReviews(appleStore, bundleId, reviewFilters);
    const logger = createLogger(false);
    const wantsJson = commandInput.json == true;

    if (wantsJson) {
      logger.line(JSON.stringify(customerReviews, null, 2));
      return;
    }

    const isEmpty = customerReviews.length == 0;

    if (isEmpty) {
      logger.line('No reviews match. Try removing a filter, or check back later.');
      return;
    }

    logger.line(customerReviews.map(reviewBlock).join('\n\n'));
    let reviewSuffix = 's';
    const isSingleReview = customerReviews.length == 1;

    if (isSingleReview) {
      reviewSuffix = '';
    }

    logger.line(`\n${customerReviews.length} review${reviewSuffix}.`);
  } catch (cause) {
    throw reviewsFailure('list', cause);
  }
}

/** Resolve a developer reply from inline text or a file. */
async function readReplyText(commandInput: ReviewReplyCommandInput): Promise<string> {
  const hasFile = commandInput.file != null;

  if (hasFile) {
    try {
      const fileText = await readFile(commandInput.file, 'utf8');
      return fileText.trim();
    } catch (cause) {
      throw reviewsFailure('reply', cause);
    }
  }

  const hasReplyText = commandInput.message != null;

  if (hasReplyText) {
    return commandInput.message;
  }

  throw makeReviewsCommandFailure({
    operation: 'reply',
    message: 'A reply is required. Pass -m/--message <text> or --file <path>.',
    cause: 'missing-reply',
  });
}

/** Confirm and post or replace a developer reply. */
async function replyToReviewProgram(commandInput: ReviewReplyCommandInput): Promise<void> {
  try {
    const replyText = await readReplyText(commandInput);
    const appleStore = await loadActiveAppleStore();
    const existingReply = await appleStore.getCustomerReviewResponse(commandInput.reviewId);
    let confirmationVerb = 'Post a public reply to';
    const replacesReply = existingReply != null;

    if (replacesReply) {
      confirmationVerb = 'Replace the existing reply to';
    }

    const shouldReply = await confirmReviewWrite(
      'reply',
      `${confirmationVerb} review ${commandInput.reviewId}?`,
      commandInput.yes,
    );
    const declined = shouldReply == false;

    if (declined) {
      return;
    }

    const replyOutcome = await replyToReview(appleStore, commandInput.reviewId, replyText);
    let operationLabel = 'reply posted';
    const replacedExisting = replyOutcome.replaced == true;

    if (replacedExisting) {
      operationLabel = 'reply replaced';
    }

    const logger = createLogger(false);
    logger.step(operationLabel, replyOutcome.reviewReply.state);
  } catch (cause) {
    throw reviewsFailure('reply', cause);
  }
}

/** Confirm and delete a developer reply. */
async function deleteReviewReplyProgram(
  commandInput: Extract<ReviewsCommandInput, { operation: 'delete' }>,
): Promise<void> {
  try {
    const shouldDelete = await confirmReviewWrite(
      'delete',
      `Delete the developer response to review ${commandInput.reviewId}?`,
      commandInput.yes,
    );
    const declined = shouldDelete == false;

    if (declined) {
      return;
    }

    const appleStore = await loadActiveAppleStore();
    const deleted = await deleteReviewResponse(appleStore, commandInput.reviewId);
    const logger = createLogger(false);

    if (deleted) {
      logger.step('reply deleted', commandInput.reviewId);
      return;
    }

    logger.note(`No developer response on review ${commandInput.reviewId} - nothing to delete.`);
  } catch (cause) {
    throw reviewsFailure('delete', cause);
  }
}

/** Run one customer-reviews operation. */
export async function reviewsCommandProgram(commandInput: ReviewsCommandInput): Promise<void> {
  if (commandInput.operation == 'list') {
    await listReviewsProgram(commandInput);
    return;
  }

  if (commandInput.operation == 'reply') {
    await replyToReviewProgram(commandInput);
    return;
  }

  await deleteReviewReplyProgram(commandInput);
}
