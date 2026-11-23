// Registers the read-only command that summarizes ratings and reviews on both stores.

import type { Command } from '@/cli/command.js';
import { insightsCommandProgram } from '@/insights/command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

/** CLI options for `launch-store insights`. */
type InsightsOptions = {
  app?: string;
  json?: boolean;
};

/** Attach the read-only cross-store insights command. */
export function registerInsightsCommand(program: Command): void {
  function runInsights(commandOptions: InsightsOptions) {
    const insightsProgram = insightsCommandProgram({
      app: commandOptions.app,
      json: commandOptions.json == true,
    });

    return runCliProgram(insightsProgram);
  }

  program
    .command('insights')
    .description('aggregate rating & review trends across the App Store and Play (read-only)')
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(runInsights);
}
