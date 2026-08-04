import type { Command } from 'commander';
import { aiListingCommandProgram, type AiListingInput } from '@core/listing/aiListingCommand.js';
import { aiGroup } from './ai.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the `ai listing` subcommand. */
export const registerAiListingCommand = (program: Command): void => {
  const aiCommand = aiGroup(program);
  aiCommand
    .command('listing')
    .description(
      'draft App Store / Play listing copy with AI into store.config.json (review with `launch plan`)',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option(
      '--locale <list>',
      'comma-separated locales (default: existing App Store locales, else en-US)',
    )
    .option('--about <text>', 'a short description of the app to seed the copy')
    .option('--platform <p>', 'ios (default), android, or all', 'ios')
    .option('--model <id>', 'Anthropic model id (default: claude-sonnet-4-6 or $LAUNCH_AI_MODEL)')
    .option('--config <path>', 'path to store.config.json (default: <app>/store.config.json)')
    .option('--dry-run', 'generate and preview, but write nothing', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: AiListingInput) =>
      runCliProgram(aiListingCommandProgram(commandOptions)),
    );
};
