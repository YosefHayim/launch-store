import {
  auth as playReportingAuth,
  playdeveloperreporting,
  type playdeveloperreporting_v1beta1,
} from '@googleapis/playdeveloperreporting';
import type { ServiceAccount } from '../types/credentials.ts';
import type {
  PlayVitalsMetric,
  PlayVitalsRow,
  VitalsTimeline,
  VitalsWindow,
} from '../types/vitals.ts';
import type { MutableDeep } from '../types/mutable.ts';
import { describePlayErrors, nonEmptyPageToken, serviceAccountJwtOptions } from './play-client.ts';
/**
 * The metric set behind each vital: its API resource segment and the three metrics Launch reads.
 * `rate`/`userPerceivedRate` are the headline + foreground-only figures; `distinctUsers` is the
 * denominator. Keyed by {@link PlayVitalsMetric} so the query path and normalization stay table-driven.
 */
const METRIC_SETS: Record<
  PlayVitalsMetric,
  {
    resource: string;
    rate: string;
    userPerceivedRate: string;
    distinctUsers: string;
  }
> = {
  crash: {
    resource: 'crashRateMetricSet',
    rate: 'crashRate',
    userPerceivedRate: 'userPerceivedCrashRate',
    distinctUsers: 'distinctUsers',
  },
  anr: {
    resource: 'anrRateMetricSet',
    rate: 'anrRate',
    userPerceivedRate: 'userPerceivedAnrRate',
    distinctUsers: 'distinctUsers',
  },
};
/** UTC day-shift of an ISO `YYYY-MM-DD` date by `delta` days (negative = earlier), returned as ISO. */
function shiftIsoDate(iso: string, delta: number): string {
  const { year, month, day } = isoToDateParts(iso);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return shifted.toISOString().slice(0, 10);
}
/**
 * DAILY query window of `days` inclusive days ending at `latestDate` (metric-set freshness from `:get`).
 * Falls back to ending today when freshness is unknown - the API clamps an over-reaching end.
 */
export function vitalsWindowFromLatestDate(latestDate: string | null, days: number): VitalsWindow {
  let endDate = new Date().toISOString().slice(0, 10);
  if (latestDate != null) endDate = latestDate;
  return { startDate: shiftIsoDate(endDate, -(days - 1)), endDate };
}
/** Render a Google `DateTime`'s date part as ISO `YYYY-MM-DD`, or undefined when the date is incomplete. */
function dateTimeToIso(
  date: playdeveloperreporting_v1beta1.Schema$GoogleTypeDateTime | undefined,
): string | undefined {
  if (date == null) return;
  if (typeof date.year != 'number') return;
  if (typeof date.month != 'number') return;
  if (typeof date.day != 'number') return;
  function pad(n: number): string {
    return String(n).padStart(2, '0');
  }
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}
/** Split an ISO `YYYY-MM-DD` string into the `{ year, month, day }` the API's `timelineSpec` wants. */
function isoToDateParts(iso: string): {
  year: number;
  month: number;
  day: number;
} {
  const dateSegments = iso.split('-').map(Number);
  let year = 0;
  let month = 0;
  let day = 0;
  if (typeof dateSegments[0] == 'number') year = dateSegments[0];
  if (typeof dateSegments[1] == 'number') month = dateSegments[1];
  if (typeof dateSegments[2] == 'number') day = dateSegments[2];
  return { year, month, day };
}
/** Parse a metric's string value to a number, or undefined when the column is absent/unparseable. */
function metricNumber(
  metricEntry: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1MetricsRow,
  name: string,
): number | undefined {
  function findMetric(
    metric: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1MetricValue,
  ) {
    return metric.metric == name;
  }

  const encodedValue = metricEntry.metrics?.find(findMetric)?.decimalValue?.value;
  if (typeof encodedValue != 'string') return;
  const metricValue = Number(encodedValue);
  if (Number.isNaN(metricValue)) return;
  return metricValue;
}
function isListed<Row>(candidate: readonly Row[] | null | undefined): candidate is readonly Row[] {
  return Array.isArray(candidate);
}

/** A generated Play Developer Reporting request failed. */
type PlayReportingApiError = Readonly<{
  readonly _tag: 'PlayReportingApiError';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
function makePlayReportingApiError(fields: {
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}): PlayReportingApiError {
  return {
    _tag: 'PlayReportingApiError',
    operation: fields.operation,
    message: fields.message,
    cause: fields.cause,
  };
}
const PLAY_APPS_PAGE_SIZE = 1000;
export type PlayReportingApp = Readonly<{ packageName: string; displayName: string }>;
function createAppsSearchRequest(
  pageToken: string | undefined,
): playdeveloperreporting_v1beta1.Params$Resource$Apps$Search {
  const isFirstPage = pageToken == null;
  if (isFirstPage) return { pageSize: PLAY_APPS_PAGE_SIZE };
  return { pageSize: PLAY_APPS_PAGE_SIZE, pageToken };
}

function readDisplayName(
  googleApp: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1App,
  packageName: string,
): string {
  const displayName = googleApp.displayName;
  const hasDisplayName = typeof displayName == 'string';
  if (hasDisplayName) return displayName;
  return packageName;
}

function listReadableApps(
  googleApps: readonly playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1App[],
): PlayReportingApp[] {
  const readableApps: PlayReportingApp[] = [];
  for (const googleApp of googleApps) {
    const packageName = googleApp.packageName;
    const hasPackageName = typeof packageName == 'string';
    if (!hasPackageName) continue;
    const displayName = readDisplayName(googleApp, packageName);
    readableApps.push({ packageName, displayName: displayName });
  }
  return readableApps;
}

export type PlayReportingTransport = {
  readonly apps: Pick<playdeveloperreporting_v1beta1.Resource$Apps, 'search'>;
  readonly vitals: {
    readonly crashrate: Pick<
      playdeveloperreporting_v1beta1.Resource$Vitals$Crashrate,
      'get' | 'query'
    >;
    readonly anrrate: Pick<playdeveloperreporting_v1beta1.Resource$Vitals$Anrrate, 'get' | 'query'>;
  };
};
/** Client for the Play Developer Reporting API, bound to one service account. */
export class PlayReportingClient {
  /** Official generated Play Developer Reporting v1beta1 transport. */
  private readonly reporting: PlayReportingTransport;
  /**
   * Bind the adapter to one service account.
   *
   * @param account - Validated Google service-account credentials.
   * @param generatedReporting - Optional generated transport supplied by adapter tests.
   */
  constructor(account: ServiceAccount, generatedReporting?: PlayReportingTransport) {
    if (generatedReporting != null) {
      this.reporting = generatedReporting;
      return;
    }
    const serviceAccountJwt = serviceAccountJwtOptions(account, [
      'https://www.googleapis.com/auth/playdeveloperreporting',
    ]);
    const googleAuthentication = new playReportingAuth.JWT(serviceAccountJwt);
    this.reporting = playdeveloperreporting({
      version: 'v1beta1',
      auth: googleAuthentication,
    });
  }
  /** Run one generated Play Developer Reporting request and tag a failure. */
  private async executeGeneratedRequest<GoogleShape>(
    operation: string,
    invoke: () => PromiseLike<{
      data: GoogleShape;
    }>,
  ): Promise<GoogleShape> {
    try {
      const completedRequest = await invoke();
      return completedRequest.data;
    } catch (cause) {
      let failureText = String(cause);
      const isError = cause instanceof Error;

      if (isError) {
        failureText = cause.message;
      }

      const playErrors = describePlayErrors(failureText);
      throw makePlayReportingApiError({
        operation,
        message: `Play Developer Reporting ${operation} failed: ${playErrors}`,
        cause,
      });
    }
  }
  async listApps(): Promise<PlayReportingApp[]> {
    const apps: PlayReportingApp[] = [];
    let pageToken: string | undefined;

    do {
      const searchRequest = createAppsSearchRequest(pageToken);
      const appsPage = await this.executeGeneratedRequest('search accessible apps', () =>
        this.reporting.apps.search(searchRequest),
      );
      const googleApps = appsPage.apps;
      const hasGoogleApps = Array.isArray(googleApps);

      if (hasGoogleApps) {
        const readableApps = listReadableApps(googleApps);
        apps.push(...readableApps);
      }

      pageToken = nonEmptyPageToken(appsPage.nextPageToken);
    } while (pageToken != null);

    return apps;
  }
  /**
   * Read the latest DAILY day Google has finished aggregating for a metric set, as ISO `YYYY-MM-DD`,
   * or null when no freshness is published yet (a brand-new app). Used to bound the default query
   * window so a request never reaches past available data.
   */
  async latestDailyDate(packageName: string, metric: PlayVitalsMetric): Promise<string | null> {
    const { resource } = METRIC_SETS[metric];
    const name = `apps/${packageName}/${resource}`;
    let metricSet:
      | playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1CrashRateMetricSet
      | playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1AnrRateMetricSet;

    switch (metric) {
      case 'crash':
        metricSet = await this.executeGeneratedRequest('get crash-rate freshness', () =>
          this.reporting.vitals.crashrate.get({ name }),
        );
        break;
      case 'anr':
        metricSet = await this.executeGeneratedRequest('get ANR-rate freshness', () =>
          this.reporting.vitals.anrrate.get({ name }),
        );
        break;
    }
    function findFreshness(
      freshness: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1FreshnessInfoFreshness,
    ) {
      return freshness.aggregationPeriod == 'DAILY';
    }

    const dailyFreshness = metricSet.freshnessInfo?.freshnesses?.find(findFreshness);
    const latestDate = dateTimeToIso(dailyFreshness?.latestEndTime);

    if (latestDate != null) {
      return latestDate;
    }

    return null;
  }
  /**
   * Fetch one vital's full DAILY timeline: bound the window by the metric set's freshness (via `:get`,
   * so the request never reaches past available data), then query + normalize. This is the single
   * call `launch-store play-reports vitals` makes per metric - the freshness->window->query orchestration that
   * belongs in the client, not the CLI.
   */
  async vitalsTimeline(
    packageName: string,
    metric: PlayVitalsMetric,
    days: number,
  ): Promise<VitalsTimeline> {
    const latestDate = await this.latestDailyDate(packageName, metric);
    const window = vitalsWindowFromLatestDate(latestDate, days);
    const rows = await this.queryVitals(metric, packageName, window);
    return { metric, window, rows };
  }
  /** Query the crash-rate metric set over a DAILY window, returning normalized rows. */
  async queryCrashRate(packageName: string, window: VitalsWindow): Promise<PlayVitalsRow[]> {
    return this.queryVitals('crash', packageName, window);
  }
  /** Query the ANR-rate metric set over a DAILY window, returning normalized rows. */
  async queryAnrRate(packageName: string, window: VitalsWindow): Promise<PlayVitalsRow[]> {
    return this.queryVitals('anr', packageName, window);
  }
  /**
   * Query one metric set over a DAILY window and normalize every row, paging through Google's
   * `nextPageToken` in full. No dimensions are requested, so each row is one day aggregated across
   * the whole user base - the headline timeline `launch-store play-reports vitals` shows.
   */
  private async queryVitals(
    metric: PlayVitalsMetric,
    packageName: string,
    window: VitalsWindow,
  ): Promise<PlayVitalsRow[]> {
    const metricSet = METRIC_SETS[metric];
    const entries: PlayVitalsRow[] = [];
    let pageToken: string | undefined;

    do {
      const queryRequest: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryCrashRateMetricSetRequest =
        {
          timelineSpec: {
            aggregationPeriod: 'DAILY',
            startTime: isoToDateParts(window.startDate),
            endTime: isoToDateParts(window.endDate),
          },
          metrics: [metricSet.rate, metricSet.userPerceivedRate, metricSet.distinctUsers],
        };
      if (pageToken != null) {
        queryRequest.pageToken = pageToken;
      }

      const name = `apps/${packageName}/${metricSet.resource}`;
      let metricPage:
        | playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryCrashRateMetricSetResponse
        | playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryAnrRateMetricSetResponse;

      switch (metric) {
        case 'crash':
          metricPage = await this.executeGeneratedRequest('query crash-rate timeline', () =>
            this.reporting.vitals.crashrate.query({ name, requestBody: queryRequest }),
          );
          break;
        case 'anr':
          metricPage = await this.executeGeneratedRequest('query ANR-rate timeline', () =>
            this.reporting.vitals.anrrate.query({ name, requestBody: queryRequest }),
          );
          break;
      }

      const metricRows = metricPage.rows;

      if (isListed(metricRows)) {
        for (const metricEntry of metricRows) {
          const date = dateTimeToIso(metricEntry.startTime);

          if (date != null) {
            const normalized: MutableDeep<PlayVitalsRow> = { metric, date };
            const rate = metricNumber(metricEntry, metricSet.rate);

            if (typeof rate == 'number') {
              normalized.rate = rate;
            }

            const userPerceivedRate = metricNumber(metricEntry, metricSet.userPerceivedRate);

            if (typeof userPerceivedRate == 'number') {
              normalized.userPerceivedRate = userPerceivedRate;
            }

            const distinctUsers = metricNumber(metricEntry, metricSet.distinctUsers);

            if (typeof distinctUsers == 'number') {
              normalized.distinctUsers = distinctUsers;
            }

            entries.push(normalized);
          }
        }
      }

      pageToken = nonEmptyPageToken(metricPage.nextPageToken);
    } while (pageToken != null);
    function sortLeftPiece(
      leftEntry: {
        readonly metric: PlayVitalsMetric;
        readonly date: string;
        readonly rate?: number;
        readonly userPerceivedRate?: number;
        readonly distinctUsers?: number;
      },
      rightEntry: {
        readonly metric: PlayVitalsMetric;
        readonly date: string;
        readonly rate?: number;
        readonly userPerceivedRate?: number;
        readonly distinctUsers?: number;
      },
    ) {
      return leftEntry.date.localeCompare(rightEntry.date);
    }

    entries.sort(sortLeftPiece);
    return entries;
  }
}
