import type { HttpClient } from '@effect/platform';
import { Effect } from 'effect';
import { unzipSync } from 'fflate';
import type { DailyStat, DateRange } from '../../types/stats.js';
import { shiftDate } from '../dateRange.js';
import { decodePlayCsvBytes, readPlayCsvTable, type PlayCsvTable } from './playCsvTable.js';
import {
  downloadBucketObject,
  failBucketRead,
  listBucketObjectNames,
  type PlayReportsBucketFailure,
} from './playReportsBucketClient.js';
import {
  findLastDayOfReportMonth,
  findLatestCsvDate,
  listReportMonths,
  pickLaterKnownDate,
  readCrashStats,
  readEarningsStats,
  readInstallStats,
  readRatingStats,
  readStorePerformanceStats,
} from './playReportStats.js';

const DOWNLOAD_CONCURRENCY = 4;
const EARNINGS_PREFIX = 'earnings/earnings_';
const EARNINGS_MONTH_PATTERN = /^earnings\/earnings_(\d{6})/;

interface MonthlyCsvReport {
  readonly folder: string;
  readonly dimension: string;
  readonly isCoverageArbiter: boolean;
  readonly readStats: (table: PlayCsvTable, range: DateRange) => DailyStat[];
}

// The installs overview is the one daily report every app gets, so it decides how far the CSVs are published.
const MONTHLY_CSV_REPORTS: readonly MonthlyCsvReport[] = [
  {
    folder: 'installs',
    dimension: 'overview',
    isCoverageArbiter: true,
    readStats: readInstallStats,
  },
  {
    folder: 'ratings',
    dimension: 'overview',
    isCoverageArbiter: false,
    readStats: readRatingStats,
  },
  {
    folder: 'crashes',
    dimension: 'overview',
    isCoverageArbiter: false,
    readStats: readCrashStats,
  },
  {
    folder: 'store_performance',
    dimension: 'country',
    isCoverageArbiter: false,
    readStats: readStorePerformanceStats,
  },
];

interface BucketReportsRequest {
  readonly bucket: string;
  readonly accessToken: string;
  readonly packageName: string;
  readonly range: DateRange;
}

export type BucketReportsReply =
  | { readonly status: 'forbidden' }
  | {
      readonly status: 'read';
      readonly stats: readonly DailyStat[];
      readonly csvPublishedThrough: string;
      readonly earningsPublishedThrough: string | null;
    };

const createMonthlyCsvObjectName = (
  report: MonthlyCsvReport,
  packageName: string,
  reportMonth: string,
): string =>
  `stats/${report.folder}/${report.folder}_${packageName}_${reportMonth}_${report.dimension}.csv`;

const pickCsvPublishedThrough = (latestArbiterDate: string | null, range: DateRange): string => {
  if (latestArbiterDate === null) return shiftDate(range.from, -1);
  return latestArbiterDate;
};

const readMonthlyCsvReports = (
  request: BucketReportsRequest,
): Effect.Effect<BucketReportsReply, PlayReportsBucketFailure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const { bucket, accessToken, packageName, range } = request;
    const reportFiles = listReportMonths(range).flatMap((reportMonth) =>
      MONTHLY_CSV_REPORTS.map((report) => ({ report, reportMonth })),
    );
    const downloads = yield* Effect.forEach(
      reportFiles,
      (reportFile) =>
        downloadBucketObject(
          bucket,
          createMonthlyCsvObjectName(reportFile.report, packageName, reportFile.reportMonth),
          accessToken,
        ).pipe(Effect.map((reply) => ({ report: reportFile.report, reply }))),
      { concurrency: DOWNLOAD_CONCURRENCY },
    );
    const isAnyDownloadForbidden = downloads.some(
      (download) => download.reply.status === 'forbidden',
    );
    if (isAnyDownloadForbidden) return { status: 'forbidden' } as const;
    const publishedReports = downloads.flatMap((download) => {
      if (download.reply.status !== 'found') return [];
      const table = readPlayCsvTable(decodePlayCsvBytes(download.reply.bytes));
      return [{ report: download.report, table }];
    });
    const stats = publishedReports.flatMap((publishedReport) =>
      publishedReport.report.readStats(publishedReport.table, range),
    );
    const latestArbiterDate = publishedReports
      .filter((publishedReport) => publishedReport.report.isCoverageArbiter)
      .reduce<string | null>((latestDate, publishedReport) => {
        const reportDate = findLatestCsvDate(publishedReport.table);
        if (reportDate === null) return latestDate;
        return pickLaterKnownDate(latestDate, reportDate);
      }, null);
    return {
      status: 'read',
      stats,
      csvPublishedThrough: pickCsvPublishedThrough(latestArbiterDate, range),
      earningsPublishedThrough: null,
    } as const;
  });

/** The newest month any earnings object covers: the report is published through its last day. */
const findEarningsPublishedThrough = (objectNames: readonly string[]): string | null => {
  const reportMonths = objectNames.flatMap((objectName) => {
    const reportMonth = EARNINGS_MONTH_PATTERN.exec(objectName)?.[1];
    if (reportMonth === undefined) return [];
    return [reportMonth];
  });
  const newestMonth = reportMonths.reduce<string | null>(pickLaterKnownDate, null);
  if (newestMonth === null) return null;
  return findLastDayOfReportMonth(newestMonth);
};

const readEarningsReports = (
  request: BucketReportsRequest,
): Effect.Effect<
  | { readonly status: 'forbidden' }
  | {
      readonly status: 'read';
      readonly stats: DailyStat[];
      readonly publishedThrough: string | null;
    },
  PlayReportsBucketFailure,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const { bucket, accessToken, packageName, range } = request;
    const listing = yield* listBucketObjectNames(bucket, EARNINGS_PREFIX, accessToken);
    if (listing.status === 'forbidden') return { status: 'forbidden' } as const;
    const touchedMonths = listReportMonths(range);
    const touchedObjectNames = listing.objectNames.filter((objectName) =>
      touchedMonths.some((reportMonth) =>
        objectName.startsWith(`${EARNINGS_PREFIX}${reportMonth}`),
      ),
    );
    const downloads = yield* Effect.forEach(
      touchedObjectNames,
      (objectName) => downloadBucketObject(bucket, objectName, accessToken),
      { concurrency: DOWNLOAD_CONCURRENCY },
    );
    const isAnyDownloadForbidden = downloads.some((download) => download.status === 'forbidden');
    if (isAnyDownloadForbidden) return { status: 'forbidden' } as const;
    const zipBytesList = downloads.flatMap((download) => {
      if (download.status !== 'found') return [];
      return [download.bytes];
    });
    const statsPerZip = yield* Effect.forEach(zipBytesList, (zipBytes) =>
      Effect.try({
        try: () => unzipSync(zipBytes),
        catch: (cause) => failBucketRead('unzip an earnings report', cause),
      }).pipe(
        Effect.map((zipEntries) =>
          Object.values(zipEntries).flatMap((csvBytes) => {
            const earningsTable = readPlayCsvTable(decodePlayCsvBytes(csvBytes));
            return readEarningsStats(earningsTable, packageName, range);
          }),
        ),
      ),
    );
    const stats = statsPerZip.flat();
    return {
      status: 'read',
      stats,
      publishedThrough: findEarningsPublishedThrough(listing.objectNames),
    } as const;
  });

/** Installs, ratings, crashes, store visitors and earnings of one package from the Play reports bucket. */
export const readBucketReports = (
  request: BucketReportsRequest,
): Effect.Effect<BucketReportsReply, PlayReportsBucketFailure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const csvReports = yield* readMonthlyCsvReports(request);
    if (csvReports.status === 'forbidden') return csvReports;
    const earningsReports = yield* readEarningsReports(request);
    if (earningsReports.status === 'forbidden') return earningsReports;
    return {
      status: 'read',
      stats: [...csvReports.stats, ...earningsReports.stats],
      csvPublishedThrough: csvReports.csvPublishedThrough,
      earningsPublishedThrough: earningsReports.publishedThrough,
    } as const;
  });
