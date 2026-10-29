import { gzipSync } from 'node:zlib';
import { Effect } from 'effect';
import { vi } from 'vitest';
import type { EffectAppStoreConnectClient } from '../core/services/appleStoreClient.js';

export interface FakeAnalyticsInstance {
  readonly processingDate: string;
  readonly segmentTsvs: readonly string[];
}

export type FakeFailureMethod =
  | 'getSalesReport'
  | 'listAnalyticsReportRequests'
  | 'listCustomerReviews';

export interface FakeAppStoreStatsScenario {
  /** Sales Report TSV by report date; a date that is not listed answers 404 like Apple does. */
  readonly salesTsvByDate: Readonly<Record<string, string>>;
  /** Instances by `<ONGOING|ONE_TIME_SNAPSHOT>|<report name>`; a report that is not listed does not exist yet. */
  readonly analyticsInstances: Readonly<Record<string, readonly FakeAnalyticsInstance[]>>;
  readonly reviewRatings: readonly number[];
  readonly failure: { readonly method: FakeFailureMethod; readonly status: number } | null;
}

export const gzipTsv = (tsv: string): Buffer => gzipSync(Buffer.from(tsv));

/** A tab-separated report from a header line and its lines, as Apple writes them. */
export const createTsv = (
  headers: readonly string[],
  lines: readonly (readonly string[])[],
): string => [headers, ...lines].map((line) => line.join('\t')).join('\n');

const SEGMENT_URL_PREFIX = 'https://segments.test/';

const failWithStatus = (message: string, status: number) =>
  Effect.fail({ _tag: 'AppleTransportFailure', message, status });

/** An App Store Connect client that serves the scenario's reports and records every call. */
export const makeFakeAppStoreStatsClient = (scenario: Partial<FakeAppStoreStatsScenario> = {}) => {
  const salesTsvByDate = scenario.salesTsvByDate ?? {};
  const analyticsInstances = scenario.analyticsInstances ?? {};
  const reviewRatings = scenario.reviewRatings ?? [];
  const failure = scenario.failure ?? null;
  const isFailing = (method: FakeFailureMethod): boolean =>
    failure !== null && failure.method === method;
  const failingStatus = failure === null ? 0 : failure.status;
  const findInstances = (accessType: string, reportName: string) =>
    analyticsInstances[`${accessType}|${reportName}`] ?? [];

  const getSalesReport = vi.fn((query: { readonly reportDate: string }) => {
    if (isFailing('getSalesReport')) return failWithStatus('denied', failingStatus);
    const tsv = salesTsvByDate[query.reportDate];
    if (tsv === undefined) return failWithStatus('no sales', 404);
    return Effect.succeed(gzipTsv(tsv));
  });
  const listAnalyticsReportRequests = vi.fn((_appId: string, accessType: string) => {
    if (isFailing('listAnalyticsReportRequests')) return failWithStatus('denied', failingStatus);
    return Effect.succeed([
      { id: `request|${accessType}`, accessType, stoppedDueToInactivity: false },
    ]);
  });
  const createAnalyticsReportRequest = vi.fn((_appId: string, accessType: string) =>
    Effect.succeed({ id: `request|${accessType}`, accessType }),
  );
  const listAnalyticsReports = vi.fn((requestId: string, filters: { readonly name?: string }) => {
    const accessType = requestId.split('|')[1] ?? '';
    const reportName = filters.name ?? '';
    const doesReportExist = `${accessType}|${reportName}` in analyticsInstances;
    if (!doesReportExist) return Effect.succeed([]);
    return Effect.succeed([{ id: `report|${accessType}|${reportName}`, name: reportName }]);
  });
  const listAnalyticsReportInstances = vi.fn((reportId: string) => {
    const [, accessType = '', reportName = ''] = reportId.split('|');
    const instances = findInstances(accessType, reportName);
    return Effect.succeed(
      instances.map((instance) => ({
        id: `instance|${accessType}|${reportName}|${instance.processingDate}`,
        granularity: 'DAILY',
        processingDate: instance.processingDate,
      })),
    );
  });
  const listAnalyticsReportSegments = vi.fn((instanceId: string) => {
    const [, accessType = '', reportName = '', processingDate = ''] = instanceId.split('|');
    const instance = findInstances(accessType, reportName).find(
      (candidate) => candidate.processingDate === processingDate,
    );
    const segmentTsvs = instance === undefined ? [] : instance.segmentTsvs;
    return Effect.succeed(
      segmentTsvs.map((_tsv, index) => ({
        id: `segment-${index}`,
        url: `${SEGMENT_URL_PREFIX}${instanceId}|${index}`,
      })),
    );
  });
  const downloadAnalyticsSegment = vi.fn((url: string) => {
    const [, accessType = '', reportName = '', processingDate = '', index = '0'] = url
      .replace(SEGMENT_URL_PREFIX, '')
      .split('|');
    const instance = findInstances(accessType, reportName).find(
      (candidate) => candidate.processingDate === processingDate,
    );
    const tsv = instance === undefined ? undefined : instance.segmentTsvs[Number(index)];
    if (tsv === undefined) return Effect.die(new Error(`Unknown segment ${url}`));
    return Effect.succeed(gzipTsv(tsv));
  });
  const listCustomerReviews = vi.fn((_appId: string) => {
    if (isFailing('listCustomerReviews')) return failWithStatus('denied', failingStatus);
    return Effect.succeed(
      reviewRatings.map((rating, index) => ({ id: `review-${index}`, rating, answered: false })),
    );
  });

  const calls = {
    getSalesReport,
    listAnalyticsReportRequests,
    createAnalyticsReportRequest,
    listAnalyticsReports,
    listAnalyticsReportInstances,
    listAnalyticsReportSegments,
    downloadAnalyticsSegment,
    listCustomerReviews,
  };
  return { client: calls as unknown as EffectAppStoreConnectClient, calls };
};
