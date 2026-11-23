import type { Command } from '../../command.ts';
import { readinessCommandProgram } from '../../../readiness/command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

/** CLI options for `launch-store store doctor`. */
type StoreDoctorOptions = {
  app?: string;
  json?: boolean;
};

/** Attach the store-account readiness command group. */
export function registerStoreCommand(program: Command): void {
  const storeCommand = program
    .command('store')
    .description('store-account readiness and operations');

  function runDoctor(commandOptions: StoreDoctorOptions) {
    const readinessProgram = readinessCommandProgram({
      category: 'account',
      labels: {
        summary: 'Store readiness',
        empty:
          'No store-readiness checks ran - no apps with a bundle id or package name were found.',
      },
      ...commandOptions,
    });

    return runCliProgram(readinessProgram);
  }

  storeCommand
    .command('doctor')
    .description(
      'check store-account readiness: Apple app record, Play onboarding & access (read-only)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(runDoctor);
}
