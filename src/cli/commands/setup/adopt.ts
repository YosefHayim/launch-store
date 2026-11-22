import type { Command } from '../../command.ts';
import { adoptCommandProgram, type AdoptCommandInput } from '../../../adopt/command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

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
    .action((commandOptions: AdoptCommandInput) => {
      const adoptProgram = adoptCommandProgram(commandOptions);
      return runCliProgram(adoptProgram);
    });
};
