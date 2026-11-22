import type { Command } from '../../command.ts';
import { readinessCommandProgram } from '../../../readiness/command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

/** CLI options for `launch iap doctor`. */
type IapDoctorOptions = {
  app?: string;
  json?: boolean;
};

/** Attach the in-app-purchase readiness command group. */
export const registerIapCommand = (program: Command): void => {
  const iapCommand = program.command('iap').description('in-app-purchase readiness and operations');
  iapCommand
    .command('doctor')
    .description(
      'check in-app-purchase readiness: products & subscriptions exist and are submittable (read-only)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action((commandOptions: IapDoctorOptions) =>
      runCliProgram(
        readinessCommandProgram({
          category: 'iap',
          labels: {
            summary: 'IAP readiness',
            empty: 'No IAP checks ran - no apps declare in-app purchases or subscriptions.',
          },
          ...commandOptions,
        }),
      ),
    );
};
