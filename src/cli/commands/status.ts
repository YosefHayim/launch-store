import type { Command } from 'commander';
import { statusCommandProgram, type StatusCommandInput } from '@core/release/statusCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the App Store status command. */
export const registerStatusCommand = (program: Command): void => {
  program
    .command('status')
    .description("show each app's App Store version, review, and phased-rollout state")
    .option('-a, --app <names>', 'comma-separated app handles (default: all iOS apps)')
    .option('--watch', 'poll until the review reaches a terminal verdict', false)
    .option('--json', 'machine-readable output for CI', false)
    .action((commandOptions: StatusCommandInput) =>
      runCliProgram(statusCommandProgram(commandOptions)),
    );
};
