import { Data, Effect } from 'effect';
import type { EffectAppStoreConnectClient } from '../../services/appleStoreClient.js';
import { errorMessage } from '../../services/errorMessage.js';
import { summarizeRatings } from '../../insights/aggregate.js';
import {
  collectAnalyticsSegments,
  decompressReport,
  eachDate,
  parseTsv,
  type AscReportsApi,
  type ParsedReport,
} from '../../store/reports.js';
import type { PortfolioApp } from '../../types/portfolio.js';
import type { ReviewDatum, StarRating } from '../../types/insights.js';
import type {
  DailyStat,
  DateRange,
  FeedFetchReply,
  StatsFeedFailure,
  StatsFeedPlugin,
} from '../../types/stats.js';
import { shiftDate } from '../dateRange.js';
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

type AppStoreFetchRequest = Parameters<StatsFeedPlugin['fetchDays']>[0];

const HISTORY_RANGE_DAYS = 14;
const SALES_CONCURRENCY = 4;
const SEGMENT_CONCURRENCY = 4;
const NOT_FOUND_STATUS = 404;
const FORBIDDEN_STATUS = 403;

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

const makeStatsFeedFailure = Data.tagged<StatsFeedFailure>('StatsFeedFailure');

// Sales Reports hold every app of a vendor, so one report per (vendor, date) serves all apps of a sync run.
const salesReportCache = new Map<string, ParsedReport | null>();

/** Sales Reports when the account has a vendor number, else the Analytics Reports alone. */
export const pickStatsPath = (vendorNumber: string | null): AppStoreStatsPath => {
  if (vendorNumber === null) return 'analytics';
  return 'sales';
};

/** True when the range reaches back past the refresh tail, so the one-time history snapshot is worth reading. */
export const isHistoryNeeded = (range: DateRange): boolean =>
  range.from < shiftDate(range.to, -HISTORY_RANGE_DAYS);

export const readHttpStatus = (failure: unknown): number | null => {
  const isFailureObject = typeof failure === 'object' && failure !== null;
  if (!isFailureObject) return null;
  if (!('status' in failure)) return null;
  const status = failure.status;
  if (typeof status !== 'number') return null;
  return status;
};

const createPreparingReason = (appName: string): string =>
  `Apple is preparing analytics reports for ${appName}; first data within 1-2 days`;

const createForbiddenReason = (accountLabel: string): string =>
  `The App Store Connect key of account ${accountLabel} lacks a role: Sales Reports need the Sales, Finance or Admin role; Analytics Reports need Admin to create the request and Sales and Reports, Finance or Admin to read it`;

const pickStarRating = (rating: number): StarRating | null => {
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
};

const readReportLines = (report: ParsedReport | null): readonly ReportLine[] => {
  if (report === null) return [];
  return report.rows;
};

const createReportsApi = (client: EffectAppStoreConnectClient, storeId: string): AscReportsApi => ({
  getAppId: () => Effect.succeed(storeId),
  listAnalyticsReportRequests: (appId, accessType) =>
    client.listAnalyticsReportRequests(appId, accessType),
  createAnalyticsReportRequest: (appId, accessType) =>
    client.createAnalyticsReportRequest(appId, accessType),
  listAnalyticsReports: (requestId, filters) => client.listAnalyticsReports(requestId, filters),
  listAnalyticsReportInstances: (reportId, filters) =>
    client.listAnalyticsReportInstances(reportId, filters),
  listAnalyticsReportSegments: (instanceId) => client.listAnalyticsReportSegments(instanceId),
});

const readSalesReport = (
  client: EffectAppStoreConnectClient,
  vendorNumber: string,
  date: string,
): Effect.Effect<ParsedReport | null, unknown> =>
  Effect.gen(function* () {
    const cacheKey = `${vendorNumber}|${date}`;
    const cachedReport = salesReportCache.get(cacheKey);
    if (cachedReport !== undefined) return cachedReport;
    const reportBytes = yield* client
      .getSalesReport({
        vendorNumber,
        frequency: 'DAILY',
        reportType: 'SALES',
        reportSubType: 'SUMMARY',
        reportDate: date,
        version: '1_0',
      })
      .pipe(
        Effect.catchAll((failure) => {
          const isNoSalesThatDay = readHttpStatus(failure) === NOT_FOUND_STATUS;
          if (isNoSalesThatDay) return Effect.succeed(null);
          return Effect.fail(failure);
        }),
      );
    if (reportBytes === null) {
      salesReportCache.set(cacheKey, null);
      return null;
    }
    const reportTsv = yield* Effect.try(() => decompressReport(reportBytes));
    const parsedReport = parseTsv(reportTsv);
    salesReportCache.set(cacheKey, parsedReport);
    return parsedReport;
  });

const loadSalesStats = (
  client: EffectAppStoreConnectClient,
  vendorNumber: string,
  request: AppStoreFetchRequest,
): Effect.Effect<readonly DailyStat[], unknown> =>
  Effect.gen(function* () {
    const { app, range } = request;
    const dates = yield* eachDate(range.from, range.to);
    const dailyReports = yield* Effect.forEach(
      dates,
      (date) =>
        readSalesReport(client, vendorNumber, date).pipe(
          Effect.map((report) => ({ date, report })),
        ),
      { concurrency: SALES_CONCURRENCY },
    );
    const allLines = dailyReports.flatMap(({ report }) => readReportLines(report));
    const appSkus = findAppSkus(allLines, app.storeId);
    return dailyReports.flatMap(({ date, report }) =>
      summarizeSalesLines(readReportLines(report), { date, storeId: app.storeId, appSkus }),
    );
  });

interface SegmentToRead {
  readonly url: string;
  readonly processingDate: string;
}

const readAnalyticsSegment = (
  client: EffectAppStoreConnectClient,
  segment: SegmentToRead,
  kind: AnalyticsReportKind,
  accessType: AnalyticsAccessType,
): Effect.Effect<AnalyticsReportBatch, unknown> =>
  Effect.gen(function* () {
    const segmentBytes = yield* client.downloadAnalyticsSegment(segment.url);
    const segmentTsv = yield* Effect.try(() => decompressReport(segmentBytes));
    const parsedSegment = parseTsv(segmentTsv);
    return { kind, accessType, processingDate: segment.processingDate, lines: parsedSegment.rows };
  });

// An ongoing instance older than the range cannot hold a day of the range.
const isSegmentWanted = (
  processingDate: string,
  accessType: AnalyticsAccessType,
  range: DateRange,
): boolean => {
  const isSnapshot = accessType === 'ONE_TIME_SNAPSHOT';
  if (isSnapshot) return true;
  return processingDate >= range.from;
};

const loadAnalyticsBatches = (
  client: EffectAppStoreConnectClient,
  request: AppStoreFetchRequest,
  kinds: readonly AnalyticsReportKind[],
  accessType: AnalyticsAccessType,
): Effect.Effect<readonly AnalyticsReportBatch[], unknown> =>
  Effect.gen(function* () {
    const { app, range } = request;
    const reportsApi = createReportsApi(client, app.storeId);
    const batchesByKind = yield* Effect.forEach(kinds, (kind) =>
      Effect.gen(function* () {
        const collection = yield* collectAnalyticsSegments(reportsApi, {
          bundleId: app.storeId,
          accessType,
          name: ANALYTICS_REPORT_NAMES[kind],
          granularity: 'DAILY',
        });
        const wantedSegments = collection.downloads.filter((download) =>
          isSegmentWanted(download.processingDate, accessType, range),
        );
        return yield* Effect.forEach(
          wantedSegments,
          (segment) => readAnalyticsSegment(client, segment, kind, accessType),
          { concurrency: SEGMENT_CONCURRENCY },
        );
      }),
    );
    return batchesByKind.flat();
  });

const loadSnapshotBatches = (
  client: EffectAppStoreConnectClient,
  request: AppStoreFetchRequest,
  kinds: readonly AnalyticsReportKind[],
): Effect.Effect<readonly AnalyticsReportBatch[], unknown> => {
  if (!isHistoryNeeded(request.range)) return Effect.succeed([]);
  return loadAnalyticsBatches(client, request, kinds, 'ONE_TIME_SNAPSHOT');
};

const loadAnalyticsSummary = (
  client: EffectAppStoreConnectClient,
  request: AppStoreFetchRequest,
  path: AppStoreStatsPath,
): Effect.Effect<AnalyticsSummary, unknown> =>
  Effect.gen(function* () {
    const { app, range } = request;
    const kinds = ANALYTICS_KINDS_BY_PATH[path];
    const ongoingBatches = yield* loadAnalyticsBatches(client, request, kinds, 'ONGOING');
    const snapshotBatches = yield* loadSnapshotBatches(client, request, kinds);
    return summarizeAnalyticsBatches([...ongoingBatches, ...snapshotBatches], {
      storeId: app.storeId,
      range,
    });
  });

const loadRatingStats = (
  client: EffectAppStoreConnectClient,
  request: AppStoreFetchRequest,
): Effect.Effect<readonly DailyStat[], unknown> =>
  Effect.gen(function* () {
    const customerReviews = yield* client.listCustomerReviews(request.app.storeId);
    const ratedReviews = customerReviews.flatMap((customerReview): ReviewDatum[] => {
      const starRating = pickStarRating(customerReview.rating);
      if (starRating === null) return [];
      return [{ store: 'appstore', rating: starRating, answered: customerReview.answered }];
    });
    const ratingSummary = summarizeRatings(ratedReviews);
    const isThereNoRating = ratingSummary.total === 0;
    if (isThereNoRating) return [];
    const date = request.range.to;
    return [
      {
        date,
        feed: 'app-store',
        metric: 'ratingAverage',
        value: ratingSummary.average,
        currency: null,
      },
      {
        date,
        feed: 'app-store',
        metric: 'ratingCount',
        value: ratingSummary.total,
        currency: null,
      },
    ];
  });

interface AppStoreLoad {
  readonly salesStats: readonly DailyStat[];
  readonly analyticsSummary: AnalyticsSummary;
  readonly ratingStats: readonly DailyStat[];
}

/** The stats of every source become one reply; no analytics yet keeps the stats but leaves the days uncovered. */
export const createAppStoreReply = (
  load: AppStoreLoad,
  request: AppStoreFetchRequest,
): FeedFetchReply => {
  const { analyticsSummary } = load;
  const { app, range } = request;
  const latestDate = analyticsSummary.latestDate;
  const stats = [...load.salesStats, ...analyticsSummary.stats, ...load.ratingStats];
  if (latestDate !== null) {
    return { status: 'fetched', stats, coveredThrough: latestDate, notes: [] };
  }
  const isThereNoStatToKeep = stats.length === 0;
  if (isThereNoStatToKeep) {
    return { status: 'skipped', reason: createPreparingReason(app.name) };
  }
  return {
    status: 'fetched',
    stats,
    coveredThrough: shiftDate(range.from, -1),
    notes: [createPreparingReason(app.name)],
  };
};

const loadKnownVendorSales = (
  client: EffectAppStoreConnectClient,
  vendorNumber: string | null,
  request: AppStoreFetchRequest,
): Effect.Effect<readonly DailyStat[], unknown> => {
  if (vendorNumber === null) return Effect.succeed([]);
  return loadSalesStats(client, vendorNumber, request);
};

const loadAppStoreStats = (
  client: EffectAppStoreConnectClient,
  vendorNumber: string | null,
  request: AppStoreFetchRequest,
): Effect.Effect<FeedFetchReply, unknown> =>
  Effect.gen(function* () {
    const path = pickStatsPath(vendorNumber);
    const salesStats = yield* loadKnownVendorSales(client, vendorNumber, request);
    const analyticsSummary = yield* loadAnalyticsSummary(client, request, path);
    const ratingStats = yield* loadRatingStats(client, request);
    return createAppStoreReply({ salesStats, analyticsSummary, ratingStats }, request);
  });

const createFeedFailure = (app: PortfolioApp, cause: unknown): StatsFeedFailure =>
  makeStatsFeedFailure({
    feed: 'app-store',
    appKey: app.key,
    message: errorMessage(cause),
    cause,
  });

const fetchAppStoreDays: StatsFeedPlugin['fetchDays'] = (request) =>
  Effect.gen(function* () {
    const { app, credentials } = request;
    const accountKeyId = app.accountKeyId;
    if (accountKeyId === null) {
      return {
        status: 'skipped',
        reason: `${app.name} has no App Store Connect account`,
      } satisfies FeedFetchReply;
    }
    const client = yield* credentials.ascClientForAccount(accountKeyId);
    if (client === null) {
      return {
        status: 'skipped',
        reason: `No saved App Store Connect key for account ${app.accountLabel}`,
      } satisfies FeedFetchReply;
    }
    const vendorNumber = yield* credentials.vendorNumberForAccount(accountKeyId);
    const loadOutcome = yield* loadAppStoreStats(client, vendorNumber, request).pipe(Effect.either);
    if (loadOutcome._tag === 'Right') return loadOutcome.right;
    const isKeyLackingRole = readHttpStatus(loadOutcome.left) === FORBIDDEN_STATUS;
    if (isKeyLackingRole) {
      return {
        status: 'skipped',
        reason: createForbiddenReason(app.accountLabel),
      } satisfies FeedFetchReply;
    }
    return yield* Effect.fail(loadOutcome.left);
  }).pipe(Effect.mapError((failure) => createFeedFailure(request.app, failure)));

export const appStoreFeed: StatsFeedPlugin = {
  feed: 'app-store',
  isApplicable: (app) => app.platform === 'ios',
  fetchDays: fetchAppStoreDays,
};
