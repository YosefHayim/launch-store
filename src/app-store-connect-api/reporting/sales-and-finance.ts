// Docs: https://developer.apple.com/documentation/appstoreconnectapi/sales-and-finance
import type { FinanceReportQuery, SalesReportQuery } from '@core/types/appleCatalog.js';
import {
  APP_STORE_CONNECT_BASE_URL,
  type AppStoreConnectRequests,
  describeErrors,
  isRetryableIdempotentFailure,
  makeAscRequestError,
  parseErrorCodes,
  retryAppleTransportRequest,
} from '@/app-store-connect-api/api-client.js';
export const makeSalesAndFinanceApi = (api: AppStoreConnectRequests) => {
  /** A single (un-retried) gzipped-report fetch - the retry wrapper lives in {@link getReportBytes}. */
  const getReportBytesOnce = async (pathOrUrl: string): Promise<Buffer> => {
    let url = pathOrUrl;
    if (!pathOrUrl.startsWith('http')) url = `${APP_STORE_CONNECT_BASE_URL}${pathOrUrl}`;
    const appleResponse = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${await api.token()}`,
        Accept: 'application/a-gzip, application/json',
      },
    });
    if (!appleResponse.ok) {
      const text = await appleResponse.text();
      throw makeAscRequestError(
        `App Store Connect GET ${pathOrUrl} failed (${appleResponse.status}): ${describeErrors(text)}`,
        appleResponse.status,
        parseErrorCodes(text),
      );
    }
    return Buffer.from(await appleResponse.arrayBuffer());
  };
  /**
   * GET a gzipped report body (sales/finance) as raw bytes, with transparent retry on Apple's transient
   * failures. Surfaces Apple's JSON error `detail` (e.g. "There were no sales for the date specified")
   * on a 4xx instead of a bare status, so the command can show an actionable message.
   */
  const getReportBytes = async (pathOrUrl: string): Promise<Buffer> => {
    return retryAppleTransportRequest(() => getReportBytesOnce(pathOrUrl), {
      isRetryableFailure: isRetryableIdempotentFailure,
    });
  };
  /** Download a Sales & Trends report as raw gzip bytes (the caller decompresses + parses the TSV). */
  const getSalesReport = async (query: SalesReportQuery): Promise<Buffer> => {
    const reportParameters = [
      `filter[frequency]=${query.frequency}`,
      `filter[reportType]=${query.reportType}`,
      `filter[reportSubType]=${query.reportSubType}`,
      `filter[vendorNumber]=${encodeURIComponent(query.vendorNumber)}`,
      `filter[reportDate]=${query.reportDate}`,
    ];
    if (query.version !== undefined) reportParameters.push(`filter[version]=${query.version}`);
    return getReportBytes(`/salesReports?${reportParameters.join('&')}`);
  };
  /** Download a Finance report as raw gzip bytes (the caller decompresses + parses the TSV). */
  const getFinanceReport = async (query: FinanceReportQuery): Promise<Buffer> => {
    let reportType = query.reportType;
    if (reportType === undefined) reportType = 'FINANCE_DETAIL';
    const reportParameters = [
      `filter[regionCode]=${query.regionCode}`,
      `filter[reportDate]=${query.reportDate}`,
      `filter[reportType]=${reportType}`,
      `filter[vendorNumber]=${encodeURIComponent(query.vendorNumber)}`,
    ];
    return getReportBytes(`/financeReports?${reportParameters.join('&')}`);
  };
  return {
    getSalesReport,
    getFinanceReport,
  };
};
