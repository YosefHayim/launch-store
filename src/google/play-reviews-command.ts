// Lists Google Play reviews and posts or replaces a developer reply.

import { readFile } from 'node:fs/promises';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import type { PlayReview } from '../types/google/reviews.ts';
import {
  confirmGoogleStoreWrite,
  loadActiveGoogleStore,
  readGoogleStoreApp,
} from './google-store-command.ts';
import { listPlayReviews, replyToPlayReview, type PlayReviewFilters } from './play-reviews.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import type { Command } from '../cli/command.ts';
import { runCliProgram } from '../cli/run-cli-program.ts';

export type PlayReviewsListInput = {
  operation: 'list';
  app?: string;
  rating?: string;
  unanswered: boolean;
  lang?: string;
  json: boolean;
};

export type PlayReviewsReplyInput = {
  operation: 'reply';
  reviewId: string;
  app?: string;
  message?: string;
  file?: string;
  yes: boolean;
};

type PlayReviewsCommandInput = PlayReviewsListInput | PlayReviewsReplyInput;

function readRequiredBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];

  if (typeof field != 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return field;
}

function readRequiredString(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return field;
}

function readExactOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
): string | null {
  if (Object.hasOwn(record, fieldName) == false) {
    return null;
  }

  const field = record[fieldName];

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return field;
}

function copyOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
  target: { app?: string; rating?: string; lang?: string; message?: string; file?: string },
): void {
  const text = readExactOptionalString(record, fieldName);

  if (text == null) {
    return;
  }

  if (fieldName == 'app') {
    target.app = text;
    return;
  }

  if (fieldName == 'rating') {
    target.rating = text;
    return;
  }

  if (fieldName == 'lang') {
    target.lang = text;
    return;
  }

  if (fieldName == 'message') {
    target.message = text;
    return;
  }

  if (fieldName == 'file') {
    target.file = text;
  }
}

function decodeListInput(record: Record<string, unknown>): PlayReviewsListInput {
  const commandInput: PlayReviewsListInput = {
    operation: 'list',
    unanswered: readRequiredBoolean(record, 'unanswered'),
    json: readRequiredBoolean(record, 'json'),
  };

  copyOptionalString(record, 'app', commandInput);
  copyOptionalString(record, 'rating', commandInput);
  copyOptionalString(record, 'lang', commandInput);

  return commandInput;
}

function decodeReplyInput(record: Record<string, unknown>): PlayReviewsReplyInput {
  const commandInput: PlayReviewsReplyInput = {
    operation: 'reply',
    reviewId: readRequiredString(record, 'reviewId'),
    yes: readRequiredBoolean(record, 'yes'),
  };

  copyOptionalString(record, 'app', commandInput);
  copyOptionalString(record, 'message', commandInput);
  copyOptionalString(record, 'file', commandInput);

  return commandInput;
}

function decodePlayReviewsCommandInput(rawCommandInput: unknown): PlayReviewsCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Play reviews command input must be an object.');
  }

  const operation = rawCommandInputObject['operation'];

  if (operation == 'list') {
    return decodeListInput(rawCommandInputObject);
  }

  if (operation == 'reply') {
    return decodeReplyInput(rawCommandInputObject);
  }

  throw new Error('Play reviews operation must be list or reply.');
}

export const PlayReviewsCommandInputSchema = decodePlayReviewsCommandInput;

function rejectRating(ratingText: string): never {
  throw new Error(`--rating must be a whole number 1-5 (got "${ratingText}").`, {
    cause: ratingText,
  });
}

/** Parse and validate an optional one-to-five-star Play review filter. */
export function parsePlayReviewRating(ratingText: string | undefined): number | undefined {
  if (ratingText == null) {
    return undefined;
  }

  const trimmedRating = ratingText.trim();
  const isWholeNumber = /^\d+$/.test(trimmedRating);

  if (isWholeNumber == false) {
    return rejectRating(ratingText);
  }

  const parsedRating = Number(trimmedRating);

  const isTooSmall = parsedRating < 1;

  if (isTooSmall) {
    return rejectRating(ratingText);
  }

  const isTooLarge = parsedRating > 5;

  if (isTooLarge) {
    return rejectRating(ratingText);
  }

  return parsedRating;
}

function pushReviewDetail(reviewDetails: string[], detail: string | undefined): void {
  if (detail == null) {
    return;
  }

  reviewDetails.push(detail);
}

/** Render one Play customer review as a copy-pasteable text block. */
export function renderPlayReview(playReview: PlayReview): string {
  const reviewDetails: string[] = [];

  pushReviewDetail(reviewDetails, playReview.reviewerLanguage);

  if (playReview.lastModified != null) {
    reviewDetails.push(playReview.lastModified.slice(0, 10));
  }

  if (playReview.appVersionName != null) {
    reviewDetails.push(`v${playReview.appVersionName}`);
  }

  if (playReview.authorName != null) {
    reviewDetails.push(`by ${playReview.authorName}`);
  }

  if (playReview.answered) {
    reviewDetails.push('OK answered');
  }

  if (playReview.answered == false) {
    reviewDetails.push('- unanswered');
  }

  const reviewLines = [
    `${playReview.reviewId}  ${playReview.rating}/5`,
    `  ${reviewDetails.join('  ')}`,
  ];

  if (playReview.text != null) {
    reviewLines.push(`  ${playReview.text}`);
  }

  if (playReview.developerReply != null) {
    reviewLines.push(`  -> reply: ${playReview.developerReply}`);
  }

  return reviewLines.join('\n');
}

async function readPlayReplyText(commandInput: PlayReviewsReplyInput): Promise<string> {
  if (commandInput.file != null) {
    const fileText = await readFile(commandInput.file, 'utf8');

    return fileText.trim();
  }

  if (commandInput.message != null) {
    return commandInput.message;
  }

  throw new Error('A reply body is required. Pass -m/--message <text> or --file <path>.', {
    cause: 'missing-reply',
  });
}

async function listRecentPlayReviews(commandInput: PlayReviewsListInput): Promise<void> {
  const rating = parsePlayReviewRating(commandInput.rating);
  const selectedApp = await readGoogleStoreApp(commandInput.app);
  const googleStore = await loadActiveGoogleStore(selectedApp.packageName, selectedApp.appName);
  let reviewFilters: PlayReviewFilters = { unansweredOnly: commandInput.unanswered };

  if (rating != null) {
    reviewFilters = { ...reviewFilters, rating };
  }

  if (commandInput.lang != null) {
    reviewFilters = { ...reviewFilters, translationLanguage: commandInput.lang };
  }

  const matchingReviews = await listPlayReviews(
    googleStore,
    selectedApp.packageName,
    reviewFilters,
  );
  const logger = createLogger(false);

  if (commandInput.json) {
    const serialized = JSON.stringify(matchingReviews, null, 2);
    logger.line(serialized);
    return;
  }

  if (matchingReviews.length == 0) {
    logger.line(
      'No reviews match. Try removing a filter, or check back later (Play shows only recent reviews).',
    );
    return;
  }

  function renderOneReview(playReview: PlayReview): string {
    return renderPlayReview(playReview);
  }

  logger.line(matchingReviews.map(renderOneReview).join('\n\n'));

  let reviewSuffix = 's';

  if (matchingReviews.length == 1) {
    reviewSuffix = '';
  }

  logger.line(`\n${matchingReviews.length} review${reviewSuffix}.`);
}

function hasExistingReply(existingReview: PlayReview | null): boolean {
  if (existingReview == null) {
    return false;
  }

  return existingReview.answered;
}

async function replyToRecentPlayReview(commandInput: PlayReviewsReplyInput): Promise<void> {
  const replyText = await readPlayReplyText(commandInput);
  const selectedApp = await readGoogleStoreApp(commandInput.app);
  const googleStore = await loadActiveGoogleStore(selectedApp.packageName, selectedApp.appName);
  const existingReview = await googleStore.getReview(
    selectedApp.packageName,
    commandInput.reviewId,
  );
  let confirmationVerb = 'Post a public reply to';

  if (hasExistingReply(existingReview)) {
    confirmationVerb = 'Replace the existing reply to';
  }

  const confirmed = await confirmGoogleStoreWrite(
    `${confirmationVerb} review ${commandInput.reviewId}?`,
    commandInput.yes,
    'Refusing to post without confirmation. Re-run with --yes (non-interactive).',
    'Aborted - nothing posted.',
  );

  if (confirmed == false) {
    return;
  }

  const replyOutcome = await replyToPlayReview(
    googleStore,
    selectedApp.packageName,
    commandInput.reviewId,
    replyText,
    existingReview,
  );
  let operationLabel = 'reply posted';

  if (replyOutcome.replaced) {
    operationLabel = 'reply replaced';
  }

  const logger = createLogger(false);
  let editedDetail: string | undefined;

  if (replyOutcome.reply.lastEdited != null) {
    editedDetail = `edited: ${replyOutcome.reply.lastEdited}`;
  }

  logger.step(operationLabel, editedDetail);
}

async function runPlayReviewsOperation(commandInput: PlayReviewsCommandInput): Promise<void> {
  if (commandInput.operation == 'list') {
    await listRecentPlayReviews(commandInput);
    return;
  }

  await replyToRecentPlayReview(commandInput);
}

/** Run one schema-decoded Play reviews operation. */
export async function playReviewsCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    var commandInput = decodePlayReviewsCommandInput(rawCommandInput);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  try {
    await runPlayReviewsOperation(commandInput);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

type PlayReviewsListOptions = Readonly<{
  readonly app?: string;
  readonly rating?: string;
  readonly unanswered: boolean;
  readonly lang?: string;
  readonly json: boolean;
}>;

type ReplyOptions = Readonly<{
  readonly app?: string;
  readonly message?: string;
  readonly file?: string;
  readonly yes: boolean;
}>;

/** Map the list flags without explicit undefined optionals. */
function readPlayReviewsList(commandOptions: PlayReviewsListOptions): PlayReviewsListInput {
  let commandInput: PlayReviewsListInput = {
    operation: 'list',
    unanswered: commandOptions.unanswered,
    json: commandOptions.json,
  };

  if (commandOptions.app != null) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }

  if (commandOptions.rating != null) {
    commandInput = { ...commandInput, rating: commandOptions.rating };
  }

  if (commandOptions.lang != null) {
    commandInput = { ...commandInput, lang: commandOptions.lang };
  }

  return commandInput;
}

/** Map the reply flags without explicit undefined optionals. */
function readPlayReviewsReply(
  reviewId: string,
  commandOptions: ReplyOptions,
): PlayReviewsReplyInput {
  let commandInput: PlayReviewsReplyInput = {
    operation: 'reply',
    reviewId,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }

  if (commandOptions.message != null) {
    commandInput = { ...commandInput, message: commandOptions.message };
  }

  if (commandOptions.file != null) {
    commandInput = { ...commandInput, file: commandOptions.file };
  }

  return commandInput;
}

/** Attach the play-reviews command group. */
export function registerPlayReviewsCommand(program: Command): void {
  const reviewsCommand = program
    .command('play-reviews')
    .description('read Google Play customer reviews and reply from the CLI');

  function runList(commandOptions: PlayReviewsListOptions) {
    const playReviewsList = readPlayReviewsList(commandOptions);
    const playReviewsProgram = playReviewsCommandProgram(playReviewsList);
    return runCliProgram(playReviewsProgram);
  }

  reviewsCommand
    .command('list')
    .description("list an app's Play reviews (only reviews with text from the last ~week)")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--rating <1-5>', 'only show reviews with this star rating')
    .option('--unanswered', 'only show reviews without a developer reply', false)
    .option('--lang <bcp47>', 'machine-translate review text into this language (e.g. en-US)')
    .option('--json', 'output machine-readable JSON', false)
    .action(runList);

  function runReply(reviewId: string, commandOptions: ReplyOptions) {
    const playReviewsReply = readPlayReviewsReply(reviewId, commandOptions);
    const playReviewsProgram = playReviewsCommandProgram(playReviewsReply);
    return runCliProgram(playReviewsProgram);
  }

  reviewsCommand
    .command('reply')
    .description('post (or replace) the developer reply to a review')
    .argument('<reviewId>', 'the review id from `play-reviews list`')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('-m, --message <text>', 'the reply text')
    .option('--file <path>', 'read the reply text from a file')
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runReply);
}
