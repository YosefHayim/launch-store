// Sales and finance report queries, plus the sales rows the stats feed reads.

/** Parameters for a Sales & Trends report download */
export type SalesReportQuery = Readonly<{
  vendorNumber: string;
  frequency: string;
  reportType: string;
  reportSubType: string;
  reportDate: string;
  version?: string | undefined;
}>;

/** Parameters for a Finance report download - Apple's `filter[...]` query for `/v1/financeReports`. */
export type FinanceReportQuery = Readonly<{
  vendorNumber: string;
  reportDate: string;
  regionCode: string;
  reportType?: string | undefined;
}>;

export type SalesReportKind = 'download' | 'redownload' | 'update' | 'in-app-purchase';

export type AppStoreStatsPath = 'sales' | 'analytics';

export type ReportLine = Readonly<Record<string, string>>;
