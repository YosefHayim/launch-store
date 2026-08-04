import type { Command } from 'commander';
import {
  type AvailabilityCommandInput,
  availabilityCommandProgram,
} from '@core/store/availabilityCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type AvailabilityOptions = Readonly<{
  readonly app?: string;
  readonly config: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

const toAvailabilityInput = (commandOptions: AvailabilityOptions): AvailabilityCommandInput => {
  let availabilityInput: AvailabilityCommandInput = {
    config: commandOptions.config,
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };
  if (commandOptions.app !== undefined) {
    availabilityInput = { ...availabilityInput, app: commandOptions.app };
  }
  return availabilityInput;
};

export const registerAvailabilityCommand = (program: Command): void => {
  program
    .command('availability')
    .description('set the App Store territories the app sells in, from availability.config.json')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to the availability config file', 'availability.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: AvailabilityOptions) =>
      runCliProgram(availabilityCommandProgram(toAvailabilityInput(commandOptions))),
    );
};
