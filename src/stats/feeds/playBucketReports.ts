import type { DailyStat, DateRange } from '../../types/stats.js';
import { shiftDate } from '../dateRange.js';
import { decodePlayCsvBytes, readPlayCsvTable, type PlayCsvTable } from './playCsvTable.js';
import { readZipEntries } from './zip-archive.js';
import {
  downloadBucketObject,
  failBucketRead,
  listBucketObjectNames,
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
// The six digits after earnings/earnings_ are the report month.
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
  { folder: 'crashes', dimension: 'overview', isCoverageArbiter: false, readStats: readCrashStats },
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

type BucketReportsReply =
  | { readonly status: 'forbidden' }
  | {
      readonly status: 'read';
      readonly stats: readonly DailyStat[];
      readonly csvPublishedThrough: string;
      readonly earningsPublishedThrough: string | null;
    };

interface ReportFile {
  readonly report: MonthlyCsvReport;
  readonly reportMonth: string;
}

interface CsvDownload {
  readonly report: MonthlyCsvReport;
  readonly reply: Awaited<ReturnType<typeof downloadBucketObject>>;
}

async function mapInChunks<Piece, MappedPiece>(
  pieces: readonly Piece[],
  chunkSize: number,
  mapPiece: (piece: Piece) => Promise<MappedPiece>,
): Promise<MappedPiece[]> {
  const isDone = pieces.length == 0;

  if (isDone) {
    return [];
  }

  const chunk = pieces.slice(0, chunkSize);
  const mappedChunk = await Promise.all(chunk.map(mapPiece));
  const laterPieces = pieces.slice(chunkSize);
  const laterMapped = await mapInChunks(laterPieces, chunkSize, mapPiece);

  return [...mappedChunk, ...laterMapped];
}

function createMonthlyCsvObjectName(
  report: MonthlyCsvReport,
  packageName: string,
  reportMonth: string,
): string {
  return `stats/${report.folder}/${report.folder}_${packageName}_${reportMonth}_${report.dimension}.csv`;
}

function pickCsvPublishedThrough(latestArbiterDate: string | null, range: DateRange): string {
  if (latestArbiterDate == null) {
    return shiftDate(range.from, -1);
  }

  return latestArbiterDate;
}

async function readMonthlyCsvReports(request: BucketReportsRequest): Promise<BucketReportsReply> {
  const { bucket, accessToken, packageName, range } = request;
  const reportFiles = listReportMonths(range).flatMap(function monthFiles(
    reportMonth: string,
  ): ReportFile[] {
    return MONTHLY_CSV_REPORTS.map(function monthReport(report: MonthlyCsvReport): ReportFile {
      return { report, reportMonth };
    });
  });

  async function downloadReportFile(reportFile: ReportFile): Promise<CsvDownload> {
    const reply = await downloadBucketObject(
      bucket,
      createMonthlyCsvObjectName(reportFile.report, packageName, reportFile.reportMonth),
      accessToken,
    );

    return { report: reportFile.report, reply };
  }

  const downloads = await mapInChunks(reportFiles, DOWNLOAD_CONCURRENCY, downloadReportFile);

  function isForbiddenDownload(download: CsvDownload): boolean {
    return download.reply.status == 'forbidden';
  }

  const isAnyDownloadForbidden = downloads.some(isForbiddenDownload);

  if (isAnyDownloadForbidden) {
    return { status: 'forbidden' };
  }

  const publishedReports = downloads.flatMap(function readFoundReport(download: CsvDownload) {
    if (download.reply.status != 'found') {
      return [];
    }

    const table = readPlayCsvTable(decodePlayCsvBytes(download.reply.bytes));

    return [{ report: download.report, table }];
  });
  const stats = publishedReports.flatMap(function readPublishedStats(
    publishedReport: (typeof publishedReports)[number],
  ) {
    return publishedReport.report.readStats(publishedReport.table, range);
  });

  function isArbiter(publishedReport: (typeof publishedReports)[number]): boolean {
    return publishedReport.report.isCoverageArbiter;
  }

  const latestArbiterDate = publishedReports
    .filter(isArbiter)
    .reduce<string | null>(function pickLatest(latestDate, publishedReport): string | null {
      const reportDate = findLatestCsvDate(publishedReport.table);

      if (reportDate == null) {
        return latestDate;
      }

      return pickLaterKnownDate(latestDate, reportDate);
    }, null);

  return {
    status: 'read',
    stats,
    csvPublishedThrough: pickCsvPublishedThrough(latestArbiterDate, range),
    earningsPublishedThrough: null,
  };
}

/** The newest month any earnings object covers: the report is published through its last day. */
function findEarningsPublishedThrough(objectNames: readonly string[]): string | null {
  const reportMonths = objectNames.flatMap(function readReportMonth(objectName: string): string[] {
    const reportMonth = EARNINGS_MONTH_PATTERN.exec(objectName)?.[1];

    if (reportMonth == null) {
      return [];
    }

    return [reportMonth];
  });
  const newestMonth = reportMonths.reduce<string | null>(pickLaterKnownDate, null);

  if (newestMonth == null) {
    return null;
  }

  return findLastDayOfReportMonth(newestMonth);
}

async function readEarningsReports(request: BucketReportsRequest): Promise<
  | { readonly status: 'forbidden' }
  | {
      readonly status: 'read';
      readonly stats: DailyStat[];
      readonly publishedThrough: string | null;
    }
> {
  const { bucket, accessToken, packageName, range } = request;
  const listing = await listBucketObjectNames(bucket, EARNINGS_PREFIX, accessToken);

  if (listing.status == 'forbidden') {
    return { status: 'forbidden' };
  }

  const touchedMonths = listReportMonths(range);

  function isTouchedObject(objectName: string): boolean {
    function monthMatches(reportMonth: string): boolean {
      return objectName.startsWith(`${EARNINGS_PREFIX}${reportMonth}`);
    }

    return touchedMonths.some(monthMatches);
  }

  const touchedObjectNames = listing.objectNames.filter(isTouchedObject);

  async function downloadEarnings(objectName: string) {
    return downloadBucketObject(bucket, objectName, accessToken);
  }

  const downloads = await mapInChunks(touchedObjectNames, DOWNLOAD_CONCURRENCY, downloadEarnings);

  function isForbiddenDownload(download: (typeof downloads)[number]): boolean {
    return download.status == 'forbidden';
  }

  if (downloads.some(isForbiddenDownload)) {
    return { status: 'forbidden' };
  }

  const zipBytesList = downloads.flatMap(function readFoundZip(
    download: (typeof downloads)[number],
  ): Uint8Array[] {
    if (download.status != 'found') {
      return [];
    }

    return [download.bytes];
  });
  const statsPerZip: DailyStat[][] = [];

  for (const zipBytes of zipBytesList) {
    let zipEntries: Record<string, Uint8Array>;

    try {
      zipEntries = readZipEntries(zipBytes);
    } catch (cause) {
      throw failBucketRead('unzip an earnings report', cause);
    }

    const zipStats = Object.values(zipEntries).flatMap(function readZipStats(
      csvBytes: Uint8Array,
    ): DailyStat[] {
      const earningsTable = readPlayCsvTable(decodePlayCsvBytes(csvBytes));

      return readEarningsStats(earningsTable, packageName, range);
    });
    statsPerZip.push(zipStats);
  }

  return {
    status: 'read',
    stats: statsPerZip.flat(),
    publishedThrough: findEarningsPublishedThrough(listing.objectNames),
  };
}

/** Installs, ratings, crashes, store visitors and earnings of one package from the Play reports bucket. */
export async function readBucketReports(
  request: BucketReportsRequest,
): Promise<BucketReportsReply> {
  const csvReports = await readMonthlyCsvReports(request);

  if (csvReports.status == 'forbidden') {
    return csvReports;
  }

  const earningsReports = await readEarningsReports(request);

  if (earningsReports.status == 'forbidden') {
    return earningsReports;
  }

  return {
    status: 'read',
    stats: [...csvReports.stats, ...earningsReports.stats],
    csvPublishedThrough: csvReports.csvPublishedThrough,
    earningsPublishedThrough: earningsReports.publishedThrough,
  };
}
