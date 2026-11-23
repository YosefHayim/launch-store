// Registers the command that sets the App Store countries an app is sold in.

import type { Command } from '@/cli/command.js';
import {
  type AvailabilityCommandInput,
  availabilityCommandProgram,
} from './availability-command.ts';
import { runCliProgram } from '@/cli/run-cli-program.js';

type AvailabilityOptions = Readonly<{
  readonly app?: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

function readAvailabilityCommand(commandOptions: AvailabilityOptions): AvailabilityCommandInput {
  let availabilityInput: AvailabilityCommandInput = {
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) {
    availabilityInput = { ...availabilityInput, app: commandOptions.app };
  }

  return availabilityInput;
}

export function registerAvailabilityCommand(program: Command): void {
  function runAvailability(commandOptions: AvailabilityOptions) {
    const availability = readAvailabilityCommand(commandOptions);
    const availabilityProgram = availabilityCommandProgram(availability);
    return runCliProgram(availabilityProgram);
  }

  program
    .command('availability')
    .description('set the App Store territories the app sells in, from launch.config.ts')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runAvailability);
}
