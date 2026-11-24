// App Store Connect analytics reports and the rows the stats feed reads.

import type { ReportLine } from './reporting.ts';

/** An analytics report request - the subscription that makes reports available for an app. */
export type AnalyticsReportRequestResource = Readonly<{
  id: string;
  accessType: string;
  stoppedDueToInactivity?: boolean | undefined;
}>;

/** One report available within a request (e.g. "App Store Installations"), grouped by category. */
export type AnalyticsReportResource = Readonly<{
  id: string;
  name: string;
  category?: string | undefined;
}>;

/** One time-period instance of a report - a single day/week/month of generated data. */
export type AnalyticsReportInstanceResource = Readonly<{
  id: string;
  granularity: string;
  processingDate?: string | undefined;
}>;

/** One downloadable segment of a report instance */
export type AnalyticsReportSegmentResource = Readonly<{
  id: string;
  url: string;
  checksum?: string | undefined;
  sizeInBytes?: number | undefined;
}>;

export type AnalyticsReportKind =
  | 'discovery'
  | 'downloads'
  | 'purchases'
  | 'sessions'
  | 'crashes'
  | 'installs';

export type AnalyticsAccessType = 'ONGOING' | 'ONE_TIME_SNAPSHOT';

/** The lines of one downloaded analytics segment, with the instance it came from. */
export interface AnalyticsReportBatch {
  readonly kind: AnalyticsReportKind;
  readonly accessType: AnalyticsAccessType;
  readonly processingDate: string;
  readonly lines: readonly ReportLine[];
}
