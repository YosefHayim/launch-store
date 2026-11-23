import type { Command } from '@/cli/command.js';
import { adoptCommandProgram, type AdoptCommandInput } from '@/adopt/command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

/** Attach the `adopt` command to Commander. */
export function registerAdoptCommand(program: Command): void {
  function runAdopt(commandOptions: AdoptCommandInput) {
    const adoptProgram = adoptCommandProgram(commandOptions);
    return runCliProgram(adoptProgram);
  }

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
    .action(runAdopt);
}
