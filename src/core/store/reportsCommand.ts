import { FileSystem, Path } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import { LaunchEnvironment, type LaunchEnvironmentService } from '../services/environment.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import type { FinanceReportQuery, SalesReportQuery } from '../types/appleCatalog.js';
import { loadActiveAppleStore, type ActiveAppleStoreRequirements } from './appleStoreCommand.js';
import {
  type AnalyticsQuery,
  collectAnalyticsSegments,
  decompressReport,
  eachDate,
  parseTsv,
} from './reports.js';
import { resolveStoreBundleId, type StoreAppSelectionRequirements } from './selectStoreApp.js';
import type { MutableDeep } from '../types/mutable.js';

const SalesReportsCommandInputSchema = Schema.Struct({
  operation: Schema.Literal('sales'),
  vendorNumber: Schema.optional(Schema.String),
  date: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  frequency: Schema.String,
  reportType: Schema.String,
  subType: Schema.String,
  version: Schema.optional(Schema.String),
  out: Schema.String,
  json: Schema.Boolean,
});

const FinanceReportsCommandInputSchema = Schema.Struct({
  operation: Schema.Literal('finance'),
  vendorNumber: Schema.optional(Schema.String),
  date: Schema.optional(Schema.String),
  region: Schema.String,
  reportType: Schema.String,
  out: Schema.String,
  json: Schema.Boolean,
});

const AnalyticsReportsCommandInputSchema = Schema.Struct({
  operation: Schema.Literal('analytics'),
  app: Schema.optional(Schema.String),
  accessType: Schema.String,
  category: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  granularity: Schema.String,
  date: Schema.optional(Schema.String),
  out: Schema.String,
});

export const ReportsCommandInputSchema = Schema.Union(
  SalesReportsCommandInputSchema,
  FinanceReportsCommandInputSchema,
  AnalyticsReportsCommandInputSchema,
);

export type ReportsCommandInput = Schema.Schema.Type<typeof ReportsCommandInputSchema>;

export type ReportsCommandFailure = Readonly<{
  readonly _tag: 'ReportsCommandFailure';
  readonly operation: ReportsCommandInput['operation'];
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeReportsCommandFailure =
  Data.tagged<ReportsCommandFailure>('ReportsCommandFailure');

type ReportsCommandRequirements =
  | ActiveAppleStoreRequirements
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | Logger
  | Path.Path
  | StoreAppSelectionRequirements;

type WrittenReport = Readonly<{
  reportPath: string;
  reportEntryCount: number;
}>;

/** Select the explicit vendor number, falling back to the decoded environment setting. */
const selectVendorNumber = (
  explicitVendorNumber: string | undefined,
): Effect.Effect<string, ReportsCommandFailure, LaunchEnvironmentService> =>
  Effect.gen(function* () {
    const environment = yield* LaunchEnvironment;
    let vendorNumber = environment.values.appleVendorNumber;
    if (explicitVendorNumber !== undefined) vendorNumber = explicitVendorNumber;
    if (vendorNumber === undefined) {
      return yield* Effect.fail(
        makeReportsCommandFailure({
          operation: 'sales',
          message:
            'Vendor number required. Pass --vendor-number <N> or set ASC_VENDOR_NUMBER ' +
            '(find it in App Store Connect -> Payments and Financial Reports).',
        }),
      );
    }
    if (vendorNumber.trim().length === 0) {
      return yield* Effect.fail(
        makeReportsCommandFailure({
          operation: 'sales',
          message:
            'Vendor number required. Pass --vendor-number <N> or set ASC_VENDOR_NUMBER ' +
            '(find it in App Store Connect -> Payments and Financial Reports).',
        }),
      );
    }
    return vendorNumber;
  });

/** Convert a relative output directory into a path rooted at the current project. */
const projectOutputDirectory = (
  outputDirectory: string,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const pathService = yield* Path.Path;
    if (pathService.isAbsolute(outputDirectory)) return outputDirectory;
    return pathService.join(launchPaths.workingDirectory, outputDirectory);
  });

/** Convert an Apple report name into a filesystem-safe stem. */
const reportNameSlug = (reportName: string): string => {
  const reportSlug = reportName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (reportSlug.length === 0) return 'report';
  return reportSlug;
};

/** Write decompressed report text as raw TSV or parsed JSON. */
const writeReport = (
  outputDirectory: string,
  fileStem: string,
  reportText: string,
  writeJson: boolean,
): Effect.Effect<WrittenReport, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    yield* fileSystem.makeDirectory(outputDirectory, { recursive: true });
    const parsedReport = parseTsv(reportText);
    if (writeJson) {
      const reportPath = pathService.join(outputDirectory, `${fileStem}.json`);
      yield* fileSystem.writeFileString(
        reportPath,
        `${JSON.stringify(parsedReport.rows, null, 2)}\n`,
      );
      return { reportPath, reportEntryCount: parsedReport.rows.length };
    }
    const reportPath = pathService.join(outputDirectory, `${fileStem}.tsv`);
    let persistedText = reportText;
    if (!persistedText.endsWith('\n')) persistedText = `${persistedText}\n`;
    yield* fileSystem.writeFileString(reportPath, persistedText);
    return { reportPath, reportEntryCount: parsedReport.rows.length };
  });

/** Download, decompress, persist, and report one Apple report file. */
const downloadReport = (
  logger: Logger,
  fileStem: string,
  writeJson: boolean,
  outputDirectory: string,
  downloadBytes: Effect.Effect<Buffer, unknown>,
  emptyPeriodOnNotFound: boolean,
): Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const compressedBytes = yield* downloadBytes;
    const reportText = yield* Effect.try({
      try: () => decompressReport(compressedBytes),
      catch: (cause) => cause,
    });
    const writtenReport = yield* writeReport(outputDirectory, fileStem, reportText, writeJson);
    let pluralSuffix = 's';
    if (writtenReport.reportEntryCount === 1) pluralSuffix = '';
    yield* logger.step(
      fileStem,
      `${writtenReport.reportEntryCount} row${pluralSuffix} -> ${writtenReport.reportPath}`,
    );
  }).pipe(
    Effect.catchAll((cause) => {
      const message = errorMessage(cause);
      if (emptyPeriodOnNotFound && message.includes('(404)')) {
        return logger.note(`${fileStem}: no data for this period.`);
      }
      return Effect.fail(cause);
    }),
  );

/** Validate the sales date selector and enumerate every requested daily report. */
const selectSalesDates = (
  commandInput: Schema.Schema.Type<typeof SalesReportsCommandInputSchema>,
): Effect.Effect<string[], ReportsCommandFailure> => {
  if (commandInput.from !== undefined && commandInput.to !== undefined) {
    const firstReportDate = commandInput.from;
    const lastReportDate = commandInput.to;
    return eachDate(firstReportDate, lastReportDate).pipe(
      Effect.mapError((cause) =>
        makeReportsCommandFailure({ operation: 'sales', message: cause.message, cause }),
      ),
    );
  }
  if (commandInput.from !== undefined) {
    return Effect.fail(
      makeReportsCommandFailure({
        operation: 'sales',
        message: '--from requires a matching --to date.',
      }),
    );
  }
  if (commandInput.to !== undefined) {
    return Effect.fail(
      makeReportsCommandFailure({
        operation: 'sales',
        message: '--to requires a matching --from date.',
      }),
    );
  }
  if (commandInput.date !== undefined) return Effect.succeed([commandInput.date]);
  return Effect.fail(
    makeReportsCommandFailure({
      operation: 'sales',
      message: 'A date is required. Pass --date <YYYY-MM-DD> or a --from/--to range.',
    }),
  );
};

/** Download the requested Sales and Trends reports serially. */
const downloadSalesReports = (
  commandInput: Schema.Schema.Type<typeof SalesReportsCommandInputSchema>,
): Effect.Effect<void, unknown, ReportsCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const vendorNumber = yield* selectVendorNumber(commandInput.vendorNumber);
    const reportDates = yield* selectSalesDates(commandInput);
    const outputDirectory = yield* projectOutputDirectory(commandInput.out);
    const appleStore = yield* loadActiveAppleStore();
    yield* Effect.forEach(
      reportDates,
      (reportDate) => {
        const reportQuery: MutableDeep<SalesReportQuery> = {
          vendorNumber,
          frequency: commandInput.frequency,
          reportType: commandInput.reportType,
          reportSubType: commandInput.subType,
          reportDate,
        };
        if (commandInput.version !== undefined) reportQuery.version = commandInput.version;
        return downloadReport(
          logger,
          `sales-${commandInput.frequency}-${reportDate}`,
          commandInput.json,
          outputDirectory,
          appleStore.getSalesReport(reportQuery),
          true,
        );
      },
      { concurrency: 1, discard: true },
    );
  });

/** Download one Apple finance report for its fiscal period. */
const downloadFinanceReport = (
  commandInput: Schema.Schema.Type<typeof FinanceReportsCommandInputSchema>,
): Effect.Effect<void, unknown, ReportsCommandRequirements> =>
  Effect.gen(function* () {
    if (commandInput.date === undefined) {
      return yield* Effect.fail(
        makeReportsCommandFailure({
          operation: 'finance',
          message: 'A fiscal period is required. Pass --date <YYYY-MM>.',
        }),
      );
    }
    const logger = yield* createLogger(false);
    const vendorNumber = yield* selectVendorNumber(commandInput.vendorNumber);
    const outputDirectory = yield* projectOutputDirectory(commandInput.out);
    const appleStore = yield* loadActiveAppleStore();
    const reportQuery: MutableDeep<FinanceReportQuery> = {
      vendorNumber,
      reportDate: commandInput.date,
      regionCode: commandInput.region,
      reportType: commandInput.reportType,
    };
    yield* downloadReport(
      logger,
      `finance-${commandInput.region}-${commandInput.date}`,
      commandInput.json,
      outputDirectory,
      appleStore.getFinanceReport(reportQuery),
      true,
    );
  });

/** Request and download every matching App Store analytics segment. */
const downloadAnalyticsReports = (
  commandInput: Schema.Schema.Type<typeof AnalyticsReportsCommandInputSchema>,
): Effect.Effect<void, unknown, ReportsCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const bundleId = yield* resolveStoreBundleId(commandInput.app);
    const outputDirectory = yield* projectOutputDirectory(commandInput.out);
    const appleStore = yield* loadActiveAppleStore();
    const analyticsQuery: AnalyticsQuery = {
      bundleId,
      accessType: commandInput.accessType,
      granularity: commandInput.granularity,
    };
    if (commandInput.category !== undefined) analyticsQuery.category = commandInput.category;
    if (commandInput.name !== undefined) analyticsQuery.name = commandInput.name;
    if (commandInput.date !== undefined) analyticsQuery.processingDate = commandInput.date;
    const analyticsCollection = yield* collectAnalyticsSegments(appleStore, analyticsQuery);
    if (analyticsCollection.downloads.length === 0) {
      if (analyticsCollection.requestCreated) {
        yield* logger.note(
          'Analytics report requested. Apple generally generates it within two days; rerun this command to download it.',
        );
        return;
      }
      yield* logger.note('No analytics segments matched the selected filters.');
      return;
    }
    let segmentIndex = 0;
    yield* Effect.forEach(
      analyticsCollection.downloads,
      (segmentDownload) => {
        let processingDate = 'all';
        if (segmentDownload.processingDate.length > 0) {
          processingDate = segmentDownload.processingDate;
        }
        const fileStem = `analytics-${reportNameSlug(segmentDownload.reportName)}-${processingDate}-${segmentIndex}`;
        segmentIndex += 1;
        return downloadReport(
          logger,
          fileStem,
          false,
          outputDirectory,
          appleStore.downloadAnalyticsSegment(segmentDownload.url),
          false,
        );
      },
      { concurrency: 1, discard: true },
    );
    yield* logger.step(
      'analytics',
      `downloaded ${analyticsCollection.downloads.length} segment(s) from ${analyticsCollection.reportCount} report(s)`,
    );
  });

/** Run an Apple sales, finance, or analytics reporting operation. */
export const reportsCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, ReportsCommandFailure, ReportsCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(ReportsCommandInputSchema)(rawCommandInput);
    switch (commandInput.operation) {
      case 'sales':
        return yield* downloadSalesReports(commandInput);
      case 'finance':
        return yield* downloadFinanceReport(commandInput);
      case 'analytics':
        return yield* downloadAnalyticsReports(commandInput);
    }
  }).pipe(
    Effect.mapError((cause) => {
      let operation: ReportsCommandInput['operation'] = 'sales';
      if (Schema.is(ReportsCommandInputSchema)(rawCommandInput)) {
        operation = rawCommandInput.operation;
      }
      return makeReportsCommandFailure({
        operation,
        message: errorMessage(cause),
        cause,
      });
    }),
  );
