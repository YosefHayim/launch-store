import { Effect } from 'effect';
import { describe, expect, test } from 'vitest';
import { makeHttpClientTest } from '@testkit/httpClient.testkit.js';
import {
  createTsv,
  makeFakeAppStoreStatsClient,
  type FakeAppStoreStatsScenario,
} from '@testkit/appStoreStatsClient.testkit.js';
import type { PortfolioApp } from '../../types/portfolio.js';
import type { DailyStat, DateRange } from '../../types/stats.js';
import { makeStatsCredentialsTest, StatsCredentials } from '../statsCredentials.js';
import {
  appStoreFeed,
  createAppStoreReply,
  isHistoryNeeded,
  pickStatsPath,
  readHttpStatus,
} from './appStore.js';

const APP_ID = '6802289557';
const SHORT_RANGE: DateRange = { from: '2026-10-08', to: '2026-10-10' };
const DISCOVERY_NAME = 'App Store Discovery and Engagement Standard';
const DOWNLOADS_NAME = 'App Downloads Standard';
const PURCHASES_NAME = 'App Store Purchases Standard';

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

const fetchReply = async (
  scenario: Partial<FakeAppStoreStatsScenario>,
  vendorNumber: string | null,
  range: DateRange = SHORT_RANGE,
  app: PortfolioApp = makeApp(),
) => {
  const fake = makeFakeAppStoreStatsClient(scenario);
  const credentials = await Effect.runPromise(
    StatsCredentials.pipe(
      Effect.provide(
        makeStatsCredentialsTest({
          ascClientForAccount: () => Effect.succeed(fake.client),
          vendorNumberForAccount: () => Effect.succeed(vendorNumber),
        }),
      ),
    ),
  );
  const reply = await Effect.runPromise(
    appStoreFeed
      .fetchDays({ app, range, credentials })
      .pipe(Effect.either, Effect.provide(makeHttpClientTest([]))),
  );
  return { reply, calls: fake.calls };
};

const readFetched = (reply: Awaited<ReturnType<typeof fetchReply>>['reply']) => {
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
      'sales',
      request,
    );

    expect(reply).toEqual({
      status: 'fetched',
      stats: [salesStat],
      coveredThrough: '2026-10-09',
      notes: [],
    });
  });

  test('skips with the preparing reason when analytics has no data on the analytics path', () => {
    const reply = createAppStoreReply(
      { salesStats: [], analyticsSummary: { stats: [], latestDate: null }, ratingStats: [] },
      'analytics',
      request,
    );

    expect(reply).toEqual({
      status: 'skipped',
      reason: 'Apple is preparing analytics reports for Calfriend; first data within 1-2 days',
    });
  });

  test('keeps the sales stats but leaves the days uncovered on the sales path', () => {
    const reply = createAppStoreReply(
      {
        salesStats: [salesStat],
        analyticsSummary: { stats: [], latestDate: null },
        ratingStats: [],
      },
      'sales',
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
    const credentials = await Effect.runPromise(
      StatsCredentials.pipe(Effect.provide(makeStatsCredentialsTest())),
    );

    const reply = await Effect.runPromise(
      appStoreFeed
        .fetchDays({ app: makeApp(), range: SHORT_RANGE, credentials })
        .pipe(Effect.provide(makeHttpClientTest([]))),
    );

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
          [`ONGOING|${DOWNLOADS_NAME}`]: [
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
          [`ONGOING|${PURCHASES_NAME}`]: [
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
