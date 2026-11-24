import { gzipSync } from 'node:zlib';
import { vi } from 'vitest';
import type { AppStoreStatsClient } from '../stats/stats-credentials.ts';
import type {
  AnalyticsReportInstanceResource,
  AnalyticsReportRequestResource,
  AnalyticsReportResource,
  AnalyticsReportSegmentResource,
} from '../types/apple/analytics.ts';
import type { CustomerReviewResource } from '../types/apple/customer-reviews.ts';
import type { SalesReportQuery } from '../types/apple/reporting.ts';

interface FakeAnalyticsInstance {
  readonly processingDate: string;
  readonly segmentTsvs: readonly string[];
}

type FakeFailureMethod = 'getSalesReport' | 'listAnalyticsReportRequests' | 'listCustomerReviews';

export interface FakeAppStoreStatsScenario {
  /** Sales Report TSV by report date; a date that is not listed answers 404 like Apple does. */
  readonly salesTsvByDate: Readonly<Record<string, string>>;
  /** Keyed by access type, a pipe, and the report name. A missing key does not exist yet. */
  readonly analyticsInstances: Readonly<Record<string, readonly FakeAnalyticsInstance[]>>;
  readonly reviewRatings: readonly number[];
  readonly failure: { readonly method: FakeFailureMethod; readonly status: number } | null;
}

const SEGMENT_URL_PREFIX = 'https://segments.test/';
const missingSalesStatus = 404;

const EMPTY_SCENARIO: FakeAppStoreStatsScenario = {
  salesTsvByDate: {},
  analyticsInstances: {},
  reviewRatings: [],
  failure: null,
};

interface FakeAppStoreStatsCalls {
  readonly getSalesReport: AppStoreStatsClient['getSalesReport'];
  readonly listAnalyticsReportRequests: AppStoreStatsClient['listAnalyticsReportRequests'];
  readonly createAnalyticsReportRequest: AppStoreStatsClient['createAnalyticsReportRequest'];
  readonly listAnalyticsReports: AppStoreStatsClient['listAnalyticsReports'];
  readonly listAnalyticsReportInstances: AppStoreStatsClient['listAnalyticsReportInstances'];
  readonly listAnalyticsReportSegments: AppStoreStatsClient['listAnalyticsReportSegments'];
  readonly downloadAnalyticsSegment: AppStoreStatsClient['downloadAnalyticsSegment'];
  readonly listCustomerReviews: AppStoreStatsClient['listCustomerReviews'];
}

function isMissing(candidate: unknown): candidate is null | undefined {
  return candidate == null;
}

function gzipTsv(tsv: string): Buffer {
  const tsvBytes = Buffer.from(tsv);

  return gzipSync(tsvBytes);
}

function readPart(parts: readonly string[], index: number): string {
  const part = parts[index];

  if (isMissing(part)) {
    return '';
  }

  return part;
}

function throwTransport(message: string, status: number): never {
  throw { _tag: 'AppleTransportFailure', message, status };
}

/** A tab-separated report from a header line and its lines, as Apple writes them. */
export function createTsv(
  headers: readonly string[],
  lines: readonly (readonly string[])[],
): string {
  function joinLine(line: readonly string[]): string {
    return line.join('\t');
  }

  const reportLines = [headers, ...lines];
  const joinedLines = reportLines.map(joinLine);

  return joinedLines.join('\n');
}

function readSalesTsvByDate(
  scenario: Partial<FakeAppStoreStatsScenario>,
): FakeAppStoreStatsScenario['salesTsvByDate'] {
  const salesTsvByDate = scenario.salesTsvByDate;

  if (isMissing(salesTsvByDate)) {
    return EMPTY_SCENARIO.salesTsvByDate;
  }

  return salesTsvByDate;
}

function readAnalyticsInstances(
  scenario: Partial<FakeAppStoreStatsScenario>,
): FakeAppStoreStatsScenario['analyticsInstances'] {
  const analyticsInstances = scenario.analyticsInstances;

  if (isMissing(analyticsInstances)) {
    return EMPTY_SCENARIO.analyticsInstances;
  }

  return analyticsInstances;
}

function readReviewRatings(
  scenario: Partial<FakeAppStoreStatsScenario>,
): FakeAppStoreStatsScenario['reviewRatings'] {
  const reviewRatings = scenario.reviewRatings;

  if (isMissing(reviewRatings)) {
    return EMPTY_SCENARIO.reviewRatings;
  }

  return reviewRatings;
}

function readFailure(
  scenario: Partial<FakeAppStoreStatsScenario>,
): FakeAppStoreStatsScenario['failure'] {
  const failure = scenario.failure;

  if (isMissing(failure)) {
    return EMPTY_SCENARIO.failure;
  }

  return failure;
}

/** An App Store Connect client that serves the scenario's reports and records every call. */
export function makeFakeAppStoreStatsClient(scenario: Partial<FakeAppStoreStatsScenario> = {}): {
  readonly client: AppStoreStatsClient;
  readonly calls: FakeAppStoreStatsCalls;
} {
  const salesTsvByDate = readSalesTsvByDate(scenario);
  const analyticsInstances = readAnalyticsInstances(scenario);
  const reviewRatings = readReviewRatings(scenario);
  const failure = readFailure(scenario);

  function throwWhenDenied(method: FakeFailureMethod): void {
    if (isMissing(failure)) {
      return;
    }

    const isAnotherMethod = failure.method != method;

    if (isAnotherMethod) {
      return;
    }

    throwTransport('denied', failure.status);
  }

  function findInstances(accessType: string, reportName: string): readonly FakeAnalyticsInstance[] {
    const instances = analyticsInstances[`${accessType}|${reportName}`];

    if (isMissing(instances)) {
      return [];
    }

    return instances;
  }

  function findInstance(
    accessType: string,
    reportName: string,
    processingDate: string,
  ): FakeAnalyticsInstance | undefined {
    const instances = findInstances(accessType, reportName);

    function isSameDate(candidate: FakeAnalyticsInstance): boolean {
      return candidate.processingDate == processingDate;
    }

    return instances.find(isSameDate);
  }

  function readReportName(filters: { readonly name?: string } | undefined): string {
    if (isMissing(filters)) {
      return '';
    }

    const reportName = filters.name;

    if (isMissing(reportName)) {
      return '';
    }

    return reportName;
  }

  async function readSalesReport(query: SalesReportQuery): Promise<Buffer> {
    throwWhenDenied('getSalesReport');

    const tsv = salesTsvByDate[query.reportDate];

    if (isMissing(tsv)) {
      throwTransport('no sales', missingSalesStatus);
    }

    return gzipTsv(tsv);
  }

  async function listRequests(
    _appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource[]> {
    throwWhenDenied('listAnalyticsReportRequests');

    return [{ id: `request|${accessType}`, accessType, stoppedDueToInactivity: false }];
  }

  async function createRequest(
    _appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource> {
    return { id: `request|${accessType}`, accessType };
  }

  async function listReports(
    requestId: string,
    filters?: { readonly category?: string; readonly name?: string },
  ): Promise<AnalyticsReportResource[]> {
    const requestParts = requestId.split('|');
    const accessType = readPart(requestParts, 1);
    const reportName = readReportName(filters);
    const reportKey = `${accessType}|${reportName}`;
    const doesReportExist = reportKey in analyticsInstances;

    const isReportMissing = doesReportExist == false;

    if (isReportMissing) {
      return [];
    }

    return [{ id: `report|${accessType}|${reportName}`, name: reportName }];
  }

  async function listInstances(reportId: string): Promise<AnalyticsReportInstanceResource[]> {
    const reportParts = reportId.split('|');
    const accessType = readPart(reportParts, 1);
    const reportName = readPart(reportParts, 2);
    const instances = findInstances(accessType, reportName);

    function readInstance(instance: FakeAnalyticsInstance): AnalyticsReportInstanceResource {
      return {
        id: `instance|${accessType}|${reportName}|${instance.processingDate}`,
        granularity: 'DAILY',
        processingDate: instance.processingDate,
      };
    }

    return instances.map(readInstance);
  }

  async function listSegments(instanceId: string): Promise<AnalyticsReportSegmentResource[]> {
    const instanceParts = instanceId.split('|');
    const accessType = readPart(instanceParts, 1);
    const reportName = readPart(instanceParts, 2);
    const processingDate = readPart(instanceParts, 3);
    const instance = findInstance(accessType, reportName, processingDate);

    if (isMissing(instance)) {
      return [];
    }

    function readSegment(_segmentTsv: string, index: number): AnalyticsReportSegmentResource {
      return { id: `segment-${index}`, url: `${SEGMENT_URL_PREFIX}${instanceId}|${index}` };
    }

    return instance.segmentTsvs.map(readSegment);
  }

  async function downloadSegment(url: string): Promise<Buffer> {
    const segmentPath = url.replace(SEGMENT_URL_PREFIX, '');
    const segmentParts = segmentPath.split('|');
    const accessType = readPart(segmentParts, 1);
    const reportName = readPart(segmentParts, 2);
    const processingDate = readPart(segmentParts, 3);
    const indexPart = readPart(segmentParts, 4);
    const instance = findInstance(accessType, reportName, processingDate);

    if (isMissing(instance)) {
      throw new Error(`Unknown segment ${url}`);
    }

    const segmentIndex = Number(indexPart);
    const tsv = instance.segmentTsvs[segmentIndex];

    if (isMissing(tsv)) {
      throw new Error(`Unknown segment ${url}`);
    }

    return gzipTsv(tsv);
  }

  async function listReviews(_appId: string): Promise<CustomerReviewResource[]> {
    throwWhenDenied('listCustomerReviews');

    function readReview(rating: number, index: number): CustomerReviewResource {
      return { id: `review-${index}`, rating, answered: false };
    }

    return reviewRatings.map(readReview);
  }

  const calls: FakeAppStoreStatsCalls = {
    getSalesReport: vi.fn(readSalesReport),
    listAnalyticsReportRequests: vi.fn(listRequests),
    createAnalyticsReportRequest: vi.fn(createRequest),
    listAnalyticsReports: vi.fn(listReports),
    listAnalyticsReportInstances: vi.fn(listInstances),
    listAnalyticsReportSegments: vi.fn(listSegments),
    downloadAnalyticsSegment: vi.fn(downloadSegment),
    listCustomerReviews: vi.fn(listReviews),
  };

  return { client: calls, calls };
}
