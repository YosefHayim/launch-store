import type { Command } from 'commander';
import { readinessCommandProgram } from '@core/readiness/command.js';
import { runCliProgram } from '../runCliProgram.js';

/** CLI options for `launch store doctor`. */
type StoreDoctorOptions = {
  app?: string;
  json?: boolean;
};

/** Attach the store-account readiness command group. */
export const registerStoreCommand = (program: Command): void => {
  const storeCommand = program
    .command('store')
    .description('store-account readiness and operations');
  storeCommand
    .command('doctor')
    .description(
      'check store-account readiness: Apple app record, Play onboarding & access (read-only)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action((commandOptions: StoreDoctorOptions) =>
      runCliProgram(
        readinessCommandProgram({
          category: 'account',
          labels: {
            summary: 'Store readiness',
            empty:
              'No store-readiness checks ran - no apps with a bundle id or package name were found.',
          },
          ...commandOptions,
        }),
      ),
    );
};
