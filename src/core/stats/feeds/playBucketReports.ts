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
    const stats: DailyStat[] = [];
    let latestArbiterDate: string | null = null;
    for (const download of downloads) {
      if (download.reply.status === 'forbidden') return { status: 'forbidden' } as const;
      if (download.reply.status === 'missing') continue;
      const table = readPlayCsvTable(decodePlayCsvBytes(download.reply.bytes));
      stats.push(...download.report.readStats(table, range));
      const latestDate = findLatestCsvDate(table);
      const isArbiterNewer =
        download.report.isCoverageArbiter &&
        latestDate !== null &&
        (latestArbiterDate === null || latestDate > latestArbiterDate);
      if (isArbiterNewer) latestArbiterDate = latestDate;
    }
    const noDayPublished = shiftDate(range.from, -1);
    let csvPublishedThrough = noDayPublished;
    if (latestArbiterDate !== null) csvPublishedThrough = latestArbiterDate;
    return {
      status: 'read',
      stats,
      csvPublishedThrough,
      earningsPublishedThrough: null,
    } as const;
  });

/** The newest month any earnings object covers: the report is published through its last day. */
const findEarningsPublishedThrough = (objectNames: readonly string[]): string | null => {
  let newestMonth: string | null = null;
  for (const objectName of objectNames) {
    const monthParts = EARNINGS_MONTH_PATTERN.exec(objectName);
    const reportMonth = monthParts?.[1];
    if (reportMonth === undefined) continue;
    const isMonthNewer = newestMonth === null || reportMonth > newestMonth;
    if (isMonthNewer) newestMonth = reportMonth;
  }
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
    const stats: DailyStat[] = [];
    for (const download of downloads) {
      if (download.status === 'forbidden') return { status: 'forbidden' } as const;
      if (download.status === 'missing') continue;
      const zipEntries = yield* Effect.try({
        try: () => unzipSync(download.bytes),
        catch: (cause) => failBucketRead('unzip an earnings report', cause),
      });
      for (const csvBytes of Object.values(zipEntries)) {
        const table = readPlayCsvTable(decodePlayCsvBytes(csvBytes));
        stats.push(...readEarningsStats(table, packageName, range));
      }
    }
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
