import type { Command } from 'commander';
import { statsReportProgram } from '@core/stats/statsCommand.js';
import { statsSyncProgram } from '@core/stats/statsSyncCommand.js';
import { runCliProgram } from '../runCliProgram.js';

export const registerStatsCommand = (program: Command): void => {
  const stats = program
    .command('stats')
    .description('keep daily download, rating and usage numbers of your apps on this machine')
    .option('--platform <platform>', 'only ios or android apps')
    .option('--owner <owner>', 'only apps tagged mine or client')
    .option('--app <name>', 'only this app (part of its name, bundle id or package name)')
    .option('--days <n>', 'how many days to show (1 to 365, default 30)')
    .option('--json', 'output machine-readable JSON', false)
    .action(
      (options: {
        platform?: string;
        owner?: string;
        app?: string;
        days?: string;
        json?: boolean;
      }) => {
        return runCliProgram(
          statsReportProgram({
            platform: options.platform,
            owner: options.owner,
            app: options.app,
            days: options.days,
            json: options.json === true,
          }),
        );
      },
    );
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
