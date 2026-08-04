import { FileSystem, Terminal } from '@effect/platform';
import { Data, Effect } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { CustomerReviewResource } from '../types/appleCatalog.js';
import { loadActiveAppleStore, type ActiveAppleStoreRequirements } from './appleStoreCommand.js';
import { deleteReviewResponse, listReviews, replyToReview } from './reviews.js';
import { resolveStoreBundleId, type StoreAppSelectionRequirements } from './selectStoreApp.js';

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
export type ReviewsCommandInput =
  | ReviewsListCommandInput
  | ReviewReplyCommandInput
  | Readonly<{ operation: 'delete'; reviewId: string; yes: boolean }>;

/** A customer-reviews command failed before it could complete. */
export type ReviewsCommandFailure = Readonly<{
  readonly _tag: 'ReviewsCommandFailure';
  readonly operation: ReviewsCommandInput['operation'];
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeReviewsCommandFailure =
  Data.tagged<ReviewsCommandFailure>('ReviewsCommandFailure');

type ReviewsCommandRequirements =
  | ActiveAppleStoreRequirements
  | FileSystem.FileSystem
  | LaunchPromptService
  | Logger
  | StoreAppSelectionRequirements
  | Terminal.Terminal;

/** Convert any dependency failure into the reviews command channel. */
const reviewsFailure = (
  operation: ReviewsCommandInput['operation'],
  cause: unknown,
): ReviewsCommandFailure => {
  let message = `Reviews ${operation} failed.`;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makeReviewsCommandFailure({ operation, message, cause });
};

/** Parse and validate an optional one-to-five-star rating filter. */
export const parseReviewRating = (
  ratingText: string | undefined,
): Effect.Effect<number | undefined, ReviewsCommandFailure> => {
  if (ratingText === undefined) return Effect.succeed(undefined);
  const trimmedRating = ratingText.trim();
  const parsedRating = Number(trimmedRating);
  if (/^\d+$/.test(trimmedRating) && parsedRating >= 1 && parsedRating <= 5) {
    return Effect.succeed(parsedRating);
  }
  return Effect.fail(
    makeReviewsCommandFailure({
      operation: 'list',
      message: `--rating must be a whole number 1-5 (got "${ratingText}").`,
      cause: ratingText,
    }),
  );
};

/** Render one App Store customer review as a readable block. */
export const renderCustomerReview = (customerReview: CustomerReviewResource): string => {
  const reviewDetails = [customerReview.territory];
  if (customerReview.createdDate !== undefined) {
    reviewDetails.push(customerReview.createdDate.slice(0, 10));
  }
  if (customerReview.reviewerNickname !== undefined) {
    reviewDetails.push(`by ${customerReview.reviewerNickname}`);
  }
  if (customerReview.answered) reviewDetails.push('OK answered');
  if (!customerReview.answered) reviewDetails.push('- unanswered');
  const reviewLines = [
    `${customerReview.id}  ${customerReview.rating}/5`,
    `  ${reviewDetails.filter((reviewDetail) => reviewDetail !== undefined).join('  ')}`,
  ];
  if (customerReview.title !== undefined) reviewLines.push(`  "${customerReview.title}"`);
  if (customerReview.body !== undefined) reviewLines.push(`  ${customerReview.body}`);
  return reviewLines.join('\n');
};

/** Confirm an outward-facing review write. */
const confirmReviewWrite = (
  operation: 'reply' | 'delete',
  confirmationMessage: string,
  confirmed: boolean,
): Effect.Effect<boolean, ReviewsCommandFailure, LaunchPromptService | Terminal.Terminal> =>
  Effect.gen(function* () {
    if (confirmed) return true;
    const terminal = yield* Terminal.Terminal;
    const terminalIsInteractive = yield* terminal.isTTY;
    if (!terminalIsInteractive) {
      let refusalMessage =
        'Refusing to post without confirmation. Re-run with --yes (non-interactive).';
      if (operation === 'delete') {
        refusalMessage =
          'Refusing to delete without confirmation. Re-run with --yes (non-interactive).';
      }
      return yield* Effect.fail(
        makeReviewsCommandFailure({
          operation,
          message: refusalMessage,
          cause: 'confirmation-required',
        }),
      );
    }
    const prompt = yield* LaunchPrompt;
    const shouldWrite = yield* prompt
      .confirm(confirmationMessage)
      .pipe(Effect.mapError((cause) => reviewsFailure(operation, cause)));
    if (shouldWrite) return true;
    yield* prompt.cancel('Aborted - nothing posted.');
    return false;
  });

/** List customer reviews for the selected app. */
const listReviewsProgram = (
  commandInput: ReviewsListCommandInput,
): Effect.Effect<void, ReviewsCommandFailure, ReviewsCommandRequirements> =>
  Effect.gen(function* () {
    const rating = yield* parseReviewRating(commandInput.rating);
    const reviewFilters: {
      rating?: number;
      territory?: string;
      unansweredOnly: boolean;
    } = { unansweredOnly: commandInput.unanswered };
    if (rating !== undefined) reviewFilters.rating = rating;
    if (commandInput.territory !== undefined) reviewFilters.territory = commandInput.territory;
    const bundleId = yield* resolveStoreBundleId(commandInput.app);
    const appleStore = yield* loadActiveAppleStore();
    const customerReviews = yield* listReviews(appleStore, bundleId, reviewFilters);
    const logger = yield* createLogger(false);
    if (commandInput.json) {
      yield* logger.line(JSON.stringify(customerReviews, null, 2));
      return;
    }
    if (customerReviews.length === 0) {
      yield* logger.line('No reviews match. Try removing a filter, or check back later.');
      return;
    }
    yield* logger.line(customerReviews.map(renderCustomerReview).join('\n\n'));
    let reviewSuffix = 's';
    if (customerReviews.length === 1) reviewSuffix = '';
    yield* logger.line(`\n${customerReviews.length} review${reviewSuffix}.`);
  }).pipe(Effect.mapError((cause) => reviewsFailure('list', cause)));

/** Resolve a developer reply from inline text or a file. */
const readReplyText = (
  commandInput: ReviewReplyCommandInput,
): Effect.Effect<string, ReviewsCommandFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (commandInput.file !== undefined) {
      const fileSystem = yield* FileSystem.FileSystem;
      return yield* fileSystem.readFileString(commandInput.file).pipe(
        Effect.map((fileText) => fileText.trim()),
        Effect.mapError((cause) => reviewsFailure('reply', cause)),
      );
    }
    if (commandInput.message !== undefined) return commandInput.message;
    return yield* Effect.fail(
      makeReviewsCommandFailure({
        operation: 'reply',
        message: 'A reply is required. Pass -m/--message <text> or --file <path>.',
        cause: 'missing-reply',
      }),
    );
  });

/** Confirm and post or replace a developer reply. */
const replyToReviewProgram = (
  commandInput: ReviewReplyCommandInput,
): Effect.Effect<void, ReviewsCommandFailure, ReviewsCommandRequirements> =>
  Effect.gen(function* () {
    const replyText = yield* readReplyText(commandInput);
    const appleStore = yield* loadActiveAppleStore();
    const existingReply = yield* appleStore.getCustomerReviewResponse(commandInput.reviewId);
    let confirmationVerb = 'Post a public reply to';
    if (existingReply !== null) confirmationVerb = 'Replace the existing reply to';
    const shouldReply = yield* confirmReviewWrite(
      'reply',
      `${confirmationVerb} review ${commandInput.reviewId}?`,
      commandInput.yes,
    );
    if (!shouldReply) return;
    const replyOutcome = yield* replyToReview(appleStore, commandInput.reviewId, replyText);
    let operationLabel = 'reply posted';
    if (replyOutcome.replaced) operationLabel = 'reply replaced';
    const logger = yield* createLogger(false);
    yield* logger.step(operationLabel, replyOutcome.reviewReply.state);
  }).pipe(Effect.mapError((cause) => reviewsFailure('reply', cause)));

/** Confirm and delete a developer reply. */
const deleteReviewReplyProgram = (
  commandInput: Extract<ReviewsCommandInput, { operation: 'delete' }>,
): Effect.Effect<void, ReviewsCommandFailure, ReviewsCommandRequirements> =>
  Effect.gen(function* () {
    const shouldDelete = yield* confirmReviewWrite(
      'delete',
      `Delete the developer response to review ${commandInput.reviewId}?`,
      commandInput.yes,
    );
    if (!shouldDelete) return;
    const appleStore = yield* loadActiveAppleStore();
    const deleted = yield* deleteReviewResponse(appleStore, commandInput.reviewId);
    const logger = yield* createLogger(false);
    if (deleted) {
      yield* logger.step('reply deleted', commandInput.reviewId);
      return;
    }
    yield* logger.note(
      `No developer response on review ${commandInput.reviewId} - nothing to delete.`,
    );
  }).pipe(Effect.mapError((cause) => reviewsFailure('delete', cause)));

/** Run one customer-reviews operation through the shared Effect runtime. */
export const reviewsCommandProgram = (
  commandInput: ReviewsCommandInput,
): Effect.Effect<void, ReviewsCommandFailure, ReviewsCommandRequirements> => {
  switch (commandInput.operation) {
    case 'list':
      return listReviewsProgram(commandInput);
    case 'reply':
      return replyToReviewProgram(commandInput);
    case 'delete':
      return deleteReviewReplyProgram(commandInput);
  }
};
