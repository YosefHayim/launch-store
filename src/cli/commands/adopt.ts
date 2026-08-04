import type { Command } from 'commander';
import { adoptCommandProgram, type AdoptCommandInput } from '@core/adopt/command.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the `adopt` command to Commander. */
export const registerAdoptCommand = (program: Command): void => {
  program
    .command('adopt')
    .description(
      'onboard an app that already ships: import its App Store Connect setup into config',
    )
    .option('--all', 'adopt every discovered app (the default when --app is omitted)', false)
    .option(
      '-a, --app <names>',
      'comma-separated app handles to adopt (default: all discovered apps)',
    )
    .option('--dry-run', 'print the plan and exit, importing nothing', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: AdoptCommandInput) =>
      runCliProgram(adoptCommandProgram(commandOptions)),
    );
};
