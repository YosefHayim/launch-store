import type { Command } from 'commander';
import {
  type VersionExperimentsCommandInput,
  versionExperimentsCommandProgram,
} from '@core/release/versionExperimentsCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type ExperimentsOptions = Readonly<{
  readonly app?: string;
  readonly config: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

/** Map Commander values without explicit undefined optionals. */
const toVersionExperimentsInput = (
  commandOptions: ExperimentsOptions,
): VersionExperimentsCommandInput => {
  let experimentsInput: VersionExperimentsCommandInput = {
    config: commandOptions.config,
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };
  if (commandOptions.app !== undefined) {
    experimentsInput = { ...experimentsInput, app: commandOptions.app };
  }
  return experimentsInput;
};

/** Attach the experiments command. */
export const registerExperimentsCommand = (program: Command): void => {
  program
    .command('experiments')
    .description('reconcile product-page A/B experiments from experiments.config.json')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to the experiments config file', 'experiments.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: ExperimentsOptions) =>
      runCliProgram(versionExperimentsCommandProgram(toVersionExperimentsInput(commandOptions))),
    );
};
