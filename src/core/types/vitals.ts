/**
 * Google Play Android vitals: the metric set and the row / window / timeline shapes the vitals reader
 * returns for `launch vitals`.
 */

/**
 * Which Android quality vital a `launch play-reports vitals` query reads.
 *
 * `crash` → the crash-rate metric set, `anr` → the application-not-responding metric set. These map
 * 1:1 to the two flagship metric sets in the Play Developer Reporting API
 * ({@link https://developers.google.com/play/developer/reporting crashRateMetricSet / anrRateMetricSet}).
 */
export type PlayVitalsMetric = 'crash' | 'anr';

/**
 * One normalized day of an Android quality vital — the clean internal shape `launch play-reports vitals`
 * renders, lifted from the Play Developer Reporting API's nested `{ startTime, metrics[] }` row.
 *
 * Each row is a single DAILY data point with the API's metric names flattened to plain numbers (the API
 * encodes metric values as decimal *strings* under `decimalValue.value`; these are parsed to numbers).
 * `rate` is the headline figure (crash rate or ANR rate as a fraction of distinctUsers, e.g. 0.012 =
 * 1.2%); `userPerceivedRate` is the foreground-only variant Google highlights in the Console; both are
 * `undefined` when Google returned no value for that day (sparse rows are expected near the freshness
 * edge). `distinctUsers` is the denominator population for the day.
 */
export interface PlayVitalsRow {
  /** Which vital this row measures (`crash` or `anr`). */
  metric: PlayVitalsMetric;
  /** The day this row covers, as an ISO `YYYY-MM-DD` date in the metric set's default timezone. */
  date: string;
  /** Headline rate for the day (fraction of users affected), or undefined when Google returned none. */
  rate?: number;
  /** Foreground-only ("user-perceived") rate for the day, or undefined when absent. */
  userPerceivedRate?: number;
  /** Distinct users observed that day (the rate denominator), or undefined when absent. */
  distinctUsers?: number;
}

/**
 * A day window for a vitals query, as ISO `YYYY-MM-DD` strings (both ends inclusive). Produced by
 * `resolveVitalsWindow` from a metric set's freshness and consumed by the Play Developer Reporting
 * query methods, so a request never reaches past the data Google has finished aggregating.
 */
export interface VitalsWindow {
  /** First day to include (inclusive), `YYYY-MM-DD`. */
  startDate: string;
  /** Last day to include (inclusive), `YYYY-MM-DD`. */
  endDate: string;
}

/**
 * One vital's resolved timeline: the metric, the window actually queried (after freshness bounding),
 * and its normalized daily rows. The result of `PlayReportingClient.vitalsTimeline` — the unit the
 * `launch play-reports vitals` command renders.
 */
export interface VitalsTimeline {
  metric: PlayVitalsMetric;
  window: VitalsWindow;
  rows: PlayVitalsRow[];
}
