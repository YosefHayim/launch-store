import type { Command } from 'commander';
import {
  reviewsCommandProgram,
  type ReviewReplyCommandInput,
  type ReviewsListCommandInput,
} from '@core/store/reviewsCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the `reviews` command group to the program. */
export const registerReviewsCommand = (program: Command): void => {
  const reviews = program
    .command('reviews')
    .description('read App Store customer reviews and reply from the CLI');
  reviews
    .command('list')
    .description("list an app's customer reviews, newest first")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--rating <1-5>', 'only show reviews with this star rating')
    .option('--territory <code>', 'only show reviews from this territory (e.g. USA)')
    .option('--unanswered', 'only show reviews without a developer response', false)
    .option('--json', 'output machine-readable JSON', false)
    .action(
      (
        options: Omit<ReviewsListCommandInput, 'operation' | 'unanswered' | 'json'> & {
          unanswered?: boolean;
          json?: boolean;
        },
      ) => {
        return runCliProgram(
          reviewsCommandProgram({
            operation: 'list',
            ...options,
            unanswered: options.unanswered === true,
            json: options.json === true,
          }),
        );
      },
    );
  reviews
    .command('reply')
    .description('post (or replace) the developer response to a review')
    .argument('<reviewId>', 'the review id from `reviews list`')
    .option('-m, --message <text>', 'the reply text')
    .option('--file <path>', 'read the reply text from a file')
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(
      (
        reviewId: string,
        options: Omit<ReviewReplyCommandInput, 'operation' | 'reviewId' | 'yes'> & {
          yes?: boolean;
        },
      ) => {
        return runCliProgram(
          reviewsCommandProgram({
            operation: 'reply',
            reviewId,
            ...options,
            yes: options.yes === true,
          }),
        );
      },
    );
  reviews
    .command('delete')
    .description('delete the developer response to a review')
    .argument('<reviewId>', 'the review id from `reviews list`')
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((reviewId: string, options: { yes?: boolean }) => {
      return runCliProgram(
        reviewsCommandProgram({ operation: 'delete', reviewId, yes: options.yes === true }),
      );
    });
};
