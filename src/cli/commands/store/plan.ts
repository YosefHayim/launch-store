// Registers the read-only comparison of Launch config with live App Store and Google Play state.

import type { Command } from '../../command.ts';
import { type PlanCommandInput, planCommandProgram } from '../../../plan/command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type PlanOptions = Readonly<{
  readonly app?: string;
  readonly check?: boolean;
  readonly json: boolean;
}>;

function planCommandInput(
  operation: 'plan' | 'drift',
  surfaceName: string | undefined,
  commandOptions: PlanOptions,
): PlanCommandInput {
  let check = commandOptions.check == true;

  if (operation == 'drift') check = true;

  let commandInput: PlanCommandInput = { operation, check, json: commandOptions.json };

  if (surfaceName != null) commandInput = { ...commandInput, surface: surfaceName };

  if (commandOptions.app != null) commandInput = { ...commandInput, app: commandOptions.app };

  return commandInput;
}

export function registerPlanCommand(program: Command): void {
  function runPlanSurface(surfaceName: string | undefined, commandOptions: PlanOptions) {
    const planCommand = planCommandInput('plan', surfaceName, commandOptions);
    const planProgram = planCommandProgram(planCommand);
    return runCliProgram(planProgram);
  }

  program
    .command('plan [surface]')
    .description(
      'diff launch.config against live store state (read-only): capabilities, IAPs, subscriptions, pricing',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option(
      '--check',
      'exit 2 when drift is present (CI gate); same as `launch-store drift`',
      false,
    )
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(runPlanSurface);

  function runDriftSurface(surfaceName: string | undefined, commandOptions: PlanOptions) {
    const planCommand = planCommandInput('drift', surfaceName, commandOptions);
    const planProgram = planCommandProgram(planCommand);
    return runCliProgram(planProgram);
  }

  program
    .command('drift [surface]')
    .description(
      'fail when live store state has drifted from launch.config (alias for `launch-store plan --check`)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(runDriftSurface);
}
