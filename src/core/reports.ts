/**
 * The `launch reports` domain: pull Sales & Trends, Finance, and Analytics reports from App Store
 * Connect with the API key alone — the bulk-data side of EAS's missing surface.
 *
 * Two report families, two shapes:
 * - **Sales & Finance** are a single authenticated GET that returns a gzipped, tab-delimited file.
 *   The client hands back raw bytes; {@link decompressReport} + {@link parseTsv} turn them into rows.
 *   These are pure functions so the (fiddly) decompression and TSV handling are unit-tested without a
 *   network or an account.
 * - **Analytics** is a multi-step resource walk: ensure a report *request* exists for the app, list its
 *   reports (optionally by category/name), then each report's time-period instances, then each
 *   instance's downloadable segments. {@link collectAnalyticsSegments} performs that walk and returns
 *   segment descriptors; the command downloads + writes them. A freshly *created* request has no data
 *   yet (Apple generates it over ~1–2 days), surfaced via {@link AnalyticsCollection.requestCreated} so
 *   the command tells the user to re-run later instead of reporting an empty result as a failure.
 *
 * The {@link AscReportsApi} slice mirrors `core/ascSync.ts`'s `AscCatalogApi`: it names the exact client
 * surface the analytics walk needs, so the flow is testable with a fake and `AppStoreConnectClient`
 * satisfies it structurally.
 */

import { gunzipSync } from "node:zlib";
import type {
  AnalyticsReportInstanceResource,
  AnalyticsReportRequestResource,
  AnalyticsReportResource,
  AnalyticsReportSegmentResource,
} from "../apple/ascClient.js";
import { appRecordNotFound } from "./asc/storeSync.js";

/** Decompress a gzipped report body to its UTF-8 text (Apple delivers reports gzip-compressed). */
export function decompressReport(bytes: Buffer): string {
  return gunzipSync(bytes).toString("utf8");
}

/** A parsed tab-separated report: the header names and one object per data row keyed by header. */
export interface ParsedReport {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Parse a tab-separated report (Apple's sales/finance format) into a header list + row objects.
 * Tolerates `\r\n` line endings and a trailing blank line; a missing cell becomes `""` so every row
 * has every header. Returns empty when the text has no header line.
 */
export function parseTsv(text: string): ParsedReport {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0);
  const headerLine = lines.shift();
  if (!headerLine) return { headers: [], rows: [] };
  const headers = headerLine.split("\t");
  const rows = lines.map((line) => {
    const cells = line.split("\t");
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
  return { headers, rows };
}

/** Milliseconds in a day — the step for {@link eachDate}'s UTC walk. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a strict `YYYY-MM-DD` into a UTC timestamp, rejecting both a malformed format and an
 * out-of-range calendar date. `Date.parse`/`Date.UTC` silently *normalize* an overflow (e.g.
 * `2026-06-31` → July 1), which would download the wrong day; the round-trip check below catches that
 * and fails loudly instead.
 */
function parseYmd(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date "${date}" (use YYYY-MM-DD).`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    throw new Error(`Invalid calendar date "${date}".`);
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
  if (end < start) throw new Error(`Date range end ${to} is before start ${from}.`);
  const dates: string[] = [];
  for (let day = start; day <= end; day += DAY_MS) {
    dates.push(new Date(day).toISOString().slice(0, 10));
  }
  return dates;
}

/** The exact slice of {@link AppStoreConnectClient} the analytics walk depends on. */
export interface AscReportsApi {
  getAppId(bundleId: string): Promise<string | null>;
  listAnalyticsReportRequests(appId: string, accessType: string): Promise<AnalyticsReportRequestResource[]>;
  createAnalyticsReportRequest(appId: string, accessType: string): Promise<AnalyticsReportRequestResource>;
  listAnalyticsReports(
    requestId: string,
    filters: { category?: string; name?: string },
  ): Promise<AnalyticsReportResource[]>;
  listAnalyticsReportInstances(
    reportId: string,
    filters: { granularity?: string; processingDate?: string },
  ): Promise<AnalyticsReportInstanceResource[]>;
  listAnalyticsReportSegments(instanceId: string): Promise<AnalyticsReportSegmentResource[]>;
}

/** Result of {@link ensureAnalyticsRequest}: the request to use and whether this call created it. */
export interface EnsuredRequest {
  request: AnalyticsReportRequestResource;
  /** True when the request was just created — its report data isn't generated yet (~1–2 days). */
  created: boolean;
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
  const existing = await api.listAnalyticsReportRequests(appId, accessType);
  const usable = existing.find((request) => !request.stoppedDueToInactivity);
  if (usable) return { request: usable, created: false };
  const request = await api.createAnalyticsReportRequest(appId, accessType);
  return { request, created: true };
}

/** What to pull: the app, the access type, and the report/instance filters. */
export interface AnalyticsQuery {
  bundleId: string;
  /** `ONGOING` (recurring) or `ONE_TIME_SNAPSHOT` (one historical pull). */
  accessType: string;
  /** Narrow to one report category, e.g. `APP_USAGE`. */
  category?: string;
  /** Narrow to one report by exact name, e.g. `App Store Installations`. */
  name?: string;
  /** `DAILY` | `WEEKLY` | `MONTHLY`. */
  granularity: string;
  /** Limit to instances covering this date (`YYYY-MM-DD`); omit for all available instances. */
  processingDate?: string;
}

/** One downloadable analytics segment, flattened with the report/instance context for naming the output. */
export interface SegmentDownload {
  reportName: string;
  category: string;
  granularity: string;
  processingDate: string;
  url: string;
  checksum?: string;
}

/** The outcome of {@link collectAnalyticsSegments}: the segment descriptors plus first-run context. */
export interface AnalyticsCollection {
  /** True when the report request was just created (so no data exists yet — re-run in ~1–2 days). */
  requestCreated: boolean;
  /** How many reports matched the category/name filter, before instance/segment expansion. */
  reportCount: number;
  downloads: SegmentDownload[];
}

/**
 * Walk the analytics resource chain (request → reports → instances → segments) and return every
 * matching segment to download, flattened with the context needed to name each output file. The
 * caller downloads + writes the segments; this function does no I/O beyond the API reads, so the walk
 * is unit-testable with a fake {@link AscReportsApi}.
 */
export async function collectAnalyticsSegments(
  api: AscReportsApi,
  query: AnalyticsQuery,
): Promise<AnalyticsCollection> {
  const appId = await api.getAppId(query.bundleId);
  if (!appId) throw appRecordNotFound(query.bundleId);
  const { request, created } = await ensureAnalyticsRequest(api, appId, query.accessType);

  const reportFilters: { category?: string; name?: string } = {};
  if (query.category) reportFilters.category = query.category;
  if (query.name) reportFilters.name = query.name;
  const reports = await api.listAnalyticsReports(request.id, reportFilters);

  const downloads: SegmentDownload[] = [];
  for (const report of reports) {
    const instanceFilters: { granularity?: string; processingDate?: string } = { granularity: query.granularity };
    if (query.processingDate) instanceFilters.processingDate = query.processingDate;
    const instances = await api.listAnalyticsReportInstances(report.id, instanceFilters);
    for (const instance of instances) {
      const segments = await api.listAnalyticsReportSegments(instance.id);
      for (const segment of segments) {
        downloads.push({
          reportName: report.name,
          category: report.category ?? "",
          granularity: instance.granularity,
          processingDate: instance.processingDate ?? "",
          url: segment.url,
          ...(segment.checksum ? { checksum: segment.checksum } : {}),
        });
      }
    }
  }
  return { requestCreated: created, reportCount: reports.length, downloads };
}
