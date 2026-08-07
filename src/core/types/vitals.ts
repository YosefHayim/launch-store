export type PlayVitalsMetric = 'crash' | 'anr';
/**
 * One normalized day of an Android quality vital - the clean internal shape `launch play-reports vitals`
 * renders, lifted from the Play Developer Reporting API's nested `{ startTime, metrics[] }` row.
 *
 * Each row is a single DAILY data point with the API's metric names flattened to plain numbers (the API
 * encodes metric values as decimal *strings* under `decimalValue.value`; these are parsed to numbers).
 * `rate` is the headline figure (crash rate or ANR rate as a fraction of distinctUsers, e.g. 0.012 =
 * 1.2%); `userPerceivedRate` is the foreground-only variant Google highlights in the Console; both are
 * `undefined` when Google returned no value for that day (sparse rows are expected near the freshness
 * edge). `distinctUsers` is the denominator population for the day.
 */
export type PlayVitalsRow = Readonly<{
  metric: PlayVitalsMetric;
  date: string;
  rate?: number;
  userPerceivedRate?: number;
  distinctUsers?: number;
}>;
/**
 * A day window for a vitals query, as ISO `YYYY-MM-DD` strings (both ends inclusive). Produced by
 * `resolveVitalsWindow` from a metric set's freshness and consumed by the Play Developer Reporting
 * query methods, so a request never reaches past the data Google has finished aggregating.
 */
export type VitalsWindow = Readonly<{
  startDate: string;
  endDate: string;
}>;
/**
 * One vital's resolved timeline: the metric, the window actually queried (after freshness bounding),
 * and its normalized daily rows. The result of `PlayReportingClient.vitalsTimeline` - the unit the
 * `launch play-reports vitals` command renders.
 */
export type VitalsTimeline = Readonly<{
  metric: PlayVitalsMetric;
  window: VitalsWindow;
  rows: readonly PlayVitalsRow[];
}>;
