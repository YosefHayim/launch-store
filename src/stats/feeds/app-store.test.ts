import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createTsv } from '../../testkit/app-store-stats-client.testkit.ts';
import type { PortfolioApp } from '../../types/portfolio.ts';
import type { DailyStat, DateRange, FeedFetchReply } from '../../types/stats.ts';
import type { AppStoreStatsClient } from '../stats-credentials.ts';
import { makeStatsCredentialsTest, useStatsCredentials } from '../stats-credentials.ts';
import {
  appStoreFeed,
  createAppStoreReply,
  isHistoryNeeded,
  pickStatsPath,
  readHttpStatus,
} from './app-store.ts';

const APP_ID = '6802289557';
const SHORT_RANGE: DateRange = { from: '2026-10-08', to: '2026-10-10' };
const DISCOVERY_NAME = 'App Store Discovery and Engagement Standard';
const SEGMENT_URL_PREFIX = 'https://segments.test/';

const SALES_HEADERS = [
  'Apple Identifier',
  'SKU',
  'Parent Identifier',
  'Product Type Identifier',
  'Units',
  'Developer Proceeds',
  'Currency of Proceeds',
];
const DISCOVERY_HEADERS = ['Date', 'App Apple Identifier', 'Event', 'Counts', 'Unique Counts'];
const DOWNLOADS_HEADERS = ['Date', 'App Apple Identifier', 'Download Type', 'Counts'];
const PURCHASES_HEADERS = ['Date', 'App Apple Identifier', 'Purchases', 'Proceeds in USD'];

interface FakeAnalyticsInstance {
  readonly processingDate: string;
  readonly segmentTsvs: readonly string[];
}

type FakeFailureMethod = 'getSalesReport' | 'listAnalyticsReportRequests' | 'listCustomerReviews';

interface FakeAppStoreStatsScenario {
  readonly salesTsvByDate: Readonly<Record<string, string>>;
  readonly analyticsInstances: Readonly<Record<string, readonly FakeAnalyticsInstance[]>>;
  readonly reviewRatings: readonly number[];
  readonly failure: { readonly method: FakeFailureMethod; readonly status: number } | null;
}

const EMPTY_SCENARIO: FakeAppStoreStatsScenario = {
  salesTsvByDate: {},
  analyticsInstances: {},
  reviewRatings: [],
  failure: null,
};

type FeedOutcome =
  | { readonly _tag: 'Right'; readonly right: FeedFetchReply }
  | { readonly _tag: 'Left'; readonly left: unknown };

function throwTransport(message: string, status: number): never {
  throw { _tag: 'AppleTransportFailure', message, status };
}

function makePromiseAppStoreClient(scenario: Partial<FakeAppStoreStatsScenario> = {}) {
  const filled: FakeAppStoreStatsScenario = { ...EMPTY_SCENARIO, ...scenario };
  const { salesTsvByDate, analyticsInstances, reviewRatings, failure } = filled;

  function isFailing(method: FakeFailureMethod): boolean {
    if (failure == null) {
      return false;
    }

    return failure.method == method;
  }

  function findInstances(accessType: string, reportName: string): readonly FakeAnalyticsInstance[] {
    const instances = analyticsInstances[`${accessType}|${reportName}`];

    if (instances == undefined) {
      return [];
    }

    return instances;
  }

  const getSalesReport = vi.fn(async function readSalesReport(query: {
    readonly reportDate: string;
  }) {
    if (isFailing('getSalesReport')) {
      throwTransport('denied', failure?.status ?? 0);
    }

    const tsv = salesTsvByDate[query.reportDate];

    if (tsv == undefined) {
      throwTransport('no sales', 404);
    }

    return gzipSync(Buffer.from(tsv));
  });
  const listAnalyticsReportRequests = vi.fn(async function listRequests(
    _appId: string,
    accessType: string,
  ) {
    if (isFailing('listAnalyticsReportRequests')) {
      throwTransport('denied', failure?.status ?? 0);
    }

    return [{ id: `request|${accessType}`, accessType, stoppedDueToInactivity: false }];
  });
  const createAnalyticsReportRequest = vi.fn(async function createRequest(
    _appId: string,
    accessType: string,
  ) {
    return { id: `request|${accessType}`, accessType };
  });
  const listAnalyticsReports = vi.fn(async function listReports(
    requestId: string,
    filters?: { readonly name?: string },
  ) {
    const requestParts = requestId.split('|');
    const accessType = requestParts[1] ?? '';
    const reportName = filters?.name ?? '';
    const reportKey = `${accessType}|${reportName}`;
    const doesReportExist = reportKey in analyticsInstances;

    if (doesReportExist == false) {
      return [];
    }

    return [{ id: `report|${accessType}|${reportName}`, name: reportName }];
  });
  const listAnalyticsReportInstances = vi.fn(async function listInstances(reportId: string) {
    const reportParts = reportId.split('|');
    const accessType = reportParts[1] ?? '';
    const reportName = reportParts[2] ?? '';
    const instances = findInstances(accessType, reportName);

    return instances.map(function readInstance(instance: FakeAnalyticsInstance) {
      return {
        id: `instance|${accessType}|${reportName}|${instance.processingDate}`,
        granularity: 'DAILY',
        processingDate: instance.processingDate,
      };
    });
  });
  const listAnalyticsReportSegments = vi.fn(async function listSegments(instanceId: string) {
    const instanceParts = instanceId.split('|');
    const accessType = instanceParts[1] ?? '';
    const reportName = instanceParts[2] ?? '';
    const processingDate = instanceParts[3] ?? '';
    const instance = findInstances(accessType, reportName).find(function sameDate(candidate) {
      return candidate.processingDate == processingDate;
    });

    if (instance == undefined) {
      return [];
    }

    return instance.segmentTsvs.map(function readSegment(_tsv: string, index: number) {
      return { id: `segment-${index}`, url: `${SEGMENT_URL_PREFIX}${instanceId}|${index}` };
    });
  });
  const downloadAnalyticsSegment = vi.fn(async function downloadSegment(url: string) {
    const segmentParts = url.replace(SEGMENT_URL_PREFIX, '').split('|');
    const accessType = segmentParts[1] ?? '';
    const reportName = segmentParts[2] ?? '';
    const processingDate = segmentParts[3] ?? '';
    const index = segmentParts[4] ?? '0';
    const instance = findInstances(accessType, reportName).find(function sameDate(candidate) {
      return candidate.processingDate == processingDate;
    });

    if (instance == undefined) {
      throw new Error(`Unknown segment ${url}`);
    }

    const tsv = instance.segmentTsvs[Number(index)];

    if (tsv == undefined) {
      throw new Error(`Unknown segment ${url}`);
    }

    return gzipSync(Buffer.from(tsv));
  });
  const listCustomerReviews = vi.fn(async function listReviews(_appId: string) {
    if (isFailing('listCustomerReviews')) {
      throwTransport('denied', failure?.status ?? 0);
    }

    return reviewRatings.map(function readReview(rating: number, index: number) {
      return { id: `review-${index}`, rating, answered: false };
    });
  });
  const client: AppStoreStatsClient = {
    getSalesReport,
    listAnalyticsReportRequests,
    createAnalyticsReportRequest,
    listAnalyticsReports,
    listAnalyticsReportInstances,
    listAnalyticsReportSegments,
    downloadAnalyticsSegment,
    listCustomerReviews,
  };

  return {
    client,
    calls: {
      getSalesReport,
      listAnalyticsReportRequests,
      createAnalyticsReportRequest,
      listAnalyticsReports,
      listAnalyticsReportInstances,
      listAnalyticsReportSegments,
      downloadAnalyticsSegment,
      listCustomerReviews,
    },
  };
}

const makeApp = (fields: Partial<PortfolioApp> = {}): PortfolioApp => ({
  key: `ios-${APP_ID}`,
  platform: 'ios',
  storeId: APP_ID,
  name: 'Calfriend',
  bundleId: 'com.calfriend',
  packageName: null,
  accountKeyId: 'KEY1',
  accountLabel: 'alpha',
  owner: null,
  ga4PropertyId: null,
  ...fields,
});

afterEach(() => {
  useStatsCredentials(null);
});

const fetchReply = async (
  scenario: Partial<FakeAppStoreStatsScenario>,
  vendorNumber: string | null,
  range: DateRange = SHORT_RANGE,
  app: PortfolioApp = makeApp(),
) => {
  const fake = makePromiseAppStoreClient(scenario);
  const credentials = makeStatsCredentialsTest({
    async ascClientForAccount() {
      return fake.client;
    },
    async vendorNumberForAccount() {
      return vendorNumber;
    },
  });

  try {
    const right = await appStoreFeed.fetchDays({ app, range, credentials });

    return { reply: { _tag: 'Right', right } satisfies FeedOutcome, calls: fake.calls };
  } catch (left) {
    return { reply: { _tag: 'Left', left } satisfies FeedOutcome, calls: fake.calls };
  }
};

const readFetched = (reply: FeedOutcome) => {
  if (reply._tag !== 'Right') throw new Error('expected a reply');
  if (reply.right.status !== 'fetched') throw new Error('expected a fetched reply');
  return reply.right;
};

const findStat = (stats: readonly DailyStat[], metric: string, date: string) =>
  stats.find((stat) => stat.metric === metric && stat.date === date);

describe('pickStatsPath', () => {
  test('picks sales reports when the account has a vendor number', () => {
    expect(pickStatsPath('90000001')).toBe('sales');
  });

  test('picks analytics reports when it has none', () => {
    expect(pickStatsPath(null)).toBe('analytics');
  });
});

describe('isHistoryNeeded', () => {
  test('is true when the range reaches past the refresh tail', () => {
    expect(isHistoryNeeded({ from: '2026-09-01', to: '2026-10-10' })).toBe(true);
  });

  test('is false for a short range', () => {
    expect(isHistoryNeeded(SHORT_RANGE)).toBe(false);
  });
});

describe('readHttpStatus', () => {
  test('reads the status of a transport failure', () => {
    expect(readHttpStatus({ status: 403 })).toBe(403);
  });

  test('is null for anything without a numeric status', () => {
    expect(readHttpStatus(null)).toBeNull();
    expect(readHttpStatus('boom')).toBeNull();
    expect(readHttpStatus({ message: 'boom' })).toBeNull();
    expect(readHttpStatus({ status: '403' })).toBeNull();
  });
});

describe('createAppStoreReply', () => {
  const request = { app: makeApp(), range: SHORT_RANGE, credentials: null as never };
  const salesStat: DailyStat = {
    date: '2026-10-09',
    feed: 'app-store',
    metric: 'downloads',
    value: 2,
    currency: null,
  };

  test('covers through the latest analytics date', () => {
    const reply = createAppStoreReply(
      {
        salesStats: [salesStat],
        analyticsSummary: { stats: [], latestDate: '2026-10-09' },
        ratingStats: [],
      },
      request,
    );

    expect(reply).toEqual({
      status: 'fetched',
      stats: [salesStat],
      coveredThrough: '2026-10-09',
      notes: [],
    });
  });

  test('skips with the preparing reason when there are no stats at all', () => {
    const reply = createAppStoreReply(
      { salesStats: [], analyticsSummary: { stats: [], latestDate: null }, ratingStats: [] },
      request,
    );

    expect(reply).toEqual({
      status: 'skipped',
      reason: 'Apple is preparing analytics reports for Calfriend; first data within 1-2 days',
    });
  });

  test('keeps the rating stats but leaves the days uncovered while analytics are prepared', () => {
    const ratingStat: DailyStat = { ...salesStat, metric: 'ratingAverage', value: 4.5 };
    const reply = createAppStoreReply(
      {
        salesStats: [],
        analyticsSummary: { stats: [], latestDate: null },
        ratingStats: [ratingStat],
      },
      request,
    );

    expect(reply).toEqual({
      status: 'fetched',
      stats: [ratingStat],
      coveredThrough: '2026-10-07',
      notes: ['Apple is preparing analytics reports for Calfriend; first data within 1-2 days'],
    });
  });

  test('keeps the sales stats but leaves the days uncovered', () => {
    const reply = createAppStoreReply(
      {
        salesStats: [salesStat],
        analyticsSummary: { stats: [], latestDate: null },
        ratingStats: [],
      },
      request,
    );

    expect(reply).toEqual({
      status: 'fetched',
      stats: [salesStat],
      coveredThrough: '2026-10-07',
      notes: ['Apple is preparing analytics reports for Calfriend; first data within 1-2 days'],
    });
  });
});

describe('appStoreFeed', () => {
  test('applies to iOS apps only', () => {
    expect(appStoreFeed.isApplicable(makeApp())).toBe(true);
    expect(appStoreFeed.isApplicable(makeApp({ platform: 'android' }))).toBe(false);
  });

  test('skips an app with no App Store Connect account', async () => {
    const { reply } = await fetchReply({}, null, SHORT_RANGE, makeApp({ accountKeyId: null }));

    expect(reply).toMatchObject({
      _tag: 'Right',
      right: { status: 'skipped', reason: 'Calfriend has no App Store Connect account' },
    });
  });

  test('skips when the account has no saved key', async () => {
    const credentials = makeStatsCredentialsTest();
    const reply = await appStoreFeed.fetchDays({
      app: makeApp(),
      range: SHORT_RANGE,
      credentials,
    });

    expect(reply).toEqual({
      status: 'skipped',
      reason: 'No saved App Store Connect key for account alpha',
    });
  });

  test('skips with the preparing reason while Apple has no analytics instances', async () => {
    const { reply, calls } = await fetchReply(
      { analyticsInstances: { [`ONGOING|${DISCOVERY_NAME}`]: [] } },
      null,
    );

    expect(reply).toMatchObject({
      _tag: 'Right',
      right: {
        status: 'skipped',
        reason: 'Apple is preparing analytics reports for Calfriend; first data within 1-2 days',
      },
    });
    expect(calls.listCustomerReviews).toHaveBeenCalledTimes(1);
  });

  test('reads downloads, proceeds and discovery from analytics without a vendor number', async () => {
    const { reply, calls } = await fetchReply(
      {
        analyticsInstances: {
          [`ONGOING|${DISCOVERY_NAME}`]: [
            {
              processingDate: '2026-10-10',
              segmentTsvs: [
                createTsv(DISCOVERY_HEADERS, [
                  ['2026-10-09', APP_ID, 'Impression', '40', '30'],
                  ['2026-10-09', APP_ID, 'Page view', '7', '6'],
                ]),
              ],
            },
          ],
          [`ONGOING|App Downloads Standard`]: [
            {
              processingDate: '2026-10-10',
              segmentTsvs: [
                createTsv(DOWNLOADS_HEADERS, [
                  ['2026-10-09', APP_ID, 'First-time Download', '3'],
                  ['2026-10-09', APP_ID, 'Auto-update', '5'],
                ]),
              ],
            },
          ],
          [`ONGOING|App Store Purchases Standard`]: [
            {
              processingDate: '2026-10-10',
              segmentTsvs: [createTsv(PURCHASES_HEADERS, [['2026-10-09', APP_ID, '1', '4.2']])],
            },
          ],
        },
        reviewRatings: [5, 4, 4],
      },
      null,
    );

    const fetched = readFetched(reply);
    expect(fetched.coveredThrough).toBe('2026-10-09');
    expect(findStat(fetched.stats, 'impressions', '2026-10-09')?.value).toBe(40);
    expect(findStat(fetched.stats, 'productPageViews', '2026-10-09')?.value).toBe(7);
    expect(findStat(fetched.stats, 'downloads', '2026-10-09')?.value).toBe(3);
    expect(findStat(fetched.stats, 'updates', '2026-10-09')?.value).toBe(5);
    expect(findStat(fetched.stats, 'proceeds', '2026-10-09')).toMatchObject({
      value: 4.2,
      currency: 'USD',
    });
    expect(findStat(fetched.stats, 'ratingCount', '2026-10-10')?.value).toBe(3);
    expect(findStat(fetched.stats, 'ratingAverage', '2026-10-10')?.value).toBe(4.3);
    expect(calls.getSalesReport).not.toHaveBeenCalled();
    expect(calls.createAnalyticsReportRequest).not.toHaveBeenCalled();
  });

  test('reads sales reports with a vendor number, treats a 404 day as no sales and ignores other apps', async () => {
    const { reply, calls } = await fetchReply(
      {
        salesTsvByDate: {
          '2026-10-09': createTsv(SALES_HEADERS, [
            [APP_ID, 'calfriend', '', '1', '4', '0', 'USD'],
            [APP_ID, 'calfriend', '', '7', '9', '0', 'USD'],
            ['111', 'other', '', '1', '50', '0', 'USD'],
            ['111', 'other-iap', 'other', 'IA1', '2', '1', 'USD'],
            [APP_ID, 'calfriend-pro', 'calfriend', 'IA1', '2', '1.5', 'ILS'],
          ]),
        },
      },
      '90000011',
    );

    const fetched = readFetched(reply);
    expect(findStat(fetched.stats, 'downloads', '2026-10-09')?.value).toBe(4);
    expect(findStat(fetched.stats, 'updates', '2026-10-09')?.value).toBe(9);
    expect(findStat(fetched.stats, 'proceeds', '2026-10-09')).toMatchObject({
      value: 3,
      currency: 'ILS',
    });
    expect(fetched.stats.filter((stat) => stat.date === '2026-10-08')).toEqual([]);
    expect(fetched.coveredThrough).toBe('2026-10-07');
    expect(calls.getSalesReport).toHaveBeenCalledTimes(3);
  });

  test('fetches one sales report per vendor and date for every app of a sync run', async () => {
    const scenario = {
      salesTsvByDate: {
        '2026-10-09': createTsv(SALES_HEADERS, [
          [APP_ID, 'calfriend', '', '1', '4', '0', 'USD'],
          ['222', 'second', '', '1', '6', '0', 'USD'],
        ]),
      },
    };

    const firstApp = await fetchReply(scenario, '90000022');
    const secondApp = await fetchReply(
      scenario,
      '90000022',
      SHORT_RANGE,
      makeApp({ storeId: '222' }),
    );

    expect(findStat(readFetched(secondApp.reply).stats, 'downloads', '2026-10-09')?.value).toBe(6);
    expect(firstApp.calls.getSalesReport).toHaveBeenCalledTimes(3);
    expect(secondApp.calls.getSalesReport).not.toHaveBeenCalled();
  });

  test('covers through the analytics date and keeps sales stats on the sales path', async () => {
    const { reply } = await fetchReply(
      {
        salesTsvByDate: {
          '2026-10-10': createTsv(SALES_HEADERS, [[APP_ID, 'calfriend', '', '1', '1', '0', 'USD']]),
        },
        analyticsInstances: {
          [`ONGOING|${DISCOVERY_NAME}`]: [
            {
              processingDate: '2026-10-10',
              segmentTsvs: [
                createTsv(DISCOVERY_HEADERS, [['2026-10-08', APP_ID, 'Impression', '5', '5']]),
              ],
            },
          ],
        },
      },
      '90000033',
    );

    const fetched = readFetched(reply);
    expect(fetched.coveredThrough).toBe('2026-10-08');
    expect(findStat(fetched.stats, 'downloads', '2026-10-10')?.value).toBe(1);
    expect(findStat(fetched.stats, 'impressions', '2026-10-08')?.value).toBe(5);
  });

  test('reads the one-time snapshot only for a long range', async () => {
    const scenario = {
      analyticsInstances: {
        [`ONE_TIME_SNAPSHOT|${DISCOVERY_NAME}`]: [
          {
            processingDate: '2026-10-10',
            segmentTsvs: [
              createTsv(DISCOVERY_HEADERS, [['2026-09-02', APP_ID, 'Impression', '9', '9']]),
            ],
          },
        ],
        [`ONGOING|${DISCOVERY_NAME}`]: [
          {
            processingDate: '2026-10-10',
            segmentTsvs: [
              createTsv(DISCOVERY_HEADERS, [['2026-10-09', APP_ID, 'Impression', '1', '1']]),
            ],
          },
        ],
      },
    };

    const longRange = await fetchReply(scenario, null, { from: '2026-09-01', to: '2026-10-10' });
    const shortRange = await fetchReply(scenario, null);

    expect(findStat(readFetched(longRange.reply).stats, 'impressions', '2026-09-02')?.value).toBe(
      9,
    );
    expect(
      findStat(readFetched(shortRange.reply).stats, 'impressions', '2026-09-02'),
    ).toBeUndefined();
    const shortRangeAccessTypes = new Set(
      shortRange.calls.listAnalyticsReportRequests.mock.calls.map((call) => call[1]),
    );
    expect([...shortRangeAccessTypes]).toEqual(['ONGOING']);
  });

  test('skips with the role it needs when Apple answers 403', async () => {
    const { reply } = await fetchReply(
      { failure: { method: 'listAnalyticsReportRequests', status: 403 } },
      null,
    );

    expect(reply._tag).toBe('Right');
    expect(reply._tag === 'Right' && reply.right.status).toBe('skipped');
    expect(reply._tag === 'Right' && 'reason' in reply.right && reply.right.reason).toContain(
      'Admin',
    );
  });

  test('fails the feed on any other Apple failure', async () => {
    const { reply } = await fetchReply(
      { failure: { method: 'listCustomerReviews', status: 500 } },
      null,
    );

    expect(reply._tag).toBe('Left');
    expect(reply._tag === 'Left' && reply.left).toMatchObject({
      _tag: 'StatsFeedFailure',
      feed: 'app-store',
      appKey: `ios-${APP_ID}`,
    });
  });

  test('writes no rating stats when the app has no reviews', async () => {
    const { reply } = await fetchReply(
      {
        analyticsInstances: {
          [`ONGOING|${DISCOVERY_NAME}`]: [
            {
              processingDate: '2026-10-10',
              segmentTsvs: [
                createTsv(DISCOVERY_HEADERS, [['2026-10-09', APP_ID, 'Impression', '1', '1']]),
              ],
            },
          ],
        },
        reviewRatings: [0, 9],
      },
      null,
    );

    expect(readFetched(reply).stats.map((stat) => stat.metric)).toEqual(['impressions']);
  });
});
