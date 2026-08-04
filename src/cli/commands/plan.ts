import type { Command } from 'commander';
import { type PlanCommandInput, planCommandProgram } from '@core/plan/command.js';
import { runCliProgram } from '../runCliProgram.js';

type PlanOptions = Readonly<{
  readonly app?: string;
  readonly check?: boolean;
  readonly json: boolean;
}>;

const toPlanInput = (
  operation: 'plan' | 'drift',
  surfaceName: string | undefined,
  commandOptions: PlanOptions,
): PlanCommandInput => {
  let check = commandOptions.check === true;
  if (operation === 'drift') check = true;
  let planInput: PlanCommandInput = { operation, check, json: commandOptions.json };
  if (surfaceName !== undefined) planInput = { ...planInput, surface: surfaceName };
  if (commandOptions.app !== undefined) planInput = { ...planInput, app: commandOptions.app };
  return planInput;
};

export const registerPlanCommand = (program: Command): void => {
  program
    .command('plan [surface]')
    .description(
      'diff launch.config against live store state (read-only): capabilities, IAPs, subscriptions, pricing',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--check', 'exit 2 when drift is present (CI gate); same as `launch drift`', false)
    .option('--json', 'machine-readable output for CI/agents', false)
    .action((surfaceName: string | undefined, commandOptions: PlanOptions) =>
      runCliProgram(planCommandProgram(toPlanInput('plan', surfaceName, commandOptions))),
    );
  program
    .command('drift [surface]')
    .description(
      'fail when live store state has drifted from launch.config (alias for `launch plan --check`)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action((surfaceName: string | undefined, commandOptions: PlanOptions) =>
      runCliProgram(planCommandProgram(toPlanInput('drift', surfaceName, commandOptions))),
    );
};
