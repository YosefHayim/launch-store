// Docs: https://developer.apple.com/documentation/appstoreconnectapi/analytics
import type {
  AnalyticsReportInstanceResource,
  AnalyticsReportRequestResource,
  AnalyticsReportResource,
  AnalyticsReportSegmentResource,
} from '@core/types/appleCatalog.js';
import {
  type AppStoreConnectRequests,
  isRetryableIdempotentFailure,
  makeAscRequestError,
  retryAppleTransportRequest,
} from '@/app-store-connect-api/api-client.js';
/** Project an ASC `analyticsReportRequests` resource object into an {@link AnalyticsReportRequestResource}. */
const toReportRequest = (
  entry: {
    id: string;
    attributes: {
      accessType?: string;
      stoppedDueToInactivity?: boolean;
    };
  },
  fallbackAccessType: string,
): AnalyticsReportRequestResource => {
  let accessType = entry.attributes.accessType;
  if (accessType === undefined) accessType = fallbackAccessType;
  const reportRequest: AnalyticsReportRequestResource = {
    id: entry.id,
    accessType,
  };
  if (entry.attributes.stoppedDueToInactivity !== undefined)
    Object.assign(reportRequest, {
      stoppedDueToInactivity: entry.attributes.stoppedDueToInactivity,
    });
  return reportRequest;
};
export const makeAnalyticsApi = (api: AppStoreConnectRequests) => {
  /** List an app's analytics report requests of one access type (`ONGOING` / `ONE_TIME_SNAPSHOT`). */
  const listAnalyticsReportRequests = async (
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource[]> => {
    const appleResources = await api.requestAll<{
      accessType?: string;
      stoppedDueToInactivity?: boolean;
    }>(`/apps/${appId}/analyticsReportRequests?filter[accessType]=${accessType}&limit=200`);
    return appleResources.map((entry) => toReportRequest(entry, accessType));
  };
  /**
   * Create an analytics report request for an app. Creating a brand-new report type for the first time
   * needs the Admin role - a non-Admin key returns 403, which `launch reports` surfaces actionably.
   */
  const createAnalyticsReportRequest = async (
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource> => {
    const appleResources = await api.createResource<{
      accessType?: string;
      stoppedDueToInactivity?: boolean;
    }>('/analyticsReportRequests', {
      type: 'analyticsReportRequests',
      attributes: { accessType },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    return toReportRequest(appleResources, accessType);
  };
  /** List the reports available within a request, optionally filtered by category or exact name. */
  const listAnalyticsReports = async (
    requestId: string,
    filters: {
      category?: string;
      name?: string;
    } = {},
  ): Promise<AnalyticsReportResource[]> => {
    let path = `/analyticsReportRequests/${requestId}/reports?limit=200`;
    if (filters.category) path += `&filter[category]=${filters.category}`;
    if (filters.name) path += `&filter[name]=${encodeURIComponent(filters.name)}`;
    const appleResources = await api.requestAll<{
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
  };
  /** List a report's time-period instances, optionally filtered by granularity / processing date. */
  const listAnalyticsReportInstances = async (
    reportId: string,
    filters: {
      granularity?: string;
      processingDate?: string;
    } = {},
  ): Promise<AnalyticsReportInstanceResource[]> => {
    let path = `/analyticsReports/${reportId}/instances?limit=200`;
    if (filters.granularity) path += `&filter[granularity]=${filters.granularity}`;
    if (filters.processingDate) path += `&filter[processingDate]=${filters.processingDate}`;
    const appleResources = await api.requestAll<{
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
  };
  /** List the downloadable segments of a report instance (each a presigned URL to a gzipped TSV). */
  const listAnalyticsReportSegments = async (
    instanceId: string,
  ): Promise<AnalyticsReportSegmentResource[]> => {
    const appleResources = await api.requestAll<{
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
  };
  /**
   * Download an analytics segment's gzipped body from its presigned URL. The URL carries its own
   * query-string auth, so this is an UNauthenticated fetch - adding the API Bearer would make the
   * storage backend reject the request for presenting two auth mechanisms.
   */
  const downloadAnalyticsSegment = async (url: string): Promise<Buffer> => {
    return retryAppleTransportRequest(
      async () => {
        const appleResponse = await fetch(url);
        if (!appleResponse.ok) {
          throw makeAscRequestError(
            `Analytics segment download failed (${appleResponse.status}).`,
            appleResponse.status,
          );
        }
        return Buffer.from(await appleResponse.arrayBuffer());
      },
      { isRetryableFailure: isRetryableIdempotentFailure },
    );
  };
  return {
    listAnalyticsReportRequests,
    createAnalyticsReportRequest,
    listAnalyticsReports,
    listAnalyticsReportInstances,
    listAnalyticsReportSegments,
    downloadAnalyticsSegment,
  };
};
