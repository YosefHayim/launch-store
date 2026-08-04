import {
  auth as playReportingAuth,
  playdeveloperreporting,
  type playdeveloperreporting_v1beta1,
} from '@googleapis/playdeveloperreporting';
import { Data, Effect } from 'effect';
import type { ServiceAccount } from '../core/types/credentials.js';
import { describePlayErrors } from './playClient.js';
import type {
  PlayVitalsMetric,
  PlayVitalsRow,
  VitalsTimeline,
  VitalsWindow,
} from '../core/types/vitals.js';
/** Distinct from the Play Developer API scope - the reporting API rejects an `androidpublisher` token. */
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/playdeveloperreporting';
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
const shiftIsoDate = (iso: string, delta: number): string => {
  const { year, month, day } = isoToDateParts(iso);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return shifted.toISOString().slice(0, 10);
};
/**
 * Compute the DAILY window to query: `days` of history ending at `latestDate` (the metric set's freshest
 * day, from `:get`). Falls back to ending today when freshness is unknown - the API still clamps to what
 * it has, so an over-reaching end is harmless. Returns inclusive `startDate`/`endDate`.
 */
export const resolveVitalsWindow = (latestDate: string | null, days: number): VitalsWindow => {
  let endDate = new Date().toISOString().slice(0, 10);
  if (latestDate !== null) endDate = latestDate;
  return { startDate: shiftIsoDate(endDate, -(days - 1)), endDate };
};
/** Render a Google `DateTime`'s date part as ISO `YYYY-MM-DD`, or undefined when the date is incomplete. */
const dateTimeToIso = (
  date: playdeveloperreporting_v1beta1.Schema$GoogleTypeDateTime | undefined,
): string | undefined => {
  if (date === undefined) return;
  if (typeof date.year !== 'number') return;
  if (typeof date.month !== 'number') return;
  if (typeof date.day !== 'number') return;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
};
/** Split an ISO `YYYY-MM-DD` string into the `{ year, month, day }` the API's `timelineSpec` wants. */
const isoToDateParts = (
  iso: string,
): {
  year: number;
  month: number;
  day: number;
} => {
  const dateSegments = iso.split('-').map(Number);
  let year = 0;
  let month = 0;
  let day = 0;
  if (typeof dateSegments[0] === 'number') year = dateSegments[0];
  if (typeof dateSegments[1] === 'number') month = dateSegments[1];
  if (typeof dateSegments[2] === 'number') day = dateSegments[2];
  return { year, month, day };
};
/** Parse a metric's string value to a number, or undefined when the column is absent/unparseable. */
const metricNumber = (
  metricEntry: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1MetricsRow,
  name: string,
): number | undefined => {
  const encodedValue = metricEntry.metrics?.find((metric) => metric.metric === name)?.decimalValue
    ?.value;
  if (typeof encodedValue !== 'string') return undefined;
  const metricValue = Number(encodedValue);
  if (Number.isNaN(metricValue)) return;
  return metricValue;
};
/** A generated Play Developer Reporting request failed. */
export type PlayReportingApiError = Readonly<{
  readonly _tag: 'PlayReportingApiError';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makePlayReportingApiError =
  Data.tagged<PlayReportingApiError>('PlayReportingApiError');
export type PlayReportingTransport = {
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
    if (generatedReporting !== undefined) {
      this.reporting = generatedReporting;
      return;
    }
    const authenticationOptions: {
      email: string;
      key: string;
      keyId?: string;
      scopes: string[];
    } = {
      email: account.clientEmail,
      key: account.privateKey,
      scopes: [OAUTH_SCOPE],
    };
    if (account.privateKeyId !== undefined) authenticationOptions.keyId = account.privateKeyId;
    const googleAuthentication = new playReportingAuth.JWT(authenticationOptions);
    this.reporting = playdeveloperreporting({
      version: 'v1beta1',
      auth: googleAuthentication,
    });
  }
  /** Convert the official generated client's Promise-shaped request into one Effect. */
  private executeGeneratedRequest<TGoogleShape>(
    operation: string,
    invoke: () => PromiseLike<{
      data: TGoogleShape;
    }>,
  ): Effect.Effect<TGoogleShape, PlayReportingApiError> {
    return Effect.tryPromise({
      try: invoke,
      catch: (cause) => {
        let failureText = String(cause);
        if (cause instanceof Error) failureText = cause.message;
        return makePlayReportingApiError({
          operation,
          message: `Play Developer Reporting ${operation} failed: ${describePlayErrors(failureText)}`,
          cause,
        });
      },
    }).pipe(Effect.map((completedRequest) => completedRequest.data));
  }
  /**
   * Read the latest DAILY day Google has finished aggregating for a metric set, as ISO `YYYY-MM-DD`,
   * or null when no freshness is published yet (a brand-new app). Used to bound the default query
   * window so a request never reaches past available data.
   */
  latestDailyDate(
    packageName: string,
    metric: PlayVitalsMetric,
  ): Effect.Effect<string | null, PlayReportingApiError> {
    return Effect.gen(this, function* () {
      const { resource } = METRIC_SETS[metric];
      const name = `apps/${packageName}/${resource}`;
      let metricSet:
        | playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1CrashRateMetricSet
        | playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1AnrRateMetricSet;
      switch (metric) {
        case 'crash':
          metricSet = yield* this.executeGeneratedRequest('get crash-rate freshness', () =>
            this.reporting.vitals.crashrate.get({ name }),
          );
          break;
        case 'anr':
          metricSet = yield* this.executeGeneratedRequest('get ANR-rate freshness', () =>
            this.reporting.vitals.anrrate.get({ name }),
          );
          break;
      }
      const dailyFreshness = metricSet.freshnessInfo?.freshnesses?.find(
        (freshness) => freshness.aggregationPeriod === 'DAILY',
      );
      const latestDate = dateTimeToIso(dailyFreshness?.latestEndTime);
      if (latestDate === undefined) return null;
      return latestDate;
    });
  }
  /**
   * Fetch one vital's full DAILY timeline: bound the window by the metric set's freshness (via `:get`,
   * so the request never reaches past available data), then query + normalize. This is the single
   * call `launch play-reports vitals` makes per metric - the freshness->window->query orchestration that
   * belongs in the client, not the CLI.
   */
  vitalsTimeline(
    packageName: string,
    metric: PlayVitalsMetric,
    days: number,
  ): Effect.Effect<VitalsTimeline, PlayReportingApiError> {
    return Effect.gen(this, function* () {
      const latestDate = yield* this.latestDailyDate(packageName, metric);
      const window = resolveVitalsWindow(latestDate, days);
      switch (metric) {
        case 'crash': {
          const entries = yield* this.queryCrashRate(packageName, window);
          return { metric, window, rows: entries };
        }
        case 'anr': {
          const entries = yield* this.queryAnrRate(packageName, window);
          return { metric, window, rows: entries };
        }
      }
    });
  }
  /** Query the crash-rate metric set over a DAILY window, returning normalized rows. */
  queryCrashRate(
    packageName: string,
    window: VitalsWindow,
  ): Effect.Effect<PlayVitalsRow[], PlayReportingApiError> {
    return this.queryVitals('crash', packageName, window);
  }
  /** Query the ANR-rate metric set over a DAILY window, returning normalized rows. */
  queryAnrRate(
    packageName: string,
    window: VitalsWindow,
  ): Effect.Effect<PlayVitalsRow[], PlayReportingApiError> {
    return this.queryVitals('anr', packageName, window);
  }
  /**
   * Query one metric set over a DAILY window and normalize every row, paging through Google's
   * `nextPageToken` in full. No dimensions are requested, so each row is one day aggregated across
   * the whole user base - the headline timeline `launch play-reports vitals` shows.
   */
  private queryVitals(
    metric: PlayVitalsMetric,
    packageName: string,
    window: VitalsWindow,
  ): Effect.Effect<PlayVitalsRow[], PlayReportingApiError> {
    return Effect.gen(this, function* () {
      const set = METRIC_SETS[metric];
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
            metrics: [set.rate, set.userPerceivedRate, set.distinctUsers],
          };
        if (pageToken !== undefined) queryRequest.pageToken = pageToken;
        const name = `apps/${packageName}/${set.resource}`;
        let metricPage:
          | playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryCrashRateMetricSetResponse
          | playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryAnrRateMetricSetResponse;
        switch (metric) {
          case 'crash':
            metricPage = yield* this.executeGeneratedRequest('query crash-rate timeline', () =>
              this.reporting.vitals.crashrate.query({ name, requestBody: queryRequest }),
            );
            break;
          case 'anr':
            metricPage = yield* this.executeGeneratedRequest('query ANR-rate timeline', () =>
              this.reporting.vitals.anrrate.query({ name, requestBody: queryRequest }),
            );
            break;
        }
        if (Array.isArray(metricPage.rows)) {
          for (const metricEntry of metricPage.rows) {
            const date = dateTimeToIso(metricEntry.startTime);
            if (!date) continue;
            const normalized: PlayVitalsRow = { metric, date };
            const rate = metricNumber(metricEntry, set.rate);
            if (rate !== undefined) normalized.rate = rate;
            const userPerceivedRate = metricNumber(metricEntry, set.userPerceivedRate);
            if (userPerceivedRate !== undefined) normalized.userPerceivedRate = userPerceivedRate;
            const distinctUsers = metricNumber(metricEntry, set.distinctUsers);
            if (distinctUsers !== undefined) normalized.distinctUsers = distinctUsers;
            entries.push(normalized);
          }
        }
        const nextPageToken = metricPage.nextPageToken;
        if (typeof nextPageToken === 'string' && nextPageToken.length > 0) {
          pageToken = nextPageToken;
        } else {
          pageToken = undefined;
        }
      } while (pageToken);
      entries.sort((leftEntry, rightEntry) => leftEntry.date.localeCompare(rightEntry.date));
      return entries;
    });
  }
}
