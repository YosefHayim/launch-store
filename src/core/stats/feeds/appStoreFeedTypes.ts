export type SalesReportKind = 'download' | 'redownload' | 'update' | 'in-app-purchase';

export type AppStoreStatsPath = 'sales' | 'analytics';

export type AnalyticsReportKind =
  | 'discovery'
  | 'downloads'
  | 'purchases'
  | 'sessions'
  | 'crashes'
  | 'installs';

export type AnalyticsAccessType = 'ONGOING' | 'ONE_TIME_SNAPSHOT';

export type ReportLine = Readonly<Record<string, string>>;

/** The lines of one downloaded analytics segment, with the instance it came from. */
export interface AnalyticsReportBatch {
  readonly kind: AnalyticsReportKind;
  readonly accessType: AnalyticsAccessType;
  readonly processingDate: string;
  readonly lines: readonly ReportLine[];
}
