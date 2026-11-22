import { gunzipSync } from 'node:zlib';
import type {
  AnalyticsReportInstanceResource,
  AnalyticsReportRequestResource,
  AnalyticsReportResource,
  AnalyticsReportSegmentResource,
} from '../../types/apple-catalog.ts';
import { appRecordNotFound } from '../shared/reconcile.ts';
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

type ReportDateFailure = Readonly<{
  readonly _tag: 'ReportDateFailure';
  readonly message: string;
}>;

function makeReportDateFailure(message: string): ReportDateFailure {
  return { _tag: 'ReportDateFailure', message };
}

/**
 * Parse a strict `YYYY-MM-DD` into a UTC timestamp, rejecting both a malformed format and an
 * out-of-range calendar date. `Date.parse`/`Date.UTC` silently *normalize* an overflow (e.g.
 * `2026-06-31` -> July 1), which would download the wrong day; the round-trip check below catches that
 * and fails loudly instead.
 */
function parseYmd(date: string): number {
  // Four-digit year, two-digit month, two-digit day, nothing else.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const isFormatWrong = match == null;

  if (isFormatWrong) {
    throw makeReportDateFailure(`Invalid date "${date}" (use YYYY-MM-DD).`);
  }

  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  const isYearMissing = yearText == null;

  if (isYearMissing) {
    throw makeReportDateFailure(`Invalid date "${date}" (use YYYY-MM-DD).`);
  }

  const isMonthMissing = monthText == null;

  if (isMonthMissing) {
    throw makeReportDateFailure(`Invalid date "${date}" (use YYYY-MM-DD).`);
  }

  const isDayMissing = dayText == null;

  if (isDayMissing) {
    throw makeReportDateFailure(`Invalid date "${date}" (use YYYY-MM-DD).`);
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  const isYearWrong = back.getUTCFullYear() !== year;

  if (isYearWrong) {
    throw makeReportDateFailure(`Invalid calendar date "${date}".`);
  }

  const isMonthWrong = back.getUTCMonth() !== month - 1;

  if (isMonthWrong) {
    throw makeReportDateFailure(`Invalid calendar date "${date}".`);
  }

  const isDayWrong = back.getUTCDate() !== day;

  if (isDayWrong) {
    throw makeReportDateFailure(`Invalid calendar date "${date}".`);
  }

  return ms;
}

/**
 * Every calendar date from `from` to `to` inclusive as `YYYY-MM-DD`, for downloading a span of DAILY
 * reports in one command. Pure UTC arithmetic, so it's deterministic regardless of host timezone.
 * Throws on a malformed/out-of-range bound or an inverted range, so a typo fails loudly rather than
 * looping or silently doing nothing.
 */
export function eachDate(from: string, to: string): string[] {
  const start = parseYmd(from);
  const end = parseYmd(to);
  const isRangeInverted = end < start;

  if (isRangeInverted) {
    throw makeReportDateFailure(`Date range end ${to} is before start ${from}.`);
  }

  const dates: string[] = [];

  for (let day = start; day <= end; day += DAY_MS) {
    dates.push(new Date(day).toISOString().slice(0, 10));
  }

  return dates;
}

/** The exact slice of {@link AppStoreConnectClient} the analytics walk depends on. */
export type AscReportsApi = {
  getAppId(bundleId: string): Promise<string | null>;
  listAnalyticsReportRequests(
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource[]>;
  createAnalyticsReportRequest(
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource>;
  listAnalyticsReports(
    requestId: string,
    filters: {
      category?: string;
      name?: string;
    },
  ): Promise<AnalyticsReportResource[]>;
  listAnalyticsReportInstances(
    reportId: string,
    filters: {
      granularity?: string;
      processingDate?: string;
    },
  ): Promise<AnalyticsReportInstanceResource[]>;
  listAnalyticsReportSegments(instanceId: string): Promise<AnalyticsReportSegmentResource[]>;
};
/** Result of {@link ensureAnalyticsRequest}: the request to use and whether this call created it. */
type EnsuredRequest = {
  request: AnalyticsReportRequestResource;
  created: boolean;
};

function isUsableRequest(analyticsRequest: AnalyticsReportRequestResource): boolean {
  const isStopped = analyticsRequest.stoppedDueToInactivity == true;
  return isStopped == false;
}

/**
 * Find a usable analytics report request for an app, creating one if none exists. Reuses the first
 * request that Apple hasn't stopped for inactivity, so re-runs are idempotent and don't pile up
 * duplicate ONGOING requests.
 */
export async function ensureAnalyticsRequest(
  api: AscReportsApi,
  appId: string,
  accessType: string,
): Promise<EnsuredRequest> {
  const existingRequests = await api.listAnalyticsReportRequests(appId, accessType);
  const usableRequest = existingRequests.find(isUsableRequest);
  const hasUsableRequest = usableRequest !== undefined;

  if (hasUsableRequest) {
    return { request: usableRequest, created: false };
  }

  const createdRequest = await api.createAnalyticsReportRequest(appId, accessType);
  return { request: createdRequest, created: true };
}

/** What to pull: the app, the access type, and the report/instance filters. */
type AnalyticsQuery = {
  bundleId: string;
  accessType: string;
  category?: string;
  name?: string;
  granularity: string;
  processingDate?: string;
};
/** One downloadable analytics segment, flattened with the report/instance context for naming the output. */
type SegmentDownload = {
  reportName: string;
  category: string;
  granularity: string;
  processingDate: string;
  url: string;
  checksum?: string;
};
/** The outcome of {@link collectAnalyticsSegments}: the segment descriptors plus first-run context. */
type AnalyticsCollection = {
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
export async function collectAnalyticsSegments(
  api: AscReportsApi,
  query: AnalyticsQuery,
): Promise<AnalyticsCollection> {
  const appId = await api.getAppId(query.bundleId);
  const isAppMissing = appId == null;

  if (isAppMissing) {
    throw appRecordNotFound(query.bundleId);
  }

  const ensuredRequest = await ensureAnalyticsRequest(api, appId, query.accessType);
  const reportFilters: { category?: string; name?: string } = {};
  if (query.category !== undefined) reportFilters.category = query.category;
  if (query.name !== undefined) reportFilters.name = query.name;
  const analyticsReports = await api.listAnalyticsReports(ensuredRequest.request.id, reportFilters);
  const segmentDownloads: SegmentDownload[] = [];

  for (const analyticsReport of analyticsReports) {
    const instanceFilters: { granularity?: string; processingDate?: string } = {
      granularity: query.granularity,
    };
    if (query.processingDate !== undefined) {
      instanceFilters.processingDate = query.processingDate;
    }
    const reportInstances = await api.listAnalyticsReportInstances(
      analyticsReport.id,
      instanceFilters,
    );

    for (const reportInstance of reportInstances) {
      const reportSegments = await api.listAnalyticsReportSegments(reportInstance.id);

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
}
