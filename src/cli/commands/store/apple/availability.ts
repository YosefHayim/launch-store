import type { Command } from '../../../command.ts';
import {
  type AvailabilityCommandInput,
  availabilityCommandProgram,
} from './availability-command.ts';
import { runCliProgram } from '../../../run-cli-program.ts';

type AvailabilityOptions = Readonly<{
  readonly app?: string;
  readonly config: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

function readAvailabilityCommand(commandOptions: AvailabilityOptions): AvailabilityCommandInput {
  let availabilityInput: AvailabilityCommandInput = {
    config: commandOptions.config,
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
    .description('set the App Store territories the app sells in, from availability.config.json')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to the availability config file', 'availability.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runAvailability);
}
