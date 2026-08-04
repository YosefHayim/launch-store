import { FileSystem, type Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPromptService } from '../services/prompt.js';
import type { PlayReview } from '../types/googlePlay.js';
import { listPlayReviews, replyToPlayReview, type PlayReviewFilters } from './playReviews.js';
import {
  confirmGoogleStoreWrite,
  loadActiveGoogleStore,
  type ActiveGoogleStoreRequirements,
  resolveGoogleStorePackageName,
} from './googleStoreCommand.js';
import type { StoreAppSelectionRequirements } from './selectStoreApp.js';

const PlayReviewsListInputSchema = Schema.Struct({
  operation: Schema.Literal('list'),
  app: Schema.optionalWith(Schema.String, { exact: true }),
  rating: Schema.optionalWith(Schema.String, { exact: true }),
  unanswered: Schema.Boolean,
  lang: Schema.optionalWith(Schema.String, { exact: true }),
  json: Schema.Boolean,
});

const PlayReviewsReplyInputSchema = Schema.Struct({
  operation: Schema.Literal('reply'),
  reviewId: Schema.String,
  app: Schema.optionalWith(Schema.String, { exact: true }),
  message: Schema.optionalWith(Schema.String, { exact: true }),
  file: Schema.optionalWith(Schema.String, { exact: true }),
  yes: Schema.Boolean,
});

export const PlayReviewsCommandInputSchema = Schema.Union(
  PlayReviewsListInputSchema,
  PlayReviewsReplyInputSchema,
);

export type PlayReviewsCommandInput = Schema.Schema.Type<typeof PlayReviewsCommandInputSchema>;
export type PlayReviewsListInput = Schema.Schema.Type<typeof PlayReviewsListInputSchema>;
export type PlayReviewsReplyInput = Schema.Schema.Type<typeof PlayReviewsReplyInputSchema>;

/** A Play reviews command step failed. */
export type PlayReviewsCommandFailure = Readonly<{
  readonly _tag: 'PlayReviewsCommandFailure';
  readonly operation: PlayReviewsCommandInput['operation'];
  readonly message: string;
  readonly cause: unknown;
}>;
export const makePlayReviewsCommandFailure = Data.tagged<PlayReviewsCommandFailure>(
  'PlayReviewsCommandFailure',
);

type PlayReviewsCommandRequirements =
  | ActiveGoogleStoreRequirements
  | FileSystem.FileSystem
  | LaunchPromptService
  | Logger
  | StoreAppSelectionRequirements
  | Terminal.Terminal;

/** Convert a dependency failure into the Play reviews command channel. */
const playReviewsFailure = (
  operation: PlayReviewsCommandInput['operation'],
  cause: unknown,
): PlayReviewsCommandFailure => {
  let message = `Play reviews ${operation} failed.`;
  if (typeof cause === 'string' && cause.length > 0) message = cause;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makePlayReviewsCommandFailure({ operation, message, cause });
};

/** Parse and validate an optional one-to-five-star Play review filter. */
export const parsePlayReviewRating = (
  ratingText: string | undefined,
): Effect.Effect<number | undefined, PlayReviewsCommandFailure> => {
  if (ratingText === undefined) return Effect.succeed(undefined);
  const trimmedRating = ratingText.trim();
  const parsedRating = Number(trimmedRating);
  if (/^\d+$/.test(trimmedRating) && parsedRating >= 1 && parsedRating <= 5) {
    return Effect.succeed(parsedRating);
  }
  return Effect.fail(
    makePlayReviewsCommandFailure({
      operation: 'list',
      message: `--rating must be a whole number 1-5 (got "${ratingText}").`,
      cause: ratingText,
    }),
  );
};

/** Render one Play customer review as a copy-pasteable text block. */
export const renderPlayReview = (playReview: PlayReview): string => {
  const reviewDetails: string[] = [];
  if (playReview.reviewerLanguage !== undefined) {
    reviewDetails.push(playReview.reviewerLanguage);
  }
  if (playReview.lastModified !== undefined) {
    reviewDetails.push(playReview.lastModified.slice(0, 10));
  }
  if (playReview.appVersionName !== undefined) {
    reviewDetails.push(`v${playReview.appVersionName}`);
  }
  if (playReview.authorName !== undefined) reviewDetails.push(`by ${playReview.authorName}`);
  if (playReview.answered) reviewDetails.push('OK answered');
  if (!playReview.answered) reviewDetails.push('- unanswered');
  const reviewLines = [
    `${playReview.reviewId}  ${playReview.rating}/5`,
    `  ${reviewDetails.join('  ')}`,
  ];
  if (playReview.text !== undefined) reviewLines.push(`  ${playReview.text}`);
  if (playReview.developerReply !== undefined) {
    reviewLines.push(`  -> reply: ${playReview.developerReply}`);
  }
  return reviewLines.join('\n');
};

/** Resolve a developer reply from inline text or a file. */
const readPlayReplyText = (
  commandInput: PlayReviewsReplyInput,
): Effect.Effect<string, PlayReviewsCommandFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (commandInput.file !== undefined) {
      const fileSystem = yield* FileSystem.FileSystem;
      return yield* fileSystem.readFileString(commandInput.file).pipe(
        Effect.map((fileText) => fileText.trim()),
        Effect.mapError((cause) => playReviewsFailure('reply', cause)),
      );
    }
    if (commandInput.message !== undefined) return commandInput.message;
    return yield* Effect.fail(
      makePlayReviewsCommandFailure({
        operation: 'reply',
        message: 'A reply body is required. Pass -m/--message <text> or --file <path>.',
        cause: 'missing-reply',
      }),
    );
  });

/** List and render the selected app's recent Play reviews. */
const listRecentPlayReviews = (
  commandInput: PlayReviewsListInput,
): Effect.Effect<void, PlayReviewsCommandFailure, PlayReviewsCommandRequirements> =>
  Effect.gen(function* () {
    const rating = yield* parsePlayReviewRating(commandInput.rating);
    const packageName = yield* resolveGoogleStorePackageName(commandInput.app);
    const googleStore = yield* loadActiveGoogleStore();
    let reviewFilters: PlayReviewFilters = { unansweredOnly: commandInput.unanswered };
    if (rating !== undefined) reviewFilters = { ...reviewFilters, rating };
    if (commandInput.lang !== undefined) {
      reviewFilters = { ...reviewFilters, translationLanguage: commandInput.lang };
    }
    const matchingReviews = yield* listPlayReviews(googleStore, packageName, reviewFilters);
    const logger = yield* createLogger(false);
    if (commandInput.json) {
      yield* logger.line(JSON.stringify(matchingReviews, null, 2));
      return;
    }
    if (matchingReviews.length === 0) {
      yield* logger.line(
        'No reviews match. Try removing a filter, or check back later (Play shows only recent reviews).',
      );
      return;
    }
    yield* logger.line(matchingReviews.map(renderPlayReview).join('\n\n'));
    let reviewSuffix = 's';
    if (matchingReviews.length === 1) reviewSuffix = '';
    yield* logger.line(`\n${matchingReviews.length} review${reviewSuffix}.`);
  }).pipe(Effect.mapError((cause) => playReviewsFailure('list', cause)));

/** Confirm and post or replace a Play developer reply. */
const replyToRecentPlayReview = (
  commandInput: PlayReviewsReplyInput,
): Effect.Effect<void, PlayReviewsCommandFailure, PlayReviewsCommandRequirements> =>
  Effect.gen(function* () {
    const replyText = yield* readPlayReplyText(commandInput);
    const packageName = yield* resolveGoogleStorePackageName(commandInput.app);
    const googleStore = yield* loadActiveGoogleStore();
    const existingReview = yield* googleStore.getReview(packageName, commandInput.reviewId);
    let confirmationVerb = 'Post a public reply to';
    if (existingReview?.answered) {
      confirmationVerb = 'Replace the existing reply to';
    }
    const confirmed = yield* confirmGoogleStoreWrite(
      `${confirmationVerb} review ${commandInput.reviewId}?`,
      commandInput.yes,
      'Refusing to post without confirmation. Re-run with --yes (non-interactive).',
      'Aborted - nothing posted.',
    );
    if (!confirmed) return;
    const replyOutcome = yield* replyToPlayReview(
      googleStore,
      packageName,
      commandInput.reviewId,
      replyText,
      existingReview,
    );
    let operationLabel = 'reply posted';
    if (replyOutcome.replaced) operationLabel = 'reply replaced';
    const logger = yield* createLogger(false);
    let editedDetail: string | undefined;
    if (replyOutcome.reply.lastEdited !== undefined) {
      editedDetail = `edited: ${replyOutcome.reply.lastEdited}`;
    }
    yield* logger.step(operationLabel, editedDetail);
  }).pipe(Effect.mapError((cause) => playReviewsFailure('reply', cause)));

/** Dispatch one decoded Play reviews operation. */
const runPlayReviewsOperation = (
  commandInput: PlayReviewsCommandInput,
): Effect.Effect<void, PlayReviewsCommandFailure, PlayReviewsCommandRequirements> => {
  switch (commandInput.operation) {
    case 'list':
      return listRecentPlayReviews(commandInput);
    case 'reply':
      return replyToRecentPlayReview(commandInput);
  }
};

/** Run one schema-decoded Play reviews operation. */
export const playReviewsCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, PlayReviewsCommandFailure, PlayReviewsCommandRequirements> =>
  Schema.decodeUnknown(PlayReviewsCommandInputSchema)(rawCommandInput).pipe(
    Effect.mapError((cause) => playReviewsFailure('list', cause)),
    Effect.flatMap(runPlayReviewsOperation),
  );
