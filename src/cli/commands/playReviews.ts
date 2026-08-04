import type { Command } from 'commander';
import {
  type PlayReviewsListInput,
  playReviewsCommandProgram,
  type PlayReviewsReplyInput,
} from '@core/store/playReviewsCommand.js';
import { runCliProgram } from '../runCliProgram.js';

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
const toPlayReviewsListInput = (commandOptions: PlayReviewsListOptions): PlayReviewsListInput => {
  let commandInput: PlayReviewsListInput = {
    operation: 'list',
    unanswered: commandOptions.unanswered,
    json: commandOptions.json,
  };
  if (commandOptions.app !== undefined) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }
  if (commandOptions.rating !== undefined) {
    commandInput = { ...commandInput, rating: commandOptions.rating };
  }
  if (commandOptions.lang !== undefined) {
    commandInput = { ...commandInput, lang: commandOptions.lang };
  }
  return commandInput;
};

/** Map the reply flags without explicit undefined optionals. */
const toPlayReviewsReplyInput = (
  reviewId: string,
  commandOptions: ReplyOptions,
): PlayReviewsReplyInput => {
  let commandInput: PlayReviewsReplyInput = {
    operation: 'reply',
    reviewId,
    yes: commandOptions.yes,
  };
  if (commandOptions.app !== undefined) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }
  if (commandOptions.message !== undefined) {
    commandInput = { ...commandInput, message: commandOptions.message };
  }
  if (commandOptions.file !== undefined) {
    commandInput = { ...commandInput, file: commandOptions.file };
  }
  return commandInput;
};

/** Attach the play-reviews command group. */
export const registerPlayReviewsCommand = (program: Command): void => {
  const reviewsCommand = program
    .command('play-reviews')
    .description('read Google Play customer reviews and reply from the CLI');
  reviewsCommand
    .command('list')
    .description("list an app's Play reviews (only reviews with text from the last ~week)")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--rating <1-5>', 'only show reviews with this star rating')
    .option('--unanswered', 'only show reviews without a developer reply', false)
    .option('--lang <bcp47>', 'machine-translate review text into this language (e.g. en-US)')
    .option('--json', 'output machine-readable JSON', false)
    .action((commandOptions: PlayReviewsListOptions) =>
      runCliProgram(playReviewsCommandProgram(toPlayReviewsListInput(commandOptions))),
    );
  reviewsCommand
    .command('reply')
    .description('post (or replace) the developer reply to a review')
    .argument('<reviewId>', 'the review id from `play-reviews list`')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('-m, --message <text>', 'the reply text')
    .option('--file <path>', 'read the reply text from a file')
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((reviewId: string, commandOptions: ReplyOptions) =>
      runCliProgram(playReviewsCommandProgram(toPlayReviewsReplyInput(reviewId, commandOptions))),
    );
};
