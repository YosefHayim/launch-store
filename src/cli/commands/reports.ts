import type { Command } from 'commander';
import { reportsCommandProgram } from '@core/store/reportsCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type SalesCommandOptions = Readonly<{
  vendorNumber?: string;
  date?: string;
  from?: string;
  to?: string;
  frequency: string;
  reportType: string;
  subType: string;
  version?: string;
  out: string;
  json: boolean;
}>;

type FinanceCommandOptions = Readonly<{
  vendorNumber?: string;
  date?: string;
  region: string;
  reportType: string;
  out: string;
  json: boolean;
}>;

type AnalyticsCommandOptions = Readonly<{
  app?: string;
  accessType: string;
  category?: string;
  name?: string;
  granularity: string;
  date?: string;
  out: string;
}>;

/** Attach App Store Connect reporting commands to Commander. */
export const registerReportsCommand = (program: Command): void => {
  const reportsCommand = program
    .command('reports')
    .description('download App Store Connect sales, finance, and analytics reports');

  reportsCommand
    .command('sales')
    .description('download a Sales and Trends report (gzipped TSV)')
    .option('--vendor-number <n>', 'vendor number (or set ASC_VENDOR_NUMBER)')
    .option('--date <date>', 'report date; format follows --frequency')
    .option('--from <date>', 'start of a DAILY date range (with --to)')
    .option('--to <date>', 'end of a DAILY date range (with --from)')
    .option('--frequency <frequency>', 'DAILY | WEEKLY | MONTHLY | YEARLY', 'DAILY')
    .option('--report-type <type>', 'SALES | SUBSCRIPTION | SUBSCRIBER | ...', 'SALES')
    .option('--sub-type <type>', 'SUMMARY | DETAILED', 'SUMMARY')
    .option('--version <version>', 'report schema version, e.g. 1_0')
    .option('--out <directory>', 'directory to write the reports into', '.')
    .option('--json', 'write parsed JSON instead of raw TSV', false)
    .action((commandOptions: SalesCommandOptions) =>
      runCliProgram(reportsCommandProgram({ operation: 'sales', ...commandOptions })),
    );

  reportsCommand
    .command('finance')
    .description('download a finance report for a fiscal period (gzipped TSV)')
    .option('--vendor-number <n>', 'vendor number (or set ASC_VENDOR_NUMBER)')
    .option('--date <YYYY-MM>', 'fiscal period, e.g. 2026-05')
    .option('--region <code>', 'region code: ZZ (all) or a specific region', 'ZZ')
    .option('--report-type <type>', 'FINANCE_DETAIL | FINANCIAL', 'FINANCE_DETAIL')
    .option('--out <directory>', 'directory to write the report into', '.')
    .option('--json', 'write parsed JSON instead of raw TSV', false)
    .action((commandOptions: FinanceCommandOptions) =>
      runCliProgram(reportsCommandProgram({ operation: 'finance', ...commandOptions })),
    );

  reportsCommand
    .command('analytics')
    .description('request and download App Store Connect Analytics reports')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--access-type <type>', 'ONGOING | ONE_TIME_SNAPSHOT', 'ONGOING')
    .option(
      '--category <category>',
      'APP_USAGE | APP_STORE_ENGAGEMENT | COMMERCE | FRAMEWORK_USAGE | PERFORMANCE',
    )
    .option('--name <name>', 'filter to one report by exact name')
    .option('--granularity <granularity>', 'DAILY | WEEKLY | MONTHLY', 'DAILY')
    .option('--date <YYYY-MM-DD>', 'limit to instances covering this processing date')
    .option('--out <directory>', 'directory to write the reports into', '.')
    .action((commandOptions: AnalyticsCommandOptions) =>
      runCliProgram(reportsCommandProgram({ operation: 'analytics', ...commandOptions })),
    );
};
