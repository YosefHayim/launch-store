import type { Command } from 'commander';
import { statsSyncProgram } from '@core/stats/statsSyncCommand.js';
import { runCliProgram } from '../runCliProgram.js';

export const registerStatsCommand = (program: Command): void => {
  const stats = program
    .command('stats')
    .description('keep daily download, rating and usage numbers of your apps on this machine');
  stats
    .command('sync')
    .description('pull the missing days of every stats feed into ~/.launch/stats')
    .option('--app <name>', 'only this app (part of its name, bundle id or package name)')
    .option('--days <days>', 'how many days back to cover (1 to 365, default 30)')
    .option('--json', 'output machine-readable JSON', false)
    .action((flags: { app?: string; days?: string; json?: boolean }) => {
      return runCliProgram(
        statsSyncProgram({
          app: flags.app,
          days: flags.days,
          isJson: flags.json === true,
        }),
      );
    });
};
