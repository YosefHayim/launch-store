import type { Command } from 'commander';
import { statsSyncProgram } from '@core/stats/statsSyncCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the `stats` command (with the `sync` subcommand) to the program. */
export const registerStatsCommand = (program: Command): void => {
  const stats = program
    .command('stats')
    .description('keep daily download, rating and usage numbers of your apps on this machine');
  stats
    .command('sync')
    .description('pull the missing days of every stats feed into ~/.launch/stats')
    .option('--app <name>', 'only this app (part of its name, bundle id or package name)')
    .option('--days <n>', 'how many days back to cover (1 to 365, default 30)')
    .option('--json', 'output machine-readable JSON', false)
    .action((options: { app?: string; days?: string; json?: boolean }) => {
      return runCliProgram(
        statsSyncProgram({
          app: options.app,
          days: options.days,
          json: options.json === true,
        }),
      );
    });
};
