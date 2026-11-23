// Registers the command that syncs App Store product-page experiments from launch.config.ts.

import type { Command } from '../../command.ts';
import {
  type VersionExperimentsCommandInput,
  versionExperimentsCommandProgram,
} from '../../../release/version-experiments-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type ExperimentsOptions = Readonly<{
  readonly app?: string;
  readonly submit: boolean;
  readonly start: boolean;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

/** Map Commander values without explicit undefined optionals. */
function readVersionExperiments(
  commandOptions: ExperimentsOptions,
): VersionExperimentsCommandInput {
  let experimentsInput: VersionExperimentsCommandInput = {
    submit: commandOptions.submit,
    start: commandOptions.start,
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) {
    experimentsInput = { ...experimentsInput, app: commandOptions.app };
  }

  return experimentsInput;
}

/** Attach the experiments command. */
export function registerExperimentsCommand(program: Command): void {
  function runExperiments(commandOptions: ExperimentsOptions) {
    const versionExperiments = readVersionExperiments(commandOptions);
    const versionExperimentsProgram = versionExperimentsCommandProgram(versionExperiments);
    return runCliProgram(versionExperimentsProgram);
  }

  program
    .command('experiments')
    .description('reconcile product-page A/B experiments from launch.config.ts')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option(
      '--submit',
      'submit each experiment for App Review once its treatments are synced',
      false,
    )
    .option('--start', 'start each experiment Apple has approved', false)
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runExperiments);
}
