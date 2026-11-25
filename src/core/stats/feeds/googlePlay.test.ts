import { Effect } from 'effect';
import { zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import { makeHttpClientTest, type HttpClientTestRoute } from '@testkit/httpClient.testkit.js';
import type { PlayReportingClient } from '@google/playReporting.js';
import type { PortfolioApp } from '../../types/portfolio.js';
import type { PlayVitalsMetric, VitalsTimeline } from '../../types/vitals.js';
import type { DailyStat, StatsCredentialsShape } from '../../types/stats.js';
import { makeStatsCredentialsTest, StatsCredentials } from '../statsCredentials.js';
import { googlePlayFeed } from './googlePlay.js';

const BUCKET = 'pubsite_prod_rev_1';
const BUCKET_URL = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o`;
const EARNINGS_LIST_URL = `${BUCKET_URL}?prefix=earnings%2Fearnings_&fields=items(name),nextPageToken`;
const RANGE = { from: '2026-10-01', to: '2026-10-20' };

const ANDROID_APP: PortfolioApp = {
  key: 'android-com.fit',
  platform: 'android',
  storeId: 'com.fit',
  name: 'Fit',
  bundleId: null,
  packageName: 'com.fit',
  accountKeyId: null,
  accountLabel: 'google-play',
  owner: null,
  ga4PropertyId: null,
};

const INSTALLS_HEADER =
  'Date,Package Name,Current Device Installs,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Current User Installs,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs';
const EARNINGS_HEADER =
  'Description,Transaction Date,Transaction Time,Tax Type,Transaction Type,Refund Type,Product Title,Package ID,Product Type,SKU ID,Hardware,Buyer Country,Buyer State,Buyer Postcode,Buyer Currency,Amount (Buyer Currency),Currency Conversion Rate,Merchant Currency,Amount (Merchant Currency)';

const encodeUtf16 = (csvDocument: string): Uint8Array =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csvDocument, 'utf16le')]);

const createVitalsTimeline = (
  metric: PlayVitalsMetric,
  endDate: string,
  rates: Readonly<Record<string, number | undefined>>,
): VitalsTimeline => ({
  metric,
  window: { startDate: '2026-09-01', endDate },
  rows: Object.entries(rates).map(([date, rate]) =>
    rate === undefined ? { metric, date } : { metric, date, rate },
  ),
});

const createPlayClient = (
  crashTimeline: VitalsTimeline,
  anrTimeline: VitalsTimeline,
  askedWindows: number[] = [],
): PlayReportingClient => {
  const fakeClient = {
    vitalsTimeline: (_packageName: string, metric: PlayVitalsMetric, days: number) => {
      askedWindows.push(days);
      if (metric === 'crash') return Effect.succeed(crashTimeline);
      return Effect.succeed(anrTimeline);
    },
  };
  return fakeClient as unknown as PlayReportingClient;
};

const DEFAULT_PLAY_CLIENT = createPlayClient(
  createVitalsTimeline('crash', '2026-10-19', {
    '2026-09-30': 0.5,
    '2026-10-01': 0.01,
    '2026-10-02': undefined,
    '2026-10-19': 0.02,
  }),
  createVitalsTimeline('anr', '2026-10-18', { '2026-10-01': 0.003 }),
);

const objectUrl = (objectName: string): string =>
  `${BUCKET_URL}/${encodeURIComponent(objectName)}?alt=media`;

const installsObjectName = (reportMonth: string): string =>
  `stats/installs/installs_com.fit_${reportMonth}_overview.csv`;

const createBucketRoutes = (
  reportMonths: readonly string[],
  foundObjects: Readonly<Record<string, Uint8Array | 403>>,
): HttpClientTestRoute[] => {
  const reportObjectNames = reportMonths.flatMap((reportMonth) => [
    installsObjectName(reportMonth),
    `stats/ratings/ratings_com.fit_${reportMonth}_overview.csv`,
    `stats/crashes/crashes_com.fit_${reportMonth}_overview.csv`,
    `stats/store_performance/store_performance_com.fit_${reportMonth}_country.csv`,
  ]);
  const earningsObjectNames = Object.keys(foundObjects).filter((objectName) =>
    objectName.startsWith('earnings/'),
  );
  return [...reportObjectNames, ...earningsObjectNames].map((objectName) => {
    const found = foundObjects[objectName];
    if (found === undefined) {
      return { method: 'GET', url: objectUrl(objectName), status: 404, body: {} };
    }
    if (found === 403) {
      return { method: 'GET', url: objectUrl(objectName), status: 403, body: {} };
    }
    return { method: 'GET', url: objectUrl(objectName), status: 200, body: found };
  });
};

const createEarningsListRoute = (objectNames: readonly string[]): HttpClientTestRoute => ({
  method: 'GET',
  url: EARNINGS_LIST_URL,
  status: 200,
  body: { items: objectNames.map((name) => ({ name })) },
});

const createEarningsZip = (earningsLines: readonly string[]): Uint8Array =>
  zipSync({
    'earnings_202610.csv': Buffer.from([EARNINGS_HEADER, ...earningsLines].join('\n'), 'utf8'),
  });

const earningsLine = (
  transactionDate: string,
  transactionType: string,
  merchantAmount: string,
): string =>
  `GPA.1,"${transactionDate}",12:00:00 PM PDT,,${transactionType},,Coins,com.fit,One-time product,coins,mako,US,MA,02140,USD,1.00,1,EUR,${merchantAmount}`;

const fetchDays = (
  credentialsOverrides: Partial<StatsCredentialsShape>,
  routes: readonly HttpClientTestRoute[] = [],
  app: PortfolioApp = ANDROID_APP,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* StatsCredentials;
      return yield* googlePlayFeed.fetchDays({ app, range: RANGE, credentials });
    }).pipe(
      Effect.either,
      Effect.provide(makeStatsCredentialsTest(credentialsOverrides)),
      Effect.provide(makeHttpClientTest(routes)),
    ),
  );

const withBucket = (
  overrides: Partial<StatsCredentialsShape> = {},
): Partial<StatsCredentialsShape> => ({
  playReportingClient: () => Effect.succeed(DEFAULT_PLAY_CLIENT),
  playReportsBucket: () => Effect.succeed(BUCKET),
  googleAccessToken: () => Effect.succeed('token-1'),
  ...overrides,
});

const statsOfMetric = (stats: readonly DailyStat[], metric: DailyStat['metric']): DailyStat[] =>
  stats.filter((stat) => stat.metric === metric);

describe('googlePlayFeed.isApplicable', () => {
  test('applies to Android apps only', () => {
    expect(googlePlayFeed.isApplicable(ANDROID_APP)).toBe(true);
    expect(googlePlayFeed.isApplicable({ ...ANDROID_APP, platform: 'ios' })).toBe(false);
  });
});

describe('googlePlayFeed.fetchDays', () => {
  test('skips an app that has no package name', async () => {
    const reply = await fetchDays({}, [], { ...ANDROID_APP, packageName: null });

    expect(reply).toMatchObject({
      right: { status: 'skipped', reason: 'Fit has no package name' },
    });
  });

  test('skips when no Play service account is saved', async () => {
    const reply = await fetchDays({});

    expect(reply).toMatchObject({
      right: { status: 'skipped', reason: expect.stringContaining('No Play service account') },
    });
  });

  test('returns vitals as fractions with a note when no reports bucket is set', async () => {
    const askedWindows: number[] = [];
    const playClient = createPlayClient(
      createVitalsTimeline('crash', '2026-10-19', {
        '2026-09-30': 0.5,
        '2026-10-01': 0.01,
        '2026-10-02': undefined,
        '2026-10-19': 0.02,
      }),
      createVitalsTimeline('anr', '2026-10-18', { '2026-10-01': 0.003 }),
      askedWindows,
    );

    const reply = await fetchDays({ playReportingClient: () => Effect.succeed(playClient) });

    expect(reply).toMatchObject({
      right: {
        status: 'fetched',
        coveredThrough: '2026-10-18',
        notes: [expect.stringContaining('Play reports bucket not set')],
      },
    });
    const stats =
      reply._tag === 'Right' && reply.right.status === 'fetched' ? reply.right.stats : [];
    expect(stats).toEqual([
      { date: '2026-10-01', feed: 'google-play', metric: 'crashRate', value: 0.01, currency: null },
      { date: '2026-10-19', feed: 'google-play', metric: 'crashRate', value: 0.02, currency: null },
      { date: '2026-10-01', feed: 'google-play', metric: 'anrRate', value: 0.003, currency: null },
    ]);
    expect(askedWindows).toEqual([27, 27]);
  });

  test('never covers days after the end of the asked range', async () => {
    const playClient = createPlayClient(
      createVitalsTimeline('crash', '2026-10-25', {}),
      createVitalsTimeline('anr', '2026-10-25', {}),
    );

    const reply = await fetchDays({ playReportingClient: () => Effect.succeed(playClient) });

    expect(reply).toMatchObject({
      right: { status: 'fetched', stats: [], coveredThrough: '2026-10-20' },
    });
  });

  test('maps every CSV column of the bucket and covers through the last installs day', async () => {
    const installs = encodeUtf16(
      `${INSTALLS_HEADER}\r\n2026-10-01,com.fit,100,12,3,40,90,500,10,2,80\r\n2026-10-18,com.fit,100,5,1,2,90,500,10,2,81\r\n`,
    );
    const ratings = encodeUtf16(
      'Date,Package Name,Daily Average Rating,Total Average Rating\r\n2026-10-01,com.fit,5.00,4.16\r\n',
    );
    const crashes = encodeUtf16(
      'Date,Package Name,Daily Crashes,Daily ANRs\r\n2026-10-01,com.fit,4,1\r\n',
    );
    const storePerformance = encodeUtf16(
      'Date,Package name,Country,Store listing acquisitions,Store listing visitors,Store listing conversion rate\r\n2026-10-01,com.fit,US,10,100,0.1\r\n2026-10-01,com.fit,UK,1,20,0.05\r\n',
    );
    const routes = [
      ...createBucketRoutes(['202610'], {
        [installsObjectName('202610')]: installs,
        'stats/ratings/ratings_com.fit_202610_overview.csv': ratings,
        'stats/crashes/crashes_com.fit_202610_overview.csv': crashes,
        'stats/store_performance/store_performance_com.fit_202610_country.csv': storePerformance,
      }),
      createEarningsListRoute([]),
    ];

    const reply = await fetchDays(withBucket(), routes);

    expect(reply).toMatchObject({
      right: { status: 'fetched', coveredThrough: '2026-10-18', notes: [] },
    });
    const stats =
      reply._tag === 'Right' && reply.right.status === 'fetched' ? reply.right.stats : [];
    expect(statsOfMetric(stats, 'installs').map((stat) => stat.value)).toEqual([12, 5]);
    expect(statsOfMetric(stats, 'uninstalls').map((stat) => stat.value)).toEqual([3, 1]);
    expect(statsOfMetric(stats, 'updates').map((stat) => stat.value)).toEqual([40, 2]);
    expect(statsOfMetric(stats, 'activeInstalls').map((stat) => stat.value)).toEqual([80, 81]);
    expect(statsOfMetric(stats, 'ratingAverage').map((stat) => stat.value)).toEqual([4.16]);
    expect(statsOfMetric(stats, 'crashes').map((stat) => stat.value)).toEqual([4]);
    expect(statsOfMetric(stats, 'productPageViews').map((stat) => stat.value)).toEqual([120]);
    expect(statsOfMetric(stats, 'crashRate')).toHaveLength(2);
    expect(statsOfMetric(stats, 'proceeds')).toEqual([]);
  });

  test('reads the files of every month a range touches', async () => {
    const septemberInstalls = encodeUtf16(
      'Date,Daily Device Installs\r\n2026-09-29,7\r\n2026-09-30,8\r\n',
    );
    const octoberInstalls = encodeUtf16('Date,Daily Device Installs\r\n2026-10-01,9\r\n');
    const routes = [
      ...createBucketRoutes(['202609', '202610'], {
        [installsObjectName('202609')]: septemberInstalls,
        [installsObjectName('202610')]: octoberInstalls,
      }),
      createEarningsListRoute([]),
    ];
    const playClient = createPlayClient(
      createVitalsTimeline('crash', '2026-10-19', {}),
      createVitalsTimeline('anr', '2026-10-19', {}),
    );
    const twoMonthRange = { from: '2026-09-29', to: '2026-10-20' };

    const reply = await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* StatsCredentials;
        return yield* googlePlayFeed.fetchDays({
          app: ANDROID_APP,
          range: twoMonthRange,
          credentials,
        });
      }).pipe(
        Effect.provide(
          makeStatsCredentialsTest(
            withBucket({ playReportingClient: () => Effect.succeed(playClient) }),
          ),
        ),
        Effect.provide(makeHttpClientTest(routes)),
      ),
    );

    expect(reply).toMatchObject({ status: 'fetched', coveredThrough: '2026-10-01' });
    const stats = reply.status === 'fetched' ? reply.stats : [];
    expect(statsOfMetric(stats, 'installs').map((stat) => stat.date)).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ]);
  });

  test('covers nothing from the CSVs when the month is not published yet', async () => {
    const routes = [...createBucketRoutes(['202610'], {}), createEarningsListRoute([])];

    const reply = await fetchDays(withBucket(), routes);

    expect(reply).toMatchObject({
      right: { status: 'fetched', coveredThrough: '2026-09-30', notes: [] },
    });
  });

  test('sums earnings per day and currency from the zipped CSV', async () => {
    const earningsZip = createEarningsZip([
      earningsLine('Oct 1, 2026', 'Charge', '10.00'),
      earningsLine('Oct 1, 2026', 'Google fee', '-1.50'),
      earningsLine('Oct 1, 2026', 'Tax', '2.00'),
    ]);
    const installs = encodeUtf16('Date,Daily Device Installs\r\n2026-10-18,5\r\n');
    const routes = [
      ...createBucketRoutes(['202610'], {
        [installsObjectName('202610')]: installs,
        'earnings/earnings_202610.zip': earningsZip,
      }),
      createEarningsListRoute(['earnings/earnings_202609.zip', 'earnings/earnings_202610.zip']),
    ];

    const reply = await fetchDays(withBucket(), routes);

    expect(reply).toMatchObject({ right: { status: 'fetched', coveredThrough: '2026-10-18' } });
    const stats =
      reply._tag === 'Right' && reply.right.status === 'fetched' ? reply.right.stats : [];
    expect(statsOfMetric(stats, 'proceeds')).toEqual([
      { date: '2026-10-01', feed: 'google-play', metric: 'proceeds', value: 8.5, currency: 'EUR' },
    ]);
  });

  test('holds coverage at the end of the last published earnings month', async () => {
    const installs = encodeUtf16('Date,Daily Device Installs\r\n2026-10-18,5\r\n');
    const routes = [
      ...createBucketRoutes(['202610'], { [installsObjectName('202610')]: installs }),
      createEarningsListRoute(['earnings/earnings_202608.zip', 'earnings/earnings_202609.zip']),
    ];

    const reply = await fetchDays(withBucket(), routes);

    expect(reply).toMatchObject({ right: { status: 'fetched', coveredThrough: '2026-09-30' } });
  });

  test('notes the missing permission when a CSV answers 403', async () => {
    const routes = createBucketRoutes(['202610'], {});
    const forbiddenRoutes = routes.map((route) => ({ ...route, status: 403 }));

    const reply = await fetchDays(withBucket(), forbiddenRoutes);

    expect(reply).toMatchObject({
      right: {
        status: 'fetched',
        coveredThrough: '2026-10-18',
        notes: [expect.stringContaining('View app information and download bulk reports')],
      },
    });
    const stats =
      reply._tag === 'Right' && reply.right.status === 'fetched' ? reply.right.stats : [];
    expect(stats.map((stat) => stat.metric)).toEqual(['crashRate', 'crashRate', 'anrRate']);
  });

  test('notes the missing permission when the earnings listing answers 403', async () => {
    const routes = [
      ...createBucketRoutes(['202610'], {}),
      { method: 'GET', url: EARNINGS_LIST_URL, status: 403, body: {} },
    ];

    const reply = await fetchDays(withBucket(), routes);

    expect(reply).toMatchObject({
      right: { notes: [expect.stringContaining('Global')] },
    });
  });

  test('notes the missing permission when an earnings file answers 403', async () => {
    const routes = [
      ...createBucketRoutes(['202610'], { 'earnings/earnings_202610.zip': 403 }),
      createEarningsListRoute(['earnings/earnings_202610.zip']),
    ];

    const reply = await fetchDays(withBucket(), routes);

    expect(reply).toMatchObject({
      right: { notes: [expect.stringContaining('Global')] },
    });
  });

  test('skips an earnings file that vanished between the listing and the download', async () => {
    const routes = [
      ...createBucketRoutes(['202610'], {}),
      createEarningsListRoute(['earnings/earnings_202610.zip']),
      {
        method: 'GET',
        url: objectUrl('earnings/earnings_202610.zip'),
        status: 404,
        body: {},
      },
    ];

    const reply = await fetchDays(withBucket(), routes);

    expect(reply).toMatchObject({
      right: { status: 'fetched', coveredThrough: '2026-09-30', notes: [] },
    });
  });

  test('fails when an earnings file is not a zip', async () => {
    const routes = [
      ...createBucketRoutes(['202610'], {
        'earnings/earnings_202610.zip': new Uint8Array([1, 2, 3, 4]),
      }),
      createEarningsListRoute(['earnings/earnings_202610.zip']),
    ];

    const reply = await fetchDays(withBucket(), routes);

    expect(reply).toMatchObject({
      _tag: 'Left',
      left: {
        _tag: 'StatsFeedFailure',
        feed: 'google-play',
        appKey: 'android-com.fit',
        message: expect.stringContaining('unzip an earnings report'),
      },
    });
  });

  test('fails when the bucket is set but no token can be made', async () => {
    const reply = await fetchDays(withBucket({ googleAccessToken: () => Effect.succeed(null) }));

    expect(reply).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'StatsFeedFailure', message: expect.stringContaining('android-com.fit') },
    });
  });

  test('fails with the feed and app named when the vitals call fails', async () => {
    const brokenClient = {
      vitalsTimeline: () =>
        Effect.fail({ _tag: 'PlayReportingApiError', message: 'quota exceeded' }),
    } as unknown as PlayReportingClient;

    const reply = await fetchDays({ playReportingClient: () => Effect.succeed(brokenClient) });

    expect(reply).toMatchObject({
      _tag: 'Left',
      left: {
        _tag: 'StatsFeedFailure',
        feed: 'google-play',
        appKey: 'android-com.fit',
        message: 'quota exceeded',
      },
    });
  });
});
