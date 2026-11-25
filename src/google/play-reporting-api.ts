// Generated from the Play Developer Reporting v1beta1 Discovery document.
// Reproduce: python3 scripts/generate-api-methods.py

import {
  auth as playReportingAuth,
  playdeveloperreporting,
  type playdeveloperreporting_v1beta1,
} from '@googleapis/playdeveloperreporting';

import { readServiceAccount } from './google-play.js';

const REPORTING_SCOPE = 'https://www.googleapis.com/auth/playdeveloperreporting';

type ReportingPublisher = ReturnType<typeof playdeveloperreporting>;

function playReportingFailure(operation: string, cause: unknown): Error {
  const isError = cause instanceof Error;

  if (isError) {
    return new Error(`Play reporting ${operation} failed. ${cause.message}`, { cause });
  }

  return new Error(`Play reporting ${operation} failed. ${String(cause)}`, { cause });
}

/** Every Play Developer Reporting v1beta1 method the installed official client declares. */
export class PlayReportingApi {
  private readonly reporting: ReportingPublisher;

  constructor(serviceAccountJson: string, generatedReporting?: ReportingPublisher) {
    if (generatedReporting != null) {
      this.reporting = generatedReporting;
      return;
    }

    const account = readServiceAccount(serviceAccountJson);
    const googleAuthentication = new playReportingAuth.JWT({
      email: account.clientEmail,
      key: account.privateKey,
      scopes: [REPORTING_SCOPE],
    });
    this.reporting = playdeveloperreporting({
      version: 'v1beta1',
      auth: googleAuthentication,
    });
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.bitmapmemoryusage/query}
   */
  async queryVitalsBitmapmemoryusage(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Bitmapmemoryusage$Query,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryBitmapMemoryUsageMetricSetResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryBitmapMemoryUsageMetricSetResponse;
    };

    try {
      completed = await this.reporting.vitals.bitmapmemoryusage.query(call);
    } catch (error) {
      throw playReportingFailure('vitals.bitmapmemoryusage.query', error);
    }

    return completed.data;
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.bitmapmemoryusage/get}
   */
  async getVitalsBitmapmemoryusage(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Bitmapmemoryusage$Get,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1BitmapMemoryUsageMetricSet> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1BitmapMemoryUsageMetricSet;
    };

    try {
      completed = await this.reporting.vitals.bitmapmemoryusage.get(call);
    } catch (error) {
      throw playReportingFailure('vitals.bitmapmemoryusage.get', error);
    }

    return completed.data;
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.slowstartrate/query}
   */
  async queryVitalsSlowstartrate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Slowstartrate$Query,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QuerySlowStartRateMetricSetResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QuerySlowStartRateMetricSetResponse;
    };

    try {
      completed = await this.reporting.vitals.slowstartrate.query(call);
    } catch (error) {
      throw playReportingFailure('vitals.slowstartrate.query', error);
    }

    return completed.data;
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.slowstartrate/get}
   */
  async getVitalsSlowstartrate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Slowstartrate$Get,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SlowStartRateMetricSet> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SlowStartRateMetricSet;
    };

    try {
      completed = await this.reporting.vitals.slowstartrate.get(call);
    } catch (error) {
      throw playReportingFailure('vitals.slowstartrate.get', error);
    }

    return completed.data;
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.lmkrate/query}
   */
  async queryVitalsLmkrate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Lmkrate$Query,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryLmkRateMetricSetResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryLmkRateMetricSetResponse;
    };

    try {
      completed = await this.reporting.vitals.lmkrate.query(call);
    } catch (error) {
      throw playReportingFailure('vitals.lmkrate.query', error);
    }

    return completed.data;
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.lmkrate/get}
   */
  async getVitalsLmkrate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Lmkrate$Get,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1LmkRateMetricSet> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1LmkRateMetricSet;
    };

    try {
      completed = await this.reporting.vitals.lmkrate.get(call);
    } catch (error) {
      throw playReportingFailure('vitals.lmkrate.get', error);
    }

    return completed.data;
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.slowrenderingrate/get}
   */
  async getVitalsSlowrenderingrate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Slowrenderingrate$Get,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SlowRenderingRateMetricSet> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SlowRenderingRateMetricSet;
    };

    try {
      completed = await this.reporting.vitals.slowrenderingrate.get(call);
    } catch (error) {
      throw playReportingFailure('vitals.slowrenderingrate.get', error);
    }

    return completed.data;
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.slowrenderingrate/query}
   */
  async queryVitalsSlowrenderingrate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Slowrenderingrate$Query,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QuerySlowRenderingRateMetricSetResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QuerySlowRenderingRateMetricSetResponse;
    };

    try {
      completed = await this.reporting.vitals.slowrenderingrate.query(call);
    } catch (error) {
      throw playReportingFailure('vitals.slowrenderingrate.query', error);
    }

    return completed.data;
  }

  /**
   * Searches all error issues in which reports have been grouped.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.errors.issues/search}
   */
  async searchVitalsErrorsIssues(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Errors$Issues$Search,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SearchErrorIssuesResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SearchErrorIssuesResponse;
    };

    try {
      completed = await this.reporting.vitals.errors.issues.search(call);
    } catch (error) {
      throw playReportingFailure('vitals.errors.issues.search', error);
    }

    return completed.data;
  }

  /**
   * Describes the properties of the metrics set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.errors.counts/get}
   */
  async getVitalsErrorsCounts(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Errors$Counts$Get,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1ErrorCountMetricSet> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1ErrorCountMetricSet;
    };

    try {
      completed = await this.reporting.vitals.errors.counts.get(call);
    } catch (error) {
      throw playReportingFailure('vitals.errors.counts.get', error);
    }

    return completed.data;
  }

  /**
   * Queries the metrics in the metrics set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.errors.counts/query}
   */
  async queryVitalsErrorsCounts(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Errors$Counts$Query,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryErrorCountMetricSetResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryErrorCountMetricSetResponse;
    };

    try {
      completed = await this.reporting.vitals.errors.counts.query(call);
    } catch (error) {
      throw playReportingFailure('vitals.errors.counts.query', error);
    }

    return completed.data;
  }

  /**
   * Searches all error reports received for an app.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.errors.reports/search}
   */
  async searchVitalsErrorsReports(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Errors$Reports$Search,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SearchErrorReportsResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SearchErrorReportsResponse;
    };

    try {
      completed = await this.reporting.vitals.errors.reports.search(call);
    } catch (error) {
      throw playReportingFailure('vitals.errors.reports.search', error);
    }

    return completed.data;
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.stuckbackgroundwakelockrate/query}
   */
  async queryVitalsStuckbackgroundwakelockrate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Stuckbackgroundwakelockrate$Query,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryStuckBackgroundWakelockRateMetricSetResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryStuckBackgroundWakelockRateMetricSetResponse;
    };

    try {
      completed = await this.reporting.vitals.stuckbackgroundwakelockrate.query(call);
    } catch (error) {
      throw playReportingFailure('vitals.stuckbackgroundwakelockrate.query', error);
    }

    return completed.data;
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.stuckbackgroundwakelockrate/get}
   */
  async getVitalsStuckbackgroundwakelockrate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Stuckbackgroundwakelockrate$Get,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1StuckBackgroundWakelockRateMetricSet> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1StuckBackgroundWakelockRateMetricSet;
    };

    try {
      completed = await this.reporting.vitals.stuckbackgroundwakelockrate.get(call);
    } catch (error) {
      throw playReportingFailure('vitals.stuckbackgroundwakelockrate.get', error);
    }

    return completed.data;
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.excessivewakeuprate/query}
   */
  async queryVitalsExcessivewakeuprate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Excessivewakeuprate$Query,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryExcessiveWakeupRateMetricSetResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryExcessiveWakeupRateMetricSetResponse;
    };

    try {
      completed = await this.reporting.vitals.excessivewakeuprate.query(call);
    } catch (error) {
      throw playReportingFailure('vitals.excessivewakeuprate.query', error);
    }

    return completed.data;
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.excessivewakeuprate/get}
   */
  async getVitalsExcessivewakeuprate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Excessivewakeuprate$Get,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1ExcessiveWakeupRateMetricSet> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1ExcessiveWakeupRateMetricSet;
    };

    try {
      completed = await this.reporting.vitals.excessivewakeuprate.get(call);
    } catch (error) {
      throw playReportingFailure('vitals.excessivewakeuprate.get', error);
    }

    return completed.data;
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.crashrate/query}
   */
  async queryVitalsCrashrate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Crashrate$Query,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryCrashRateMetricSetResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryCrashRateMetricSetResponse;
    };

    try {
      completed = await this.reporting.vitals.crashrate.query(call);
    } catch (error) {
      throw playReportingFailure('vitals.crashrate.query', error);
    }

    return completed.data;
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.crashrate/get}
   */
  async getVitalsCrashrate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Crashrate$Get,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1CrashRateMetricSet> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1CrashRateMetricSet;
    };

    try {
      completed = await this.reporting.vitals.crashrate.get(call);
    } catch (error) {
      throw playReportingFailure('vitals.crashrate.get', error);
    }

    return completed.data;
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.anrrate/query}
   */
  async queryVitalsAnrrate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Anrrate$Query,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryAnrRateMetricSetResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryAnrRateMetricSetResponse;
    };

    try {
      completed = await this.reporting.vitals.anrrate.query(call);
    } catch (error) {
      throw playReportingFailure('vitals.anrrate.query', error);
    }

    return completed.data;
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.anrrate/get}
   */
  async getVitalsAnrrate(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Anrrate$Get,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1AnrRateMetricSet> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1AnrRateMetricSet;
    };

    try {
      completed = await this.reporting.vitals.anrrate.get(call);
    } catch (error) {
      throw playReportingFailure('vitals.anrrate.get', error);
    }

    return completed.data;
  }

  /**
   * Describes the properties of the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.anonrssandswapmemoryusage/get}
   */
  async getVitalsAnonrssandswapmemoryusage(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Anonrssandswapmemoryusage$Get,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1AnonRssAndSwapMemoryUsageMetricSet> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1AnonRssAndSwapMemoryUsageMetricSet;
    };

    try {
      completed = await this.reporting.vitals.anonrssandswapmemoryusage.get(call);
    } catch (error) {
      throw playReportingFailure('vitals.anonrssandswapmemoryusage.get', error);
    }

    return completed.data;
  }

  /**
   * Queries the metrics in the metric set.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.anonrssandswapmemoryusage/query}
   */
  async queryVitalsAnonrssandswapmemoryusage(
    call: playdeveloperreporting_v1beta1.Params$Resource$Vitals$Anonrssandswapmemoryusage$Query,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryAnonRssAndSwapMemoryUsageMetricSetResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryAnonRssAndSwapMemoryUsageMetricSetResponse;
    };

    try {
      completed = await this.reporting.vitals.anonrssandswapmemoryusage.query(call);
    } catch (error) {
      throw playReportingFailure('vitals.anonrssandswapmemoryusage.query', error);
    }

    return completed.data;
  }

  /**
   * Describes filtering options for releases.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/apps/fetchReleaseFilterOptions}
   */
  async fetchReleaseFilterOptionsApps(
    call: playdeveloperreporting_v1beta1.Params$Resource$Apps$Fetchreleasefilteroptions,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1ReleaseFilterOptions> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1ReleaseFilterOptions;
    };

    try {
      completed = await this.reporting.apps.fetchReleaseFilterOptions(call);
    } catch (error) {
      throw playReportingFailure('apps.fetchReleaseFilterOptions', error);
    }

    return completed.data;
  }

  /**
   * Searches for Apps accessible by the user.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/apps/search}
   */
  async searchApps(
    call: playdeveloperreporting_v1beta1.Params$Resource$Apps$Search,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SearchAccessibleAppsResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1SearchAccessibleAppsResponse;
    };

    try {
      completed = await this.reporting.apps.search(call);
    } catch (error) {
      throw playReportingFailure('apps.search', error);
    }

    return completed.data;
  }

  /**
   * Lists anomalies in any of the datasets.
   * @see {@link https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/anomalies/list}
   */
  async listAnomalies(
    call: playdeveloperreporting_v1beta1.Params$Resource$Anomalies$List,
  ): Promise<playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1ListAnomaliesResponse> {
    var completed: {
      data: playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1ListAnomaliesResponse;
    };

    try {
      completed = await this.reporting.anomalies.list(call);
    } catch (error) {
      throw playReportingFailure('anomalies.list', error);
    }

    return completed.data;
  }
}
