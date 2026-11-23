import type { Command } from '../../../command.ts';
import { DEFAULT_VITALS_DAYS, playReportsCommandProgram } from './play-reports-command.ts';
import { runCliProgram } from '../../../run-cli-program.ts';

type VitalsOptions = Readonly<{
  app?: string;
  metric?: string;
  days?: string;
  json: boolean;
}>;

export function registerPlayReportsCommand(program: Command): void {
  function runPlayReports(commandOptions: VitalsOptions) {
    const playReportsProgram = playReportsCommandProgram(commandOptions);
    return runCliProgram(playReportsProgram);
  }

  program
    .command('play-reports')
    .description(
      'read Android quality vitals (crash/ANR rate) from the Play Developer Reporting API',
    )
    .command('vitals')
    .description('show crash-rate and ANR-rate trends for an Android app (DAILY)')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--metric <crash|anr>', 'show only one vital (default: both)')
    .option('--days <n>', `how many days of history to show (default: ${DEFAULT_VITALS_DAYS})`)
    .option('--json', 'output machine-readable JSON', false)
    .action(runPlayReports);
}
