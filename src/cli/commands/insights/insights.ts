import type { Command } from '../../command.ts';
import { insightsCommandProgram } from '../../../insights/command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

/** CLI options for `launch insights`. */
type InsightsOptions = {
  app?: string;
  json?: boolean;
};

/** Attach the read-only cross-store insights command. */
export const registerInsightsCommand = (program: Command): void => {
  program
    .command('insights')
    .description('aggregate rating & review trends across the App Store and Play (read-only)')
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action((commandOptions: InsightsOptions) => {
      return runCliProgram(
        insightsCommandProgram({
          app: commandOptions.app,
          json: commandOptions.json == true,
        }),
      );
    });
};
