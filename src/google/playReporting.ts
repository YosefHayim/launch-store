/**
 * Play Developer Reporting API client — Android quality vitals (crash rate, ANR rate) for
 * `launch play-reports vitals`. The post-launch-observability twin of the App Store Connect reports
 * stack on the iOS side.
 *
 * This is a SEPARATE Google API from {@link GooglePlayClient} (the `androidpublisher` Play Developer
 * API). It lives at `playdeveloperreporting.googleapis.com`, needs its own OAuth scope
 * (`playdeveloperreporting`, not `androidpublisher`), and addresses apps as `apps/{packageName}`
 * rather than `applications/{packageName}`. It reuses the one piece both share — the JWT-bearer token
 * minting — via {@link ServiceAccountTokenSource}, constructed here with the reporting scope.
 *
 * The flagship metric sets each expose `:query` (a windowed timeline read) and `:get` (the metric
 * set's freshness). This client uses both: `:get` reports the latest day Google has finished
 * aggregating, which bounds the default `:query` window so we never ask for days that don't exist yet.
 *
 * @see https://developers.google.com/play/developer/reporting
 */

import { ServiceAccountTokenSource } from "./serviceAccountToken.js";
import { describePlayErrors, type ServiceAccount } from "./playClient.js";
import type { PlayVitalsMetric, PlayVitalsRow } from "../core/types.js";

const BASE_URL = "https://playdeveloperreporting.googleapis.com/v1beta1";
/** Distinct from the Play Developer API scope — the reporting API rejects an `androidpublisher` token. */
const OAUTH_SCOPE = "https://www.googleapis.com/auth/playdeveloperreporting";

/**
 * The metric set behind each vital: its API resource segment and the three metrics Launch reads.
 * `rate`/`userPerceivedRate` are the headline + foreground-only figures; `distinctUsers` is the
 * denominator. Keyed by {@link PlayVitalsMetric} so the query path and normalization stay table-driven.
 */
const METRIC_SETS: Record<
  PlayVitalsMetric,
  { resource: string; rate: string; userPerceivedRate: string; distinctUsers: string }
> = {
  crash: {
    resource: "crashRateMetricSet",
    rate: "crashRate",
    userPerceivedRate: "userPerceivedCrashRate",
    distinctUsers: "distinctUsers",
  },
  anr: {
    resource: "anrRateMetricSet",
    rate: "anrRate",
    userPerceivedRate: "userPerceivedAnrRate",
    distinctUsers: "distinctUsers",
  },
};

/**
 * Google's civil-time `DateTime` (a calendar date with optional wall-clock + offset). The reporting API
 * uses it for both row `startTime` and freshness `latestEndTime`. Launch only reads the date part.
 */
interface ApiDateTime {
  year?: number;
  month?: number;
  day?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

/** One metric column in a row: the metric name + its value (the API encodes the number as a string). */
interface ApiMetricValue {
  metric?: string;
  decimalValue?: { value?: string };
}

/** One row of a `:query` timeline: the day it covers plus the metric columns for that day. */
interface ApiMetricsRow {
  startTime?: ApiDateTime;
  metrics?: ApiMetricValue[];
}

/** The `:query` response: a page of timeline rows plus an optional continuation token. */
interface ApiQueryResponse {
  rows?: ApiMetricsRow[];
  nextPageToken?: string;
}

/** One freshness entry: the latest fully-aggregated day for a given aggregation period. */
interface ApiFreshness {
  aggregationPeriod?: string;
  latestEndTime?: ApiDateTime;
}

/** The `:get` response: a metric set's freshness summary (the latest available day per period). */
interface ApiMetricSetResource {
  freshnessInfo?: { freshnesses?: ApiFreshness[] };
}

/** A half-open day window for a vitals query, as ISO `YYYY-MM-DD` strings. */
export interface VitalsWindow {
  /** First day to include (inclusive), `YYYY-MM-DD`. */
  startDate: string;
  /** Last day to include (inclusive), `YYYY-MM-DD`. */
  endDate: string;
}

/**
 * One vital's resolved timeline: the metric, the window actually queried (after freshness bounding),
 * and its normalized daily rows. The result of {@link PlayReportingClient.vitalsTimeline} — the unit
 * the `play-reports vitals` command renders.
 */
export interface VitalsTimeline {
  metric: PlayVitalsMetric;
  window: VitalsWindow;
  rows: PlayVitalsRow[];
}

/** How many days of history the default vitals window spans, ending at the freshest available day. */
export const DEFAULT_VITALS_DAYS = 28;

/**
 * Upper bound on a requested window. Caps untrusted `--days` input so the date math stays well inside
 * `Date`'s representable range (a wild value would otherwise overflow `Date.UTC` → `Invalid Date`), and
 * keeps requests within the API's daily-metrics retention horizon.
 */
export const MAX_VITALS_DAYS = 365;

/** UTC day-shift of an ISO `YYYY-MM-DD` date by `delta` days (negative = earlier), returned as ISO. */
function shiftIsoDate(iso: string, delta: number): string {
  const { year, month, day } = isoToDateParts(iso);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Compute the DAILY window to query: `days` of history ending at `latestDate` (the metric set's freshest
 * day, from `:get`). Falls back to ending today when freshness is unknown — the API still clamps to what
 * it has, so an over-reaching end is harmless. Returns inclusive `startDate`/`endDate`.
 */
export function resolveVitalsWindow(latestDate: string | null, days = DEFAULT_VITALS_DAYS): VitalsWindow {
  const endDate = latestDate ?? new Date().toISOString().slice(0, 10);
  return { startDate: shiftIsoDate(endDate, -(days - 1)), endDate };
}

/** Render a Google `DateTime`'s date part as ISO `YYYY-MM-DD`, or undefined when the date is incomplete. */
function dateTimeToIso(date: ApiDateTime | undefined): string | undefined {
  if (!date?.year || !date.month || !date.day) return undefined;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** Split an ISO `YYYY-MM-DD` string into the `{ year, month, day }` the API's `timelineSpec` wants. */
function isoToDateParts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

/** Parse a metric's string value to a number, or undefined when the column is absent/unparseable. */
function metricNumber(row: ApiMetricsRow, name: string): number | undefined {
  const raw = row.metrics?.find((metric) => metric.metric === name)?.decimalValue?.value;
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isNaN(value) ? undefined : value;
}

/** Client for the Play Developer Reporting API, bound to one service account. */
export class PlayReportingClient {
  /** Token source pinned to the reporting scope (distinct from {@link GooglePlayClient}'s). */
  private readonly tokens: ServiceAccountTokenSource;

  constructor(account: ServiceAccount) {
    this.tokens = new ServiceAccountTokenSource(account, OAUTH_SCOPE);
  }

  /** Issue an authenticated request and parse the JSON body, surfacing Google's own error message. */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.tokens.token()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Play Developer Reporting ${method} ${path} failed (${response.status}): ${describePlayErrors(text)}`,
      );
    }
    return JSON.parse(text) as T;
  }

  /**
   * Read the latest DAILY day Google has finished aggregating for a metric set, as ISO `YYYY-MM-DD`,
   * or null when no freshness is published yet (a brand-new app). Used to bound the default query
   * window so a request never reaches past available data.
   */
  async latestDailyDate(packageName: string, metric: PlayVitalsMetric): Promise<string | null> {
    const { resource } = METRIC_SETS[metric];
    const set = await this.request<ApiMetricSetResource>("GET", `/apps/${encodeURIComponent(packageName)}/${resource}`);
    const daily = set.freshnessInfo?.freshnesses?.find((freshness) => freshness.aggregationPeriod === "DAILY");
    return dateTimeToIso(daily?.latestEndTime) ?? null;
  }

  /**
   * Fetch one vital's full DAILY timeline: bound the window by the metric set's freshness (via `:get`,
   * so the request never reaches past available data), then query + normalize. This is the single
   * call `launch play-reports vitals` makes per metric — the freshness→window→query orchestration that
   * belongs in the client, not the CLI.
   */
  async vitalsTimeline(
    packageName: string,
    metric: PlayVitalsMetric,
    days = DEFAULT_VITALS_DAYS,
  ): Promise<VitalsTimeline> {
    const window = resolveVitalsWindow(await this.latestDailyDate(packageName, metric), days);
    const rows =
      metric === "crash"
        ? await this.queryCrashRate(packageName, window)
        : await this.queryAnrRate(packageName, window);
    return { metric, window, rows };
  }

  /** Query the crash-rate metric set over a DAILY window, returning normalized rows. */
  async queryCrashRate(packageName: string, window: VitalsWindow): Promise<PlayVitalsRow[]> {
    return this.queryVitals("crash", packageName, window);
  }

  /** Query the ANR-rate metric set over a DAILY window, returning normalized rows. */
  async queryAnrRate(packageName: string, window: VitalsWindow): Promise<PlayVitalsRow[]> {
    return this.queryVitals("anr", packageName, window);
  }

  /**
   * Query one metric set over a DAILY window and normalize every row, paging through Google's
   * `nextPageToken` in full. No dimensions are requested, so each row is one day aggregated across
   * the whole user base — the headline timeline `launch play-reports vitals` shows.
   */
  private async queryVitals(
    metric: PlayVitalsMetric,
    packageName: string,
    window: VitalsWindow,
  ): Promise<PlayVitalsRow[]> {
    const set = METRIC_SETS[metric];
    const rows: PlayVitalsRow[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.request<ApiQueryResponse>(
        "POST",
        `/apps/${encodeURIComponent(packageName)}/${set.resource}:query`,
        {
          timelineSpec: {
            aggregationPeriod: "DAILY",
            startTime: isoToDateParts(window.startDate),
            endTime: isoToDateParts(window.endDate),
          },
          metrics: [set.rate, set.userPerceivedRate, set.distinctUsers],
          ...(pageToken ? { pageToken } : {}),
        },
      );
      for (const row of page.rows ?? []) {
        const date = dateTimeToIso(row.startTime);
        if (!date) continue;
        const normalized: PlayVitalsRow = { metric, date };
        const rate = metricNumber(row, set.rate);
        if (rate !== undefined) normalized.rate = rate;
        const userPerceivedRate = metricNumber(row, set.userPerceivedRate);
        if (userPerceivedRate !== undefined) normalized.userPerceivedRate = userPerceivedRate;
        const distinctUsers = metricNumber(row, set.distinctUsers);
        if (distinctUsers !== undefined) normalized.distinctUsers = distinctUsers;
        rows.push(normalized);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  }
}
