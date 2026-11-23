// Registers the command that drafts App Store and Google Play listing text with AI.

import type { Command } from '@/cli/command.js';
import { aiListingCommandProgram, type AiListingInput } from '@/listing/ai-listing-command.js';
import { aiGroup } from './ai.ts';
import { runCliProgram } from '@/cli/run-cli-program.js';

/** Attach the `ai listing` subcommand. */
export function registerAiListingCommand(program: Command): void {
  const aiCommand = aiGroup(program);

  function runListing(commandOptions: AiListingInput) {
    const aiListingProgram = aiListingCommandProgram(commandOptions);
    return runCliProgram(aiListingProgram);
  }

  aiCommand
    .command('listing')
    .description('draft App Store / Play listing copy to paste under listing in launch.config.ts')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option(
      '--locale <list>',
      'comma-separated locales (default: existing App Store locales, else en-US)',
    )
    .option('--about <text>', 'a short description of the app to seed the copy')
    .option('--platform <p>', 'ios (default), android, or all', 'ios')
    .option('--model <id>', 'Anthropic model id (default: claude-sonnet-4-6 or $LAUNCH_AI_MODEL)')
    .option('--dry-run', 'generate and preview, but print no listing to paste', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runListing);
}
