import type { Command } from '../../../command.ts';
import {
  type PlayReviewsListInput,
  playReviewsCommandProgram,
  type PlayReviewsReplyInput,
} from './play-reviews-command.ts';
import { runCliProgram } from '../../../run-cli-program.ts';

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
