import type {
  AnalyticsReportInstanceResource,
  AnalyticsReportRequestResource,
  AnalyticsReportResource,
  AnalyticsReportSegmentResource,
  FinanceReportQuery,
  SalesReportQuery,
} from '@/types/apple-catalog.js';
import type { AscHost } from './host.ts';
import {
  BASE_URL,
  AscRequestError,
  isRetryableIdempotentFailure,
  readReportRequest,
  describeErrors,
  parseErrorCodes,
} from './shared.ts';
import { retryAppleTransportRequest } from '../transport-helpers.ts';

export class ConnectReports {
  constructor(private readonly client: AscHost) {}

  async getSalesReport(query: SalesReportQuery): Promise<Buffer> {
    const reportParameters = [
      `filter[frequency]=${query.frequency}`,
      `filter[reportType]=${query.reportType}`,
      `filter[reportSubType]=${query.reportSubType}`,
      `filter[vendorNumber]=${encodeURIComponent(query.vendorNumber)}`,
      `filter[reportDate]=${query.reportDate}`,
    ];

    if (query.version != null) reportParameters.push(`filter[version]=${query.version}`);

    return this.getReportBytes(`/salesReports?${reportParameters.join('&')}`);
  }

  async getFinanceReport(query: FinanceReportQuery): Promise<Buffer> {
    let reportType = query.reportType;

    if (reportType == null) reportType = 'FINANCE_DETAIL';

    const reportParameters = [
      `filter[regionCode]=${query.regionCode}`,
      `filter[reportDate]=${query.reportDate}`,
      `filter[reportType]=${reportType}`,
      `filter[vendorNumber]=${encodeURIComponent(query.vendorNumber)}`,
    ];

    return this.getReportBytes(`/financeReports?${reportParameters.join('&')}`);
  }

  /**
   * Read analytics report requests for a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-analyticsreportrequests
   */
  async listAnalyticsReportRequests(
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource[]> {
    const appleResources = await this.client.requestAll<{
      accessType?: string;
      stoppedDueToInactivity?: boolean;
    }>(`/apps/${appId}/analyticsReportRequests?filter[accessType]=${accessType}&limit=200`);

    function mapPiece(entry: {
      id: string;
      attributes: { accessType?: string; stoppedDueToInactivity?: boolean };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      return readReportRequest(entry, accessType);
    }

    return appleResources.map(mapPiece);
  }

  /**
   * Request analytics reports for your apps.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-analyticsreportrequests
   */
  async createAnalyticsReportRequest(
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource> {
    const appleResources = await this.client.createResource<{
      accessType?: string;
      stoppedDueToInactivity?: boolean;
    }>('/analyticsReportRequests', {
      type: 'analyticsReportRequests',
      attributes: { accessType },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });

    return readReportRequest(appleResources, accessType);
  }

  /**
   * Get a list of reports generated from a specific analytics report request.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreportrequests-_id_-reports
   */
  async listAnalyticsReports(
    requestId: string,
    filters: {
      category?: string;
      name?: string;
    } = {},
  ): Promise<AnalyticsReportResource[]> {
    let path = `/analyticsReportRequests/${requestId}/reports?limit=200`;

    if (filters.category) path += `&filter[category]=${filters.category}`;

    if (filters.name) path += `&filter[name]=${encodeURIComponent(filters.name)}`;

    const appleResources = await this.client.requestAll<{
      name?: string;
      category?: string;
    }>(path);

    function mapReport(report: {
      id: string;
      attributes: { name?: string; category?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let reportName = report.attributes.name;

      if (reportName == null) reportName = '';

      const analyticsReport: AnalyticsReportResource = { id: report.id, name: reportName };

      if (report.attributes.category != null)
        Object.assign(analyticsReport, { category: report.attributes.category });

      return analyticsReport;
    }

    return appleResources.map(mapReport);
  }

  /**
   * Read list of all the granularity options for a specific type of analytics report.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreports-_id_-instances
   */
  async listAnalyticsReportInstances(
    reportId: string,
    filters: {
      granularity?: string;
      processingDate?: string;
    } = {},
  ): Promise<AnalyticsReportInstanceResource[]> {
    let path = `/analyticsReports/${reportId}/instances?limit=200`;

    if (filters.granularity) path += `&filter[granularity]=${filters.granularity}`;

    if (filters.processingDate) path += `&filter[processingDate]=${filters.processingDate}`;

    const appleResources = await this.client.requestAll<{
      granularity?: string;
      processingDate?: string;
    }>(path);

    function mapInstance(instance: {
      id: string;
      attributes: { granularity?: string; processingDate?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let granularity = instance.attributes.granularity;

      if (granularity == null) granularity = '';

      const reportInstance: AnalyticsReportInstanceResource = { id: instance.id, granularity };

      if (instance.attributes.processingDate != null)
        Object.assign(reportInstance, { processingDate: instance.attributes.processingDate });

      return reportInstance;
    }

    return appleResources.map(mapInstance);
  }

  /**
   * Get details for a specific analytics report segment.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreportinstances-_id_-segments
   */
  async listAnalyticsReportSegments(instanceId: string): Promise<AnalyticsReportSegmentResource[]> {
    const appleResources = await this.client.requestAll<{
      url?: string;
      checksum?: string;
      sizeInBytes?: number;
    }>(`/analyticsReportInstances/${instanceId}/segments?limit=200`);

    function flatMapSegment(segment: {
      id: string;
      attributes: { url?: string; checksum?: string; sizeInBytes?: number };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const segmentUrl = segment.attributes.url;

      if (segmentUrl == null) return [];

      const reportSegment: AnalyticsReportSegmentResource = { id: segment.id, url: segmentUrl };

      if (segment.attributes.checksum != null)
        Object.assign(reportSegment, { checksum: segment.attributes.checksum });

      if (segment.attributes.sizeInBytes != null)
        Object.assign(reportSegment, { sizeInBytes: segment.attributes.sizeInBytes });

      return [reportSegment];
    }

    return appleResources.flatMap(flatMapSegment);
  }

  async downloadAnalyticsSegment(url: string): Promise<Buffer> {
    async function retryAppleTransportRequestPiece() {
      const appleResponse = await fetch(url);

      if (!appleResponse.ok) {
        throw new AscRequestError(
          `Analytics segment download failed (${appleResponse.status}).`,
          appleResponse.status,
        );
      }

      return Buffer.from(await appleResponse.arrayBuffer());
    }

    return retryAppleTransportRequest(retryAppleTransportRequestPiece, {
      isRetryableFailure: isRetryableIdempotentFailure,
    });
  }

  private async getReportBytes(pathOrUrl: string): Promise<Buffer> {
    return retryAppleTransportRequest(() => this.getReportBytesOnce(pathOrUrl), {
      isRetryableFailure: isRetryableIdempotentFailure,
    });
  }

  private async getReportBytesOnce(pathOrUrl: string): Promise<Buffer> {
    let url = pathOrUrl;

    if (!pathOrUrl.startsWith('http')) url = `${BASE_URL}${pathOrUrl}`;

    const appleResponse = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${await this.client.token()}`,
        Accept: 'application/a-gzip, application/json',
      },
    });

    if (!appleResponse.ok) {
      const text = await appleResponse.text();
      const errors = describeErrors(text);
      const errorCodes = parseErrorCodes(text);

      throw new AscRequestError(
        `App Store Connect GET ${pathOrUrl} failed (${appleResponse.status}): ${errors}`,
        appleResponse.status,
        errorCodes,
      );
    }

    return Buffer.from(await appleResponse.arrayBuffer());
  }
}
