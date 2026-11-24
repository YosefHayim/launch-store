// Downloads App Store Connect sales, finance, and analytics reports and saves them locally.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { errorMessage } from '../services/platform/error-message.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import type { FinanceReportQuery, SalesReportQuery } from '../types/apple/reporting.ts';
import { loadActiveAppleStore } from './apple-store-command.ts';
import { collectAnalyticsSegments, decompressReport, eachDate, parseTsv } from './reports.ts';
import { readStoreBundleId } from '../store/shared/select-store-app.ts';
import type { MutableDeep } from '../types/mutable.ts';
import type { Command } from '../cli/command.ts';
import { runCliProgram } from '../cli/run-cli-program.ts';
import { redactText } from '../services/platform/redact.ts';

type SalesReportsCommandInput = {
  operation: 'sales';
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
};

type FinanceReportsCommandInput = {
  operation: 'finance';
  vendorNumber?: string;
  date?: string;
  region: string;
  reportType: string;
  out: string;
  json: boolean;
};

type AnalyticsReportsCommandInput = {
  operation: 'analytics';
  app?: string;
  accessType: string;
  category?: string;
  name?: string;
  granularity: string;
  date?: string;
  out: string;
};

type ReportsCommandInput =
  | SalesReportsCommandInput
  | FinanceReportsCommandInput
  | AnalyticsReportsCommandInput;

type WrittenReport = Readonly<{
  reportPath: string;
  reportEntryCount: number;
}>;

const VENDOR_NUMBER_MESSAGE =
  'Vendor number required. Pass --vendor-number <N> or set ASC_VENDOR_NUMBER ' +
  '(find it in App Store Connect -> Payments and Financial Reports).';

function readCommandRecord(rawCommandInput: unknown): Record<string, unknown> {
  const commandRecord = readPlainObject(rawCommandInput);

  if (commandRecord == null) {
    throw new Error('Reports command input must be an object.');
  }

  return commandRecord;
}

function readRequiredString(record: Record<string, unknown>, field: string): string {
  const fieldText = record[field];
  const isString = typeof fieldText == 'string';

  if (isString == false) {
    throw new Error(`Expected ${field} to be a string.`);
  }

  return fieldText;
}

function readRequiredBoolean(record: Record<string, unknown>, field: string): boolean {
  const fieldFlag = record[field];
  const isBoolean = typeof fieldFlag == 'boolean';

  if (isBoolean == false) {
    throw new Error(`Expected ${field} to be a boolean.`);
  }

  return fieldFlag;
}

function readOptionalString(record: Record<string, unknown>, field: string): string | undefined {
  const hasField = Object.hasOwn(record, field);

  if (hasField == false) {
    return undefined;
  }

  const fieldText = record[field];

  const isOmitted = typeof fieldText == 'undefined';

  if (isOmitted) {
    return undefined;
  }

  const isString = typeof fieldText == 'string';

  if (isString == false) {
    throw new Error(`Expected ${field} to be a string.`);
  }

  return fieldText;
}

function assignOptionalString<Target extends object>(
  target: Target,
  field: keyof Target,
  fieldText: string | undefined,
): void {
  if (fieldText == null) {
    return;
  }

  target[field] = fieldText as Target[keyof Target];
}

function decodeSalesReportsCommand(record: Record<string, unknown>): SalesReportsCommandInput {
  const salesCommand: SalesReportsCommandInput = {
    operation: 'sales',
    frequency: readRequiredString(record, 'frequency'),
    reportType: readRequiredString(record, 'reportType'),
    subType: readRequiredString(record, 'subType'),
    out: readRequiredString(record, 'out'),
    json: readRequiredBoolean(record, 'json'),
  };
  const optionalSetting = readOptionalString(record, 'vendorNumber');

  assignOptionalString(salesCommand, 'vendorNumber', optionalSetting);

  const optionalString = readOptionalString(record, 'date');

  assignOptionalString(salesCommand, 'date', optionalString);
  assignOptionalString(salesCommand, 'from', readOptionalString(record, 'from'));
  assignOptionalString(salesCommand, 'to', readOptionalString(record, 'to'));
  assignOptionalString(salesCommand, 'version', readOptionalString(record, 'version'));

  return salesCommand;
}

function decodeFinanceReportsCommand(record: Record<string, unknown>): FinanceReportsCommandInput {
  const financeCommand: FinanceReportsCommandInput = {
    operation: 'finance',
    region: readRequiredString(record, 'region'),
    reportType: readRequiredString(record, 'reportType'),
    out: readRequiredString(record, 'out'),
    json: readRequiredBoolean(record, 'json'),
  };
  const optionalSetting = readOptionalString(record, 'vendorNumber');

  assignOptionalString(financeCommand, 'vendorNumber', optionalSetting);

  const optionalString = readOptionalString(record, 'date');

  assignOptionalString(financeCommand, 'date', optionalString);

  return financeCommand;
}

function decodeAnalyticsReportsCommand(
  record: Record<string, unknown>,
): AnalyticsReportsCommandInput {
  const analyticsCommand: AnalyticsReportsCommandInput = {
    operation: 'analytics',
    accessType: readRequiredString(record, 'accessType'),
    granularity: readRequiredString(record, 'granularity'),
    out: readRequiredString(record, 'out'),
  };
  const optionalSetting = readOptionalString(record, 'app');

  assignOptionalString(analyticsCommand, 'app', optionalSetting);

  const optionalString = readOptionalString(record, 'category');

  assignOptionalString(analyticsCommand, 'category', optionalString);
  assignOptionalString(analyticsCommand, 'name', readOptionalString(record, 'name'));
  assignOptionalString(analyticsCommand, 'date', readOptionalString(record, 'date'));

  return analyticsCommand;
}

function decodeReportsCommandInput(rawCommandInput: unknown): ReportsCommandInput {
  const record = readCommandRecord(rawCommandInput);
  const operation = readRequiredString(record, 'operation');

  if (operation == 'sales') {
    return decodeSalesReportsCommand(record);
  }

  if (operation == 'finance') {
    return decodeFinanceReportsCommand(record);
  }

  if (operation == 'analytics') {
    return decodeAnalyticsReportsCommand(record);
  }

  throw new Error('Unknown reports command.');
}

/** Select the explicit vendor number, falling back to the decoded environment setting. */
function selectVendorNumber(explicitVendorNumber: string | undefined): string {
  const environment = readLaunchEnvironment();
  let vendorNumber = environment.values.appleVendorNumber;

  const hasExplicitVendorNumber = explicitVendorNumber != null;

  if (hasExplicitVendorNumber) {
    vendorNumber = explicitVendorNumber;
  }

  if (vendorNumber == null) {
    throw new Error(VENDOR_NUMBER_MESSAGE);
  }

  const isVendorNumberBlank = vendorNumber.trim().length == 0;

  if (isVendorNumberBlank) {
    throw new Error(VENDOR_NUMBER_MESSAGE);
  }

  return vendorNumber;
}

/** Convert a relative output directory into a path rooted at the current project. */
function projectOutputDirectory(outputDirectory: string): string {
  const launchPaths = readLaunchDirectories();

  const isAbsolute = path.isAbsolute(outputDirectory);

  if (isAbsolute) {
    return outputDirectory;
  }

  return path.join(launchPaths.workingDirectory, outputDirectory);
}

/** Convert an Apple report name into a filesystem-safe stem. */
function reportNameSlug(reportName: string): string {
  // Turns every run of characters other than letters and digits into one dash.
  const dashedName = reportName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // Trims dashes from the start and end of the slug.
  const reportSlug = dashedName.replace(/^-+|-+$/g, '');

  const isSlugEmpty = reportSlug.length == 0;

  if (isSlugEmpty) {
    return 'report';
  }

  return reportSlug;
}

/** Write decompressed report text as raw TSV or parsed JSON. */
async function writeReport(
  outputDirectory: string,
  fileStem: string,
  reportText: string,
  writeJson: boolean,
): Promise<WrittenReport> {
  await mkdir(outputDirectory, { recursive: true });

  const parsedReport = parseTsv(reportText);

  const shouldWriteJson = writeJson == true;

  if (shouldWriteJson) {
    const reportPath = path.join(outputDirectory, `${fileStem}.json`);
    const serialized = JSON.stringify(parsedReport.rows, null, 2);
    await writeFile(reportPath, `${serialized}\n`);
    return { reportPath, reportEntryCount: parsedReport.rows.length };
  }

  const reportPath = path.join(outputDirectory, `${fileStem}.tsv`);
  let persistedText = reportText;

  const needsTrailingNewline = persistedText.endsWith('\n') == false;

  if (needsTrailingNewline) {
    persistedText = `${persistedText}\n`;
  }

  await writeFile(reportPath, persistedText);

  return { reportPath, reportEntryCount: parsedReport.rows.length };
}

function isMissingReportPeriod(emptyPeriodOnNotFound: boolean, message: string): boolean {
  if (emptyPeriodOnNotFound == false) {
    return false;
  }

  return message.includes('(404)');
}

/** Download, decompress, persist, and report one Apple report file. */
async function downloadReport(
  fileStem: string,
  writeJson: boolean,
  outputDirectory: string,
  downloadBytes: Promise<Buffer>,
  emptyPeriodOnNotFound: boolean,
): Promise<void> {
  try {
    const compressedBytes = await downloadBytes;
    const reportText = decompressReport(compressedBytes);
    const writtenReport = await writeReport(outputDirectory, fileStem, reportText, writeJson);
    let pluralSuffix = 's';

    const isSingleRow = writtenReport.reportEntryCount == 1;

    if (isSingleRow) {
      pluralSuffix = '';
    }

    console.log(
      redactText(
        `${fileStem} - ${writtenReport.reportEntryCount} row${pluralSuffix} -> ${writtenReport.reportPath}`,
      ),
    );
  } catch (cause) {
    const message = errorMessage(cause);

    const isEmptyPeriod = isMissingReportPeriod(emptyPeriodOnNotFound, message);

    if (isEmptyPeriod) {
      console.log(redactText(`${fileStem}: no data for this period.`));
      return;
    }

    throw cause;
  }
}

function hasSalesDateRange(commandInput: SalesReportsCommandInput): boolean {
  if (commandInput.from == null) {
    return false;
  }

  return commandInput.to != null;
}

function hasOnlySalesFrom(commandInput: SalesReportsCommandInput): boolean {
  if (commandInput.from == null) {
    return false;
  }

  return commandInput.to == null;
}

function hasOnlySalesTo(commandInput: SalesReportsCommandInput): boolean {
  if (commandInput.to == null) {
    return false;
  }

  return commandInput.from == null;
}

/** Validate the sales date selector and enumerate every requested daily report. */
function selectSalesDates(commandInput: SalesReportsCommandInput): string[] {
  const hasRange = hasSalesDateRange(commandInput);

  if (hasRange) {
    const firstReportDate = commandInput.from;
    const lastReportDate = commandInput.to;

    if (firstReportDate == null) {
      throw new Error('--from requires a matching --to date.');
    }

    if (lastReportDate == null) {
      throw new Error('--to requires a matching --from date.');
    }

    try {
      return eachDate(firstReportDate, lastReportDate);
    } catch (cause) {
      const failureMessage = errorMessage(cause);

      throw new Error(failureMessage, { cause });
    }
  }

  const hasFromOnly = hasOnlySalesFrom(commandInput);

  if (hasFromOnly) {
    throw new Error('--from requires a matching --to date.');
  }

  const hasToOnly = hasOnlySalesTo(commandInput);

  if (hasToOnly) {
    throw new Error('--to requires a matching --from date.');
  }

  const reportDate = commandInput.date;

  const hasReportDate = reportDate != null;

  if (hasReportDate) {
    return [reportDate];
  }

  throw new Error('A date is required. Pass --date <YYYY-MM-DD> or a --from/--to range.');
}

/** Download the requested Sales and Trends reports serially. */
async function downloadSalesReports(commandInput: SalesReportsCommandInput): Promise<void> {
  const vendorNumber = selectVendorNumber(commandInput.vendorNumber);
  const reportDates = selectSalesDates(commandInput);
  const outputDirectory = projectOutputDirectory(commandInput.out);
  const appleStore = await loadActiveAppleStore();

  for (const reportDate of reportDates) {
    const reportQuery: MutableDeep<SalesReportQuery> = {
      vendorNumber,
      frequency: commandInput.frequency,
      reportType: commandInput.reportType,
      reportSubType: commandInput.subType,
      reportDate,
    };
    const reportVersion = commandInput.version;

    const hasReportVersion = reportVersion != null;

    if (hasReportVersion) {
      reportQuery.version = reportVersion;
    }

    await downloadReport(
      `sales-${commandInput.frequency}-${reportDate}`,
      commandInput.json,
      outputDirectory,
      appleStore.getSalesReport(reportQuery),
      true,
    );
  }
}

/** Download one Apple finance report for its fiscal period. */
async function downloadFinanceReport(commandInput: FinanceReportsCommandInput): Promise<void> {
  const fiscalPeriod = commandInput.date;

  const isFiscalPeriodMissing = fiscalPeriod == null;

  if (isFiscalPeriodMissing) {
    throw new Error('A fiscal period is required. Pass --date <YYYY-MM>.');
  }
  const vendorNumber = selectVendorNumber(commandInput.vendorNumber);
  const outputDirectory = projectOutputDirectory(commandInput.out);
  const appleStore = await loadActiveAppleStore();
  const reportQuery: MutableDeep<FinanceReportQuery> = {
    vendorNumber,
    reportDate: fiscalPeriod,
    regionCode: commandInput.region,
    reportType: commandInput.reportType,
  };

  await downloadReport(
    `finance-${commandInput.region}-${fiscalPeriod}`,
    commandInput.json,
    outputDirectory,
    appleStore.getFinanceReport(reportQuery),
    true,
  );
}

function noteMissingAnalytics(requestCreated: boolean): void {
  if (requestCreated) {
    console.log(
      redactText(
        'Analytics report requested. Apple generally generates it within two days; rerun this command to download it.',
      ),
    );
    return;
  }

  console.log(redactText('No analytics segments matched the selected filters.'));
}

/** Request and download every matching App Store analytics segment. */
async function downloadAnalyticsReports(commandInput: AnalyticsReportsCommandInput): Promise<void> {
  const bundleId = await readStoreBundleId(commandInput.app);
  const outputDirectory = projectOutputDirectory(commandInput.out);
  const appleStore = await loadActiveAppleStore();
  const analyticsQuery: {
    bundleId: string;
    accessType: string;
    granularity: string;
    category?: string;
    name?: string;
    processingDate?: string;
  } = {
    bundleId,
    accessType: commandInput.accessType,
    granularity: commandInput.granularity,
  };
  const category = commandInput.category;

  const hasCategory = category != null;

  if (hasCategory) {
    analyticsQuery.category = category;
  }

  const reportName = commandInput.name;

  const hasReportName = reportName != null;

  if (hasReportName) {
    analyticsQuery.name = reportName;
  }

  const processingDate = commandInput.date;

  const hasProcessingDate = processingDate != null;

  if (hasProcessingDate) {
    analyticsQuery.processingDate = processingDate;
  }

  const analyticsCollection = await collectAnalyticsSegments(appleStore, analyticsQuery);

  const hasNoDownloads = analyticsCollection.downloads.length == 0;

  if (hasNoDownloads) {
    noteMissingAnalytics(analyticsCollection.requestCreated);
    return;
  }

  let segmentIndex = 0;

  for (const segmentDownload of analyticsCollection.downloads) {
    let processingDateLabel = 'all';

    const hasSegmentDate = segmentDownload.processingDate.length > 0;

    if (hasSegmentDate) {
      processingDateLabel = segmentDownload.processingDate;
    }

    const fileStem = `analytics-${reportNameSlug(segmentDownload.reportName)}-${processingDateLabel}-${segmentIndex}`;

    segmentIndex += 1;
    await downloadReport(
      fileStem,
      false,
      outputDirectory,
      appleStore.downloadAnalyticsSegment(segmentDownload.url),
      false,
    );
  }

  console.log(
    redactText(
      `analytics - downloaded ${analyticsCollection.downloads.length} segment(s) from ${analyticsCollection.reportCount} report(s)`,
    ),
  );
}

/** Run an Apple sales, finance, or analytics reporting operation. */
export async function reportsCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodeReportsCommandInput(rawCommandInput);

    if (commandInput.operation == 'sales') {
      await downloadSalesReports(commandInput);
      return;
    }

    if (commandInput.operation == 'finance') {
      await downloadFinanceReport(commandInput);
      return;
    }

    await downloadAnalyticsReports(commandInput);
  } catch (cause) {
    const isAlreadyError = cause instanceof Error;

    if (isAlreadyError) {
      throw cause;
    }

    const failureMessage = errorMessage(cause);

    throw new Error(failureMessage, { cause });
  }
}

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
export function registerReportsCommand(program: Command): void {
  const reportsCommand = program
    .command('reports')
    .description('download App Store Connect sales, finance, and analytics reports');

  function runSales(commandOptions: SalesCommandOptions) {
    const reportsProgram = reportsCommandProgram({ operation: 'sales', ...commandOptions });
    return runCliProgram(reportsProgram);
  }

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
    .action(runSales);

  function runFinance(commandOptions: FinanceCommandOptions) {
    const reportsProgram = reportsCommandProgram({ operation: 'finance', ...commandOptions });
    return runCliProgram(reportsProgram);
  }

  reportsCommand
    .command('finance')
    .description('download a finance report for a fiscal period (gzipped TSV)')
    .option('--vendor-number <n>', 'vendor number (or set ASC_VENDOR_NUMBER)')
    .option('--date <YYYY-MM>', 'fiscal period, e.g. 2026-05')
    .option('--region <code>', 'region code: ZZ (all) or a specific region', 'ZZ')
    .option('--report-type <type>', 'FINANCE_DETAIL | FINANCIAL', 'FINANCE_DETAIL')
    .option('--out <directory>', 'directory to write the report into', '.')
    .option('--json', 'write parsed JSON instead of raw TSV', false)
    .action(runFinance);

  function runAnalytics(commandOptions: AnalyticsCommandOptions) {
    const reportsProgram = reportsCommandProgram({ operation: 'analytics', ...commandOptions });
    return runCliProgram(reportsProgram);
  }

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
    .action(runAnalytics);
}
