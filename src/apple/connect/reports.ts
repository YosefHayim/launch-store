import type {
  AnalyticsReportInstanceResource,
  AnalyticsReportRequestResource,
  AnalyticsReportResource,
  AnalyticsReportSegmentResource,
  FinanceReportQuery,
  SalesReportQuery,
} from '../../types/apple-catalog.ts';
import type { AscHost } from './host.ts';
import {
  BASE_URL,
  AscRequestError,
  isRetryableIdempotentFailure,
  toReportRequest,
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
    if (query.version !== undefined) reportParameters.push(`filter[version]=${query.version}`);
    return this.getReportBytes(`/salesReports?${reportParameters.join('&')}`);
  }

  async getFinanceReport(query: FinanceReportQuery): Promise<Buffer> {
    let reportType = query.reportType;
    if (reportType === undefined) reportType = 'FINANCE_DETAIL';
    const reportParameters = [
      `filter[regionCode]=${query.regionCode}`,
      `filter[reportDate]=${query.reportDate}`,
      `filter[reportType]=${reportType}`,
      `filter[vendorNumber]=${encodeURIComponent(query.vendorNumber)}`,
    ];
    return this.getReportBytes(`/financeReports?${reportParameters.join('&')}`);
  }

  async listAnalyticsReportRequests(
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource[]> {
    const appleResources = await this.client.requestAll<{
      accessType?: string;
      stoppedDueToInactivity?: boolean;
    }>(`/apps/${appId}/analyticsReportRequests?filter[accessType]=${accessType}&limit=200`);
    return appleResources.map((entry) => toReportRequest(entry, accessType));
  }

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
    return toReportRequest(appleResources, accessType);
  }

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
    return appleResources.map((report) => {
      let reportName = report.attributes.name;
      if (reportName === undefined) reportName = '';
      const analyticsReport: AnalyticsReportResource = { id: report.id, name: reportName };
      if (report.attributes.category !== undefined)
        Object.assign(analyticsReport, { category: report.attributes.category });
      return analyticsReport;
    });
  }

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
    return appleResources.map((instance) => {
      let granularity = instance.attributes.granularity;
      if (granularity === undefined) granularity = '';
      const reportInstance: AnalyticsReportInstanceResource = { id: instance.id, granularity };
      if (instance.attributes.processingDate !== undefined)
        Object.assign(reportInstance, { processingDate: instance.attributes.processingDate });
      return reportInstance;
    });
  }

  async listAnalyticsReportSegments(instanceId: string): Promise<AnalyticsReportSegmentResource[]> {
    const appleResources = await this.client.requestAll<{
      url?: string;
      checksum?: string;
      sizeInBytes?: number;
    }>(`/analyticsReportInstances/${instanceId}/segments?limit=200`);
    return appleResources.flatMap((segment) => {
      const segmentUrl = segment.attributes.url;
      if (segmentUrl === undefined) return [];
      const reportSegment: AnalyticsReportSegmentResource = { id: segment.id, url: segmentUrl };
      if (segment.attributes.checksum !== undefined)
        Object.assign(reportSegment, { checksum: segment.attributes.checksum });
      if (segment.attributes.sizeInBytes !== undefined)
        Object.assign(reportSegment, { sizeInBytes: segment.attributes.sizeInBytes });
      return [reportSegment];
    });
  }

  async downloadAnalyticsSegment(url: string): Promise<Buffer> {
    return retryAppleTransportRequest(
      async () => {
        const appleResponse = await fetch(url);
        if (!appleResponse.ok) {
          throw new AscRequestError(
            `Analytics segment download failed (${appleResponse.status}).`,
            appleResponse.status,
          );
        }
        return Buffer.from(await appleResponse.arrayBuffer());
      },
      { isRetryableFailure: isRetryableIdempotentFailure },
    );
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
      throw new AscRequestError(
        `App Store Connect GET ${pathOrUrl} failed (${appleResponse.status}): ${describeErrors(text)}`,
        appleResponse.status,
        parseErrorCodes(text),
      );
    }
    return Buffer.from(await appleResponse.arrayBuffer());
  }
}
