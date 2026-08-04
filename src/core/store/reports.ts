import { gunzipSync } from 'node:zlib';
import type {
  AnalyticsReportInstanceResource,
  AnalyticsReportRequestResource,
  AnalyticsReportResource,
  AnalyticsReportSegmentResource,
} from '../types/appleCatalog.js';
import { Data, Effect } from 'effect';
import { appRecordNotFound } from './reconcile.js';
/** Decompress an Apple report to UTF-8 text. */
export const decompressReport = (bytes: Buffer): string => {
  return gunzipSync(bytes).toString('utf8');
};
/** A parsed tab-separated report. */
export type ParsedReport = {
  headers: string[];
  rows: Record<string, string>[];
};
/** Parse an Apple tab-separated report, filling missing cells with empty text. */
export const parseTsv = (text: string): ParsedReport => {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0);
  const headerLine = lines.shift();
  if (!headerLine) return { headers: [], rows: [] };
  const headers = headerLine.split('\t');
  const rows = lines.map((line) => {
    const cells = line.split('\t');
    const reportFields: Record<string, string> = {};
    headers.forEach((header, index) => {
      let cellText = '';
      if (cells[index] !== undefined) cellText = cells[index];
      reportFields[header] = cellText;
    });
    return reportFields;
  });
  return { headers, rows };
};
/** Milliseconds in a day - the step for {@link eachDate}'s UTC walk. */
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReportDateFailure = Readonly<{
  readonly _tag: 'ReportDateFailure';
  readonly message: string;
}>;

export const makeReportDateFailure = Data.tagged<ReportDateFailure>('ReportDateFailure');
/**
 * Parse a strict `YYYY-MM-DD` into a UTC timestamp, rejecting both a malformed format and an
 * out-of-range calendar date. `Date.parse`/`Date.UTC` silently *normalize* an overflow (e.g.
 * `2026-06-31` -> July 1), which would download the wrong day; the round-trip check below catches that
 * and fails loudly instead.
 */
const parseYmd = (date: string): Effect.Effect<number, ReportDateFailure> => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    return Effect.fail(
      makeReportDateFailure({ message: `Invalid date "${date}" (use YYYY-MM-DD).` }),
    );
  }
  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  if (yearText === undefined) {
    return Effect.fail(
      makeReportDateFailure({ message: `Invalid date "${date}" (use YYYY-MM-DD).` }),
    );
  }
  if (monthText === undefined) {
    return Effect.fail(
      makeReportDateFailure({ message: `Invalid date "${date}" (use YYYY-MM-DD).` }),
    );
  }
  if (dayText === undefined) {
    return Effect.fail(
      makeReportDateFailure({ message: `Invalid date "${date}" (use YYYY-MM-DD).` }),
    );
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== year) {
    return Effect.fail(makeReportDateFailure({ message: `Invalid calendar date "${date}".` }));
  }
  if (back.getUTCMonth() !== month - 1) {
    return Effect.fail(makeReportDateFailure({ message: `Invalid calendar date "${date}".` }));
  }
  if (back.getUTCDate() !== day) {
    return Effect.fail(makeReportDateFailure({ message: `Invalid calendar date "${date}".` }));
  }
  return Effect.succeed(ms);
};
/**
 * Every calendar date from `from` to `to` inclusive as `YYYY-MM-DD`, for downloading a span of DAILY
 * reports in one command. Pure UTC arithmetic, so it's deterministic regardless of host timezone.
 * Throws on a malformed/out-of-range bound or an inverted range, so a typo fails loudly rather than
 * looping or silently doing nothing.
 */
export const eachDate = (from: string, to: string): Effect.Effect<string[], ReportDateFailure> =>
  Effect.gen(function* () {
    const start = yield* parseYmd(from);
    const end = yield* parseYmd(to);
    if (end < start) {
      return yield* Effect.fail(
        makeReportDateFailure({ message: `Date range end ${to} is before start ${from}.` }),
      );
    }
    const dates: string[] = [];
    for (let day = start; day <= end; day += DAY_MS) {
      dates.push(new Date(day).toISOString().slice(0, 10));
    }
    return dates;
  });
/** The exact slice of {@link AppStoreConnectClient} the analytics walk depends on. */
export type AscReportsApi = {
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  listAnalyticsReportRequests(
    appId: string,
    accessType: string,
  ): Effect.Effect<AnalyticsReportRequestResource[], unknown>;
  createAnalyticsReportRequest(
    appId: string,
    accessType: string,
  ): Effect.Effect<AnalyticsReportRequestResource, unknown>;
  listAnalyticsReports(
    requestId: string,
    filters: {
      category?: string;
      name?: string;
    },
  ): Effect.Effect<AnalyticsReportResource[], unknown>;
  listAnalyticsReportInstances(
    reportId: string,
    filters: {
      granularity?: string;
      processingDate?: string;
    },
  ): Effect.Effect<AnalyticsReportInstanceResource[], unknown>;
  listAnalyticsReportSegments(
    instanceId: string,
  ): Effect.Effect<AnalyticsReportSegmentResource[], unknown>;
};
/** Result of {@link ensureAnalyticsRequest}: the request to use and whether this call created it. */
export type EnsuredRequest = {
  request: AnalyticsReportRequestResource;
  created: boolean;
};
/**
 * Find a usable analytics report request for an app, creating one if none exists. Reuses the first
 * request that Apple hasn't stopped for inactivity, so re-runs are idempotent and don't pile up
 * duplicate ONGOING requests.
 */
export const ensureAnalyticsRequest = (
  api: AscReportsApi,
  appId: string,
  accessType: string,
): Effect.Effect<EnsuredRequest, unknown> =>
  Effect.gen(function* () {
    const existingRequests = yield* api.listAnalyticsReportRequests(appId, accessType);
    const usableRequest = existingRequests.find(
      (analyticsRequest) => !analyticsRequest.stoppedDueToInactivity,
    );
    if (usableRequest !== undefined) return { request: usableRequest, created: false };
    const createdRequest = yield* api.createAnalyticsReportRequest(appId, accessType);
    return { request: createdRequest, created: true };
  });
/** What to pull: the app, the access type, and the report/instance filters. */
export type AnalyticsQuery = {
  bundleId: string;
  accessType: string;
  category?: string;
  name?: string;
  granularity: string;
  processingDate?: string;
};
/** One downloadable analytics segment, flattened with the report/instance context for naming the output. */
export type SegmentDownload = {
  reportName: string;
  category: string;
  granularity: string;
  processingDate: string;
  url: string;
  checksum?: string;
};
/** The outcome of {@link collectAnalyticsSegments}: the segment descriptors plus first-run context. */
export type AnalyticsCollection = {
  requestCreated: boolean;
  reportCount: number;
  downloads: SegmentDownload[];
};
/**
 * Walk the analytics resource chain (request -> reports -> instances -> segments) and return every
 * matching segment to download, flattened with the context needed to name each output file. The
 * caller downloads + writes the segments; this function does no I/O beyond the API reads, so the walk
 * is unit-testable with a fake {@link AscReportsApi}.
 */
export const collectAnalyticsSegments = (
  api: AscReportsApi,
  query: AnalyticsQuery,
): Effect.Effect<AnalyticsCollection, unknown> =>
  Effect.gen(function* () {
    const appId = yield* api.getAppId(query.bundleId);
    if (appId === null) return yield* Effect.fail(appRecordNotFound(query.bundleId));
    const ensuredRequest = yield* ensureAnalyticsRequest(api, appId, query.accessType);
    const reportFilters: { category?: string; name?: string } = {};
    if (query.category !== undefined) reportFilters.category = query.category;
    if (query.name !== undefined) reportFilters.name = query.name;
    const analyticsReports = yield* api.listAnalyticsReports(
      ensuredRequest.request.id,
      reportFilters,
    );
    const segmentDownloads: SegmentDownload[] = [];
    for (const analyticsReport of analyticsReports) {
      const instanceFilters: { granularity?: string; processingDate?: string } = {
        granularity: query.granularity,
      };
      if (query.processingDate !== undefined) {
        instanceFilters.processingDate = query.processingDate;
      }
      const reportInstances = yield* api.listAnalyticsReportInstances(
        analyticsReport.id,
        instanceFilters,
      );
      for (const reportInstance of reportInstances) {
        const reportSegments = yield* api.listAnalyticsReportSegments(reportInstance.id);
        for (const reportSegment of reportSegments) {
          let category = '';
          if (analyticsReport.category !== undefined) category = analyticsReport.category;
          let processingDate = '';
          if (reportInstance.processingDate !== undefined) {
            processingDate = reportInstance.processingDate;
          }
          const segmentDownload: SegmentDownload = {
            reportName: analyticsReport.name,
            category,
            granularity: reportInstance.granularity,
            processingDate,
            url: reportSegment.url,
          };
          if (reportSegment.checksum !== undefined) {
            segmentDownload.checksum = reportSegment.checksum;
          }
          segmentDownloads.push(segmentDownload);
        }
      }
    }
    return {
      requestCreated: ensuredRequest.created,
      reportCount: analyticsReports.length,
      downloads: segmentDownloads,
    };
  });
