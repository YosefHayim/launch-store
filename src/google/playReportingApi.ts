// Generated from the Play Developer Reporting v1beta1 Discovery document.
// Reproduce: pnpm gen:api

import {
  auth as playReportingAuth,
  playdeveloperreporting,
  type playdeveloperreporting_v1beta1,
} from '@googleapis/playdeveloperreporting';
import { Effect } from 'effect';
import type { ServiceAccount } from '../core/types/credentials.js';
import { serviceAccountJwtOptions } from './playClient.js';
import { makePlayReportingApiError, type PlayReportingApiError } from './playReporting.js';

const REPORTING_SCOPE = 'https://www.googleapis.com/auth/playdeveloperreporting';

type ReportingPublisher = ReturnType<typeof playdeveloperreporting>;

const isReportingPublisher = (
  generatedReporting: ReportingPublisher | undefined,
): generatedReporting is ReportingPublisher => {
  return generatedReporting != null;
};

const reportingFailure = (operation: string, cause: unknown): PlayReportingApiError => {
  const isError = cause instanceof Error;

  if (isError) {
    return makePlayReportingApiError({
      operation,
      message: `Play reporting ${operation} failed: ${cause.message}`,
      cause,
    });
  }

  return makePlayReportingApiError({
    operation,
    message: `Play reporting ${operation} failed: ${String(cause)}`,
    cause,
  });
};

const runReportingCall = <ReportShape>(
  operation: string,
  invoke: () => PromiseLike<{ data: ReportShape }>,
): Effect.Effect<ReportShape, PlayReportingApiError> => {
  return Effect.tryPromise({
    try: invoke,
    catch: (cause) => reportingFailure(operation, cause),
  }).pipe(Effect.map((completed) => completed.data));
};

/** Every Play Developer Reporting v1beta1 method, on Google's official client. */
export class PlayReportingApi {
  private readonly reporting: ReportingPublisher;

  constructor(account: ServiceAccount, generatedReporting?: ReportingPublisher) {
    if (isReportingPublisher(generatedReporting)) {
      this.reporting = generatedReporting;
      return;
    }

    const googleAuthentication = new playReportingAuth.JWT(
      serviceAccountJwtOptions(account, [REPORTING_SCOPE]),
    );
    this.reporting = playdeveloperreporting({
      version: 'v1beta1',
      auth: googleAuthentication,
    });
  }

  /**
   * Lists anomalies in any of the datasets.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/anomalies/list}
   */
  listAnomalies(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Anomalies$List,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1ListAnomaliesResponse,
    PlayReportingApiError
  > {
    return runReportingCall('anomalies.list', () => this.reporting.anomalies.list(parameters));
  }

  /**
   * Searches all error reports received for an app.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.errors.reports/search}
   */
  searchVitalsErrorsReports(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Errors$Reports$Search,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SearchErrorReportsResponse,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.errors.reports.search', () =>
      this.reporting.vitals.errors.reports.search(parameters),
    );
  }

  /**
   * Searches all error issues in which reports have been grouped.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.errors.issues/search}
   */
  searchVitalsErrorsIssues(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Errors$Issues$Search,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SearchErrorIssuesResponse,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.errors.issues.search', () =>
      this.reporting.vitals.errors.issues.search(parameters),
    );
  }

  /**
   * Queries the metrics in the metrics set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.errors.counts/query}
   */
  queryVitalsErrorsCounts(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Errors$Counts$Query,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryErrorCountMetricSetResponse,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.errors.counts.query', () =>
      this.reporting.vitals.errors.counts.query(parameters),
    );
  }

  /**
   * Describes the properties of the metrics set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.errors.counts/get}
   */
  getVitalsErrorsCounts(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Errors$Counts$Get,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1ErrorCountMetricSet,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.errors.counts.get', () =>
      this.reporting.vitals.errors.counts.get(parameters),
    );
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.slowstartrate/get}
   */
  getVitalsSlowstartrate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Slowstartrate$Get,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SlowStartRateMetricSet,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.slowstartrate.get', () =>
      this.reporting.vitals.slowstartrate.get(parameters),
    );
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.slowstartrate/query}
   */
  queryVitalsSlowstartrate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Slowstartrate$Query,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QuerySlowStartRateMetricSetResponse,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.slowstartrate.query', () =>
      this.reporting.vitals.slowstartrate.query(parameters),
    );
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.anonrssandswapmemoryusage/get}
   */
  getVitalsAnonrssandswapmemoryusage(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Anonrssandswapmemoryusage$Get,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1AnonRssAndSwapMemoryUsageMetricSet,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.anonrssandswapmemoryusage.get', () =>
      this.reporting.vitals.anonrssandswapmemoryusage.get(parameters),
    );
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.anonrssandswapmemoryusage/query}
   */
  queryVitalsAnonrssandswapmemoryusage(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Anonrssandswapmemoryusage$Query,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryAnonRssAndSwapMemoryUsageMetricSetResponse,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.anonrssandswapmemoryusage.query', () =>
      this.reporting.vitals.anonrssandswapmemoryusage.query(parameters),
    );
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.slowrenderingrate/get}
   */
  getVitalsSlowrenderingrate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Slowrenderingrate$Get,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SlowRenderingRateMetricSet,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.slowrenderingrate.get', () =>
      this.reporting.vitals.slowrenderingrate.get(parameters),
    );
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.slowrenderingrate/query}
   */
  queryVitalsSlowrenderingrate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Slowrenderingrate$Query,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QuerySlowRenderingRateMetricSetResponse,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.slowrenderingrate.query', () =>
      this.reporting.vitals.slowrenderingrate.query(parameters),
    );
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.lmkrate/query}
   */
  queryVitalsLmkrate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Lmkrate$Query,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryLmkRateMetricSetResponse,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.lmkrate.query', () =>
      this.reporting.vitals.lmkrate.query(parameters),
    );
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.lmkrate/get}
   */
  getVitalsLmkrate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Lmkrate$Get,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1LmkRateMetricSet,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.lmkrate.get', () =>
      this.reporting.vitals.lmkrate.get(parameters),
    );
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.crashrate/query}
   */
  queryVitalsCrashrate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Crashrate$Query,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryCrashRateMetricSetResponse,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.crashrate.query', () =>
      this.reporting.vitals.crashrate.query(parameters),
    );
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.crashrate/get}
   */
  getVitalsCrashrate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Crashrate$Get,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1CrashRateMetricSet,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.crashrate.get', () =>
      this.reporting.vitals.crashrate.get(parameters),
    );
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.stuckbackgroundwakelockrate/query}
   */
  queryVitalsStuckbackgroundwakelockrate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Stuckbackgroundwakelockrate$Query,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryStuckBackgroundWakelockRateMetricSetResponse,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.stuckbackgroundwakelockrate.query', () =>
      this.reporting.vitals.stuckbackgroundwakelockrate.query(parameters),
    );
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.stuckbackgroundwakelockrate/get}
   */
  getVitalsStuckbackgroundwakelockrate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Stuckbackgroundwakelockrate$Get,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1StuckBackgroundWakelockRateMetricSet,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.stuckbackgroundwakelockrate.get', () =>
      this.reporting.vitals.stuckbackgroundwakelockrate.get(parameters),
    );
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.excessivewakeuprate/get}
   */
  getVitalsExcessivewakeuprate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Excessivewakeuprate$Get,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1ExcessiveWakeupRateMetricSet,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.excessivewakeuprate.get', () =>
      this.reporting.vitals.excessivewakeuprate.get(parameters),
    );
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.excessivewakeuprate/query}
   */
  queryVitalsExcessivewakeuprate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Excessivewakeuprate$Query,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryExcessiveWakeupRateMetricSetResponse,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.excessivewakeuprate.query', () =>
      this.reporting.vitals.excessivewakeuprate.query(parameters),
    );
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.bitmapmemoryusage/get}
   */
  getVitalsBitmapmemoryusage(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Bitmapmemoryusage$Get,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1BitmapMemoryUsageMetricSet,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.bitmapmemoryusage.get', () =>
      this.reporting.vitals.bitmapmemoryusage.get(parameters),
    );
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.bitmapmemoryusage/query}
   */
  queryVitalsBitmapmemoryusage(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Bitmapmemoryusage$Query,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryBitmapMemoryUsageMetricSetResponse,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.bitmapmemoryusage.query', () =>
      this.reporting.vitals.bitmapmemoryusage.query(parameters),
    );
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.anrrate/get}
   */
  getVitalsAnrrate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Anrrate$Get,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1AnrRateMetricSet,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.anrrate.get', () =>
      this.reporting.vitals.anrrate.get(parameters),
    );
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.anrrate/query}
   */
  queryVitalsAnrrate(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Anrrate$Query,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryAnrRateMetricSetResponse,
    PlayReportingApiError
  > {
    return runReportingCall('vitals.anrrate.query', () =>
      this.reporting.vitals.anrrate.query(parameters),
    );
  }

  /**
   * Describes filtering options for releases.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/apps/fetchReleaseFilterOptions}
   */
  fetchReleaseFilterOptionsApps(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Apps$Fetchreleasefilteroptions,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1ReleaseFilterOptions,
    PlayReportingApiError
  > {
    return runReportingCall('apps.fetchReleaseFilterOptions', () =>
      this.reporting.apps.fetchReleaseFilterOptions(parameters),
    );
  }

  /**
   * Searches for Apps accessible by the user.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/apps/search}
   */
  searchApps(
    parameters: playdeveloperreporting_v1beta1.Params$Resource$Apps$Search,
  ): Effect.Effect<
    playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SearchAccessibleAppsResponse,
    PlayReportingApiError
  > {
    return runReportingCall('apps.search', () => this.reporting.apps.search(parameters));
  }
}
