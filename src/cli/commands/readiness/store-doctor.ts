import type { Command } from '@/cli/command.js';
import { readinessCommandProgram } from '@/readiness/command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

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
