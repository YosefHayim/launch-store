import { errorMessage } from '../../services/platform/errorMessage.js';
import { summarizeRatings } from '../../insights/aggregate.js';
import {
  collectAnalyticsSegments,
  decompressReport,
  eachDate,
  parseTsv,
  type AscReportsApi,
  type ParsedReport,
} from '../../store/apple/reports.js';
import type { PortfolioApp } from '../../types/portfolio.js';
import type { ReviewDatum, StarRating } from '../../types/insights.js';
import type { DailyStat, DateRange, FeedFetchReply, StatsFeedFailure } from '../../types/stats.js';
import { shiftDate } from '../dateRange.js';
import type { AppStoreStatsClient, StatsCredentialsApi } from '../statsCredentials.js';
import {
  ANALYTICS_REPORT_NAMES,
  summarizeAnalyticsBatches,
  type AnalyticsSummary,
} from './appStoreAnalyticsReport.js';
import type {
  AnalyticsAccessType,
  AnalyticsReportBatch,
  AnalyticsReportKind,
  AppStoreStatsPath,
  ReportLine,
} from './appStoreFeedTypes.js';
import { findAppSkus, summarizeSalesLines } from './appStoreSalesReport.js';

interface AppStoreFetchRequest {
  readonly app: PortfolioApp;
  readonly range: DateRange;
  readonly credentials: StatsCredentialsApi;
}

const SALES_PATH_ANALYTICS_KINDS: readonly AnalyticsReportKind[] = [
  'discovery',
  'sessions',
  'crashes',
  'installs',
];
const ANALYTICS_KINDS_BY_PATH: Record<AppStoreStatsPath, readonly AnalyticsReportKind[]> = {
  sales: SALES_PATH_ANALYTICS_KINDS,
  analytics: [...SALES_PATH_ANALYTICS_KINDS, 'downloads', 'purchases'],
};

// Sales Reports hold every app of a vendor, so one report per (vendor, date) serves all apps of a sync run.
const salesReportCache = new Map<string, ParsedReport | null>();

interface SegmentToRead {
  readonly url: string;
  readonly processingDate: string;
}

interface DatedReport {
  readonly date: string;
  readonly report: ParsedReport | null;
}

interface AppStoreLoad {
  readonly salesStats: readonly DailyStat[];
  readonly analyticsSummary: AnalyticsSummary;
  readonly ratingStats: readonly DailyStat[];
}

function makeStatsFeedFailure(app: PortfolioApp, cause: unknown): StatsFeedFailure {
  return {
    _tag: 'StatsFeedFailure',
    feed: 'app-store',
    appKey: app.key,
    message: errorMessage(cause),
    cause,
  };
}

/** Sales Reports when the account has a vendor number, else the Analytics Reports alone. */
export function pickStatsPath(vendorNumber: string | null): AppStoreStatsPath {
  if (vendorNumber == null) {
    return 'analytics';
  }

  return 'sales';
}

/** True when the range reaches back past the refresh tail, so the one-time history snapshot is worth reading. */
export function isHistoryNeeded(range: DateRange): boolean {
  const historyRangeDays = 14;

  return range.from < shiftDate(range.to, -historyRangeDays);
}

export function readHttpStatus(failure: unknown): number | null {
  if (failure == null) {
    return null;
  }

  if (typeof failure != 'object') {
    return null;
  }

  if ('status' in failure == false) {
    return null;
  }

  const status = failure.status;

  if (typeof status != 'number') {
    return null;
  }

  return status;
}

function createPreparingReason(appName: string): string {
  return `Apple is preparing analytics reports for ${appName}; first data within 1-2 days`;
}

function createForbiddenReason(accountLabel: string): string {
  return `The App Store Connect key of account ${accountLabel} lacks a role: Sales Reports need the Sales, Finance or Admin role; Analytics Reports need Admin to create the request and Sales and Reports, Finance or Admin to read it`;
}

function pickStarRating(rating: number): StarRating | null {
  switch (rating) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
      return rating;
    default:
      return null;
  }
}

function readReportLines(report: ParsedReport | null): readonly ReportLine[] {
  if (report == null) {
    return [];
  }

  return report.rows;
}

async function mapInChunks<Piece, MappedPiece>(
  pieces: readonly Piece[],
  chunkSize: number,
  mapPiece: (piece: Piece) => Promise<MappedPiece>,
): Promise<MappedPiece[]> {
  if (pieces.length == 0) {
    return [];
  }

  const chunk = pieces.slice(0, chunkSize);
  const mappedChunk = await Promise.all(chunk.map(mapPiece));
  const laterMapped = await mapInChunks(pieces.slice(chunkSize), chunkSize, mapPiece);

  return [...mappedChunk, ...laterMapped];
}

function createReportsApi(client: AppStoreStatsClient, storeId: string): AscReportsApi {
  return {
    async getAppId() {
      return storeId;
    },
    listAnalyticsReportRequests(appId, accessType) {
      return client.listAnalyticsReportRequests(appId, accessType);
    },
    createAnalyticsReportRequest(appId, accessType) {
      return client.createAnalyticsReportRequest(appId, accessType);
    },
    listAnalyticsReports(requestId, filters) {
      return client.listAnalyticsReports(requestId, filters);
    },
    listAnalyticsReportInstances(reportId, filters) {
      return client.listAnalyticsReportInstances(reportId, filters);
    },
    listAnalyticsReportSegments(instanceId) {
      return client.listAnalyticsReportSegments(instanceId);
    },
  };
}

async function readSalesReport(
  client: AppStoreStatsClient,
  vendorNumber: string,
  date: string,
): Promise<ParsedReport | null> {
  const cacheKey = `${vendorNumber}|${date}`;
  const isCached = salesReportCache.has(cacheKey);

  if (isCached) {
    const cachedReport = salesReportCache.get(cacheKey);

    if (cachedReport == null) {
      return null;
    }

    return cachedReport;
  }

  try {
    const reportBytes = await client.getSalesReport({
      vendorNumber,
      frequency: 'DAILY',
      reportType: 'SALES',
      reportSubType: 'SUMMARY',
      reportDate: date,
      version: '1_0',
    });
    const parsedReport = parseTsv(decompressReport(reportBytes));
    salesReportCache.set(cacheKey, parsedReport);

    return parsedReport;
  } catch (cause) {
    const isNoSalesThatDay = readHttpStatus(cause) == 404;

    if (isNoSalesThatDay) {
      salesReportCache.set(cacheKey, null);

      return null;
    }

    throw cause;
  }
}

async function loadSalesStats(
  client: AppStoreStatsClient,
  vendorNumber: string,
  request: AppStoreFetchRequest,
): Promise<readonly DailyStat[]> {
  const { app, range } = request;
  const dates = eachDate(range.from, range.to);

  async function readDatedReport(date: string): Promise<DatedReport> {
    const report = await readSalesReport(client, vendorNumber, date);

    return { date, report };
  }

  const dailyReports = await mapInChunks(dates, 4, readDatedReport);
  const allLines = dailyReports.flatMap(function readLines(datedReport: DatedReport) {
    return readReportLines(datedReport.report);
  });
  const appSkus = findAppSkus(allLines, app.storeId);

  return dailyReports.flatMap(function readDayStats(datedReport: DatedReport) {
    return summarizeSalesLines(readReportLines(datedReport.report), {
      date: datedReport.date,
      storeId: app.storeId,
      appSkus,
    });
  });
}

async function readAnalyticsSegment(
  client: AppStoreStatsClient,
  segment: SegmentToRead,
  kind: AnalyticsReportKind,
  accessType: AnalyticsAccessType,
): Promise<AnalyticsReportBatch> {
  const segmentBytes = await client.downloadAnalyticsSegment(segment.url);
  const parsedSegment = parseTsv(decompressReport(segmentBytes));

  return { kind, accessType, processingDate: segment.processingDate, lines: parsedSegment.rows };
}

// An ongoing instance older than the range cannot hold a day of the range.
function isSegmentWanted(
  processingDate: string,
  accessType: AnalyticsAccessType,
  range: DateRange,
): boolean {
  const isSnapshot = accessType == 'ONE_TIME_SNAPSHOT';

  if (isSnapshot) {
    return true;
  }

  return processingDate >= range.from;
}

async function loadAnalyticsBatches(
  client: AppStoreStatsClient,
  request: AppStoreFetchRequest,
  kinds: readonly AnalyticsReportKind[],
  accessType: AnalyticsAccessType,
): Promise<readonly AnalyticsReportBatch[]> {
  const { app, range } = request;
  const reportsApi = createReportsApi(client, app.storeId);
  const batches: AnalyticsReportBatch[] = [];

  for (const kind of kinds) {
    const collection = await collectAnalyticsSegments(reportsApi, {
      bundleId: app.storeId,
      accessType,
      name: ANALYTICS_REPORT_NAMES[kind],
      granularity: 'DAILY',
    });

    function isWanted(download: { processingDate: string }): boolean {
      return isSegmentWanted(download.processingDate, accessType, range);
    }

    const wantedSegments = collection.downloads.filter(isWanted);

    async function readSegment(segment: SegmentToRead): Promise<AnalyticsReportBatch> {
      return readAnalyticsSegment(client, segment, kind, accessType);
    }

    const kindBatches = await mapInChunks(wantedSegments, 4, readSegment);
    batches.push(...kindBatches);
  }

  return batches;
}

async function loadSnapshotBatches(
  client: AppStoreStatsClient,
  request: AppStoreFetchRequest,
  kinds: readonly AnalyticsReportKind[],
): Promise<readonly AnalyticsReportBatch[]> {
  if (isHistoryNeeded(request.range) == false) {
    return [];
  }

  return loadAnalyticsBatches(client, request, kinds, 'ONE_TIME_SNAPSHOT');
}

async function loadAnalyticsSummary(
  client: AppStoreStatsClient,
  request: AppStoreFetchRequest,
  path: AppStoreStatsPath,
): Promise<AnalyticsSummary> {
  const kinds = ANALYTICS_KINDS_BY_PATH[path];
  const ongoingBatches = await loadAnalyticsBatches(client, request, kinds, 'ONGOING');
  const snapshotBatches = await loadSnapshotBatches(client, request, kinds);

  return summarizeAnalyticsBatches([...ongoingBatches, ...snapshotBatches], {
    storeId: request.app.storeId,
    range: request.range,
  });
}

async function loadRatingStats(
  client: AppStoreStatsClient,
  request: AppStoreFetchRequest,
): Promise<readonly DailyStat[]> {
  const customerReviews = await client.listCustomerReviews(request.app.storeId);
  const ratedReviews = customerReviews.flatMap(function readReview(customerReview): ReviewDatum[] {
    const starRating = pickStarRating(customerReview.rating);

    if (starRating == null) {
      return [];
    }

    return [{ store: 'appstore', rating: starRating, answered: customerReview.answered }];
  });
  const ratingSummary = summarizeRatings(ratedReviews);

  if (ratingSummary.total == 0) {
    return [];
  }

  const date = request.range.to;

  return [
    {
      date,
      feed: 'app-store',
      metric: 'ratingAverage',
      value: ratingSummary.average,
      currency: null,
    },
    { date, feed: 'app-store', metric: 'ratingCount', value: ratingSummary.total, currency: null },
  ];
}

/** The stats of every source become one reply; no analytics yet keeps the stats but leaves the days uncovered. */
export function createAppStoreReply(
  load: AppStoreLoad,
  request: AppStoreFetchRequest,
): FeedFetchReply {
  const latestDate = load.analyticsSummary.latestDate;
  const stats = [...load.salesStats, ...load.analyticsSummary.stats, ...load.ratingStats];

  if (latestDate != null) {
    return { status: 'fetched', stats, coveredThrough: latestDate, notes: [] };
  }

  if (stats.length == 0) {
    return { status: 'skipped', reason: createPreparingReason(request.app.name) };
  }

  return {
    status: 'fetched',
    stats,
    coveredThrough: shiftDate(request.range.from, -1),
    notes: [createPreparingReason(request.app.name)],
  };
}

async function loadKnownVendorSales(
  client: AppStoreStatsClient,
  vendorNumber: string | null,
  request: AppStoreFetchRequest,
): Promise<readonly DailyStat[]> {
  if (vendorNumber == null) {
    return [];
  }

  return loadSalesStats(client, vendorNumber, request);
}

async function loadAppStoreStats(
  client: AppStoreStatsClient,
  vendorNumber: string | null,
  request: AppStoreFetchRequest,
): Promise<FeedFetchReply> {
  const path = pickStatsPath(vendorNumber);
  const salesStats = await loadKnownVendorSales(client, vendorNumber, request);
  const analyticsSummary = await loadAnalyticsSummary(client, request, path);
  const ratingStats = await loadRatingStats(client, request);

  return createAppStoreReply({ salesStats, analyticsSummary, ratingStats }, request);
}

function isAppStoreApplicable(app: PortfolioApp): boolean {
  return app.platform == 'ios';
}

async function fetchAppStoreDays(request: AppStoreFetchRequest): Promise<FeedFetchReply> {
  const { app, credentials } = request;

  try {
    if (app.accountKeyId == null) {
      return { status: 'skipped', reason: `${app.name} has no App Store Connect account` };
    }

    const client = await credentials.ascClientForAccount(app.accountKeyId);

    if (client == null) {
      return {
        status: 'skipped',
        reason: `No saved App Store Connect key for account ${app.accountLabel}`,
      };
    }

    const vendorNumber = await credentials.vendorNumberForAccount(app.accountKeyId);

    return await loadAppStoreStats(client, vendorNumber, request);
  } catch (cause) {
    const isKeyLackingRole = readHttpStatus(cause) == 403;

    if (isKeyLackingRole) {
      return { status: 'skipped', reason: createForbiddenReason(app.accountLabel) };
    }

    throw makeStatsFeedFailure(app, cause);
  }
}

export const appStoreFeed = {
  feed: 'app-store' as const,
  isApplicable: isAppStoreApplicable,
  fetchDays: fetchAppStoreDays,
};
