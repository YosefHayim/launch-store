export type PlayVitalsMetric = 'crash' | 'anr';
/** One normalized day of an Android quality vital */
export type PlayVitalsRow = Readonly<{
  metric: PlayVitalsMetric;
  date: string;
  rate?: number;
  userPerceivedRate?: number;
  distinctUsers?: number;
}>;
/** A day window for a vitals query, as ISO `YYYY-MM-DD` strings (both ends inclusive). */
export type VitalsWindow = Readonly<{
  startDate: string;
  endDate: string;
}>;
/** One vital's resolved timeline */
export type VitalsTimeline = Readonly<{
  metric: PlayVitalsMetric;
  window: VitalsWindow;
  rows: readonly PlayVitalsRow[];
}>;
