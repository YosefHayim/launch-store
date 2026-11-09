import type { Command } from 'commander';
import { statusCommandProgram, type StatusCommandOptions } from '@core/release/statusCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the App Store status command. */
export const registerStatusCommand = (program: Command): void => {
  program
    .command('status')
    .description("show each app's App Store version, build, review, and phased-rollout state")
    .option('-a, --app <names>', 'comma-separated app handles (default: all iOS apps)')
    .option(
      '--account <id>',
      'iOS only - Apple account label or Key ID (default: ASC_ACCOUNT, then the active account)',
    )
    .option('--watch', 'poll until the review reaches a terminal verdict', false)
    .option('--build <number>', 'with --watch: wait until this build is VALID, then exit')
    .option('--builds', 'list each app recent builds: version, build, processing state, upload time')
    .option('--json', 'machine-readable output for CI', false)
    .action((commandOptions: StatusCommandOptions) =>
      runCliProgram(statusCommandProgram(commandOptions)),
    );
};
