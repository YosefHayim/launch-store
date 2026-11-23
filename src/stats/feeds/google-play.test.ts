import { crc32, deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { PortfolioApp } from '../../types/portfolio.ts';
import type { PlayVitalsMetric, VitalsTimeline } from '../../types/vitals.ts';
import type { DailyStat, FeedFetchReply } from '../../types/stats.ts';
import type { PlayVitalsReader, StatsCredentialsApi } from '../stats-credentials.ts';
import { makeStatsCredentialsTest, useStatsCredentials } from '../stats-credentials.ts';
import { googlePlayFeed } from './google-play.ts';

const BUCKET = 'pubsite_prod_rev_1';
const BUCKET_URL = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o`;
const EARNINGS_LIST_URL = `${BUCKET_URL}?prefix=earnings%2Fearnings_&fields=items(name),nextPageToken`;

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

function encodeUtf16(csvDocument: string): Uint8Array {
  const bufferBytes = Buffer.from([0xff, 0xfe]);
  return Buffer.concat([bufferBytes, Buffer.from(csvDocument, 'utf16le')]);
}

function createVitalsTimeline(
  metric: PlayVitalsMetric,
  endDate: string,
  rates: Readonly<Record<string, number | undefined>>,
): VitalsTimeline {
  function mapPiece([date, rate]: [string, number | undefined]) {
    return rate == null ? { metric, date } : { metric, date, rate };
  }

  return {
    metric,
    window: { startDate: '2026-09-01', endDate },
    rows: Object.entries(rates).map(mapPiece),
  };
}

function createPlayClient(
  crashTimeline: VitalsTimeline,
  anrTimeline: VitalsTimeline,
  askedWindows: number[] = [],
): PlayVitalsReader {
  return {
    async vitalsTimeline(_packageName: string, metric: PlayVitalsMetric, days: number) {
      askedWindows.push(days);

      if (metric == 'crash') {
        return crashTimeline;
      }

      return anrTimeline;
    },
  };
}

const vitalsTimeline = createVitalsTimeline('crash', '2026-10-19', {
  '2026-09-30': 0.5,
  '2026-10-01': 0.01,
  '2026-10-02': undefined,
  '2026-10-19': 0.02,
});
const defaultPlayClient = createPlayClient(
  vitalsTimeline,
  createVitalsTimeline('anr', '2026-10-18', { '2026-10-01': 0.003 }),
);

interface HttpRoute {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly body: unknown;
}

type Settled<Success> =
  | { readonly _tag: 'Right'; readonly right: Success }
  | { readonly _tag: 'Left'; readonly left: unknown };

function readRequestUrl(url: string | URL | Request): string {
  if (typeof url == 'string') {
    return url;
  }

  if (url instanceof URL) {
    return url.toString();
  }

  return url.url;
}

function createReplyBody(routeBody: unknown): Uint8Array | string {
  if (routeBody instanceof Uint8Array) {
    return routeBody;
  }

  return JSON.stringify(routeBody);
}

function installFetch(routes: readonly HttpRoute[]): void {
  vi.stubGlobal(
    'fetch',
    async function fetchRoute(url: string | URL | Request, init?: RequestInit): Promise<Response> {
      const method = init?.method ?? 'GET';
      const requestUrl = readRequestUrl(url);

      function matchesRoute(route: HttpRoute): boolean {
        if (route.method != method) {
          return false;
        }

        return route.url == requestUrl;
      }

      const matchedRoute = routes.find(matchesRoute);

      if (matchedRoute == undefined) {
        throw new Error(`No test route for ${method} ${requestUrl}`);
      }

      const createReply = createReplyBody(matchedRoute.body);
      return new Response(createReply, { status: matchedRoute.status });
    },
  );
}

function objectUrl(objectName: string): string {
  return `${BUCKET_URL}/${encodeURIComponent(objectName)}?alt=media`;
}

function installsObjectName(reportMonth: string): string {
  return `stats/installs/installs_com.fit_${reportMonth}_overview.csv`;
}

function createBucketRoutes(
  reportMonths: readonly string[],
  foundObjects: Readonly<Record<string, Uint8Array | 403>>,
): HttpRoute[] {
  function flatMapReportMonth(reportMonth: string) {
    return [
      installsObjectName(reportMonth),
      `stats/ratings/ratings_com.fit_${reportMonth}_overview.csv`,
      `stats/crashes/crashes_com.fit_${reportMonth}_overview.csv`,
      `stats/store_performance/store_performance_com.fit_${reportMonth}_country.csv`,
    ];
  }

  const reportObjectNames = reportMonths.flatMap(flatMapReportMonth);
  function filterObjectName(objectName: string) {
    return objectName.startsWith('earnings/');
  }

  const earningsObjectNames = Object.keys(foundObjects).filter(filterObjectName);
  function mapObjectName(objectName: string) {
    const found = foundObjects[objectName];
    if (found == null) {
      return { method: 'GET', url: objectUrl(objectName), status: 404, body: {} };
    }
    if (found == 403) {
      return { method: 'GET', url: objectUrl(objectName), status: 403, body: {} };
    }
    return { method: 'GET', url: objectUrl(objectName), status: 200, body: found };
  }

  return [...reportObjectNames, ...earningsObjectNames].map(mapObjectName);
}
function mapName(name: string) {
  return { name };
}

function createEarningsListRoute(objectNames: readonly string[]): HttpRoute {
  return {
    method: 'GET',
    url: EARNINGS_LIST_URL,
    status: 200,
    body: { items: objectNames.map(mapName) },
  };
}

function createEarningsZip(earningsLines: readonly string[]): Uint8Array {
  const csvText = [
    'Description,Transaction Date,Transaction Time,Tax Type,Transaction Type,Refund Type,Product Title,Package ID,Product Type,SKU ID,Hardware,Buyer Country,Buyer State,Buyer Postcode,Buyer Currency,Amount (Buyer Currency),Currency Conversion Rate,Merchant Currency,Amount (Merchant Currency)',
    ...earningsLines,
  ].join('\n');

  const bufferBytes = Buffer.from(csvText, 'utf8');
  return writeDeflatedZip({ 'earnings_202610.csv': bufferBytes });
}

function writeDeflatedZip(files: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const [name, fileBytes] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(fileBytes);
    const checksum = crc32(fileBytes);
    const local = Buffer.alloc(30 + nameBytes.length);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(fileBytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);

    const localOffset = offset;

    offset += local.length + compressed.length;
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + nameBytes.length);

    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(fileBytes.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    nameBytes.copy(central, 46);
    centralParts.push(central);
  }

  const locals = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);

  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(centralParts.length, 8);
  endRecord.writeUInt16LE(centralParts.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(locals.length, 16);

  return Buffer.concat([locals, centralDirectory, endRecord]);
}

function earningsLine(
  transactionDate: string,
  transactionType: string,
  merchantAmount: string,
): string {
  return `GPA.1,"${transactionDate}",12:00:00 PM PDT,,${transactionType},,Coins,com.fit,One-time product,coins,mako,US,MA,02140,USD,1.00,1,EUR,${merchantAmount}`;
}

async function fetchDays(
  credentialsOverrides: Partial<StatsCredentialsApi>,
  routes: readonly HttpRoute[] = [],
  app: PortfolioApp = ANDROID_APP,
): Promise<Settled<FeedFetchReply>> {
  installFetch(routes);
  const credentials = makeStatsCredentialsTest(credentialsOverrides);

  try {
    const right = await googlePlayFeed.fetchDays({
      app,
      range: { from: '2026-10-01', to: '2026-10-20' },
      credentials,
    });

    return { _tag: 'Right', right };
  } catch (left) {
    return { _tag: 'Left', left };
  }
}

function withBucket(overrides: Partial<StatsCredentialsApi> = {}): Partial<StatsCredentialsApi> {
  return {
    async playReportingClient() {
      return defaultPlayClient;
    },
    async playReportsBucket() {
      return BUCKET;
    },
    async googleAccessToken() {
      return 'token-1';
    },
    ...overrides,
  };
}
function cleanup() {
  useStatsCredentials(null);
  vi.unstubAllGlobals();
}

afterEach(cleanup);

function statsOfMetric(stats: readonly DailyStat[], metric: DailyStat['metric']): DailyStat[] {
  function filterStat(stat: DailyStat) {
    return stat.metric == metric;
  }

  return stats.filter(filterStat);
}
function describeGooglePlayFeedIsApplicable() {
  function appliesToAndroidAppsOnly() {
    expect(googlePlayFeed.isApplicable(ANDROID_APP)).toBe(true);
    expect(googlePlayFeed.isApplicable({ ...ANDROID_APP, platform: 'ios' })).toBe(false);
  }

  test('applies to Android apps only', appliesToAndroidAppsOnly);
}

describe('googlePlayFeed.isApplicable', describeGooglePlayFeedIsApplicable);
function describeGooglePlayFeedFetchDays() {
  async function skipsAnAppThatHasNoPackageName() {
    const reply = await fetchDays({}, [], { ...ANDROID_APP, packageName: null });

    expect(reply).toMatchObject({
      right: { status: 'skipped', reason: 'Fit has no package name' },
    });
  }

  test('skips an app that has no package name', skipsAnAppThatHasNoPackageName);
  async function skipsWhenNoPlayServiceAccountIsSaved() {
    const reply = await fetchDays({});

    expect(reply).toMatchObject({
      right: { status: 'skipped', reason: expect.stringContaining('No Play service account') },
    });
  }

  test('skips when no Play service account is saved', skipsWhenNoPlayServiceAccountIsSaved);
  async function returnsVitalsAsFractionsWithANoteWhenNoReportsBucketIsSet() {
    const askedWindows: number[] = [];
    const vitalsTimeline = createVitalsTimeline('crash', '2026-10-19', {
      '2026-09-30': 0.5,
      '2026-10-01': 0.01,
      '2026-10-02': undefined,
      '2026-10-19': 0.02,
    });
    const playClient = createPlayClient(
      vitalsTimeline,
      createVitalsTimeline('anr', '2026-10-18', { '2026-10-01': 0.003 }),
      askedWindows,
    );

    const reply = await fetchDays({
      async playReportingClient() {
        return playClient;
      },
    });

    expect(reply).toMatchObject({
      right: {
        status: 'fetched',
        coveredThrough: '2026-10-18',
        notes: [expect.stringContaining('Play reports bucket not set')],
      },
    });
    const stats = reply._tag == 'Right' && reply.right.status == 'fetched' ? reply.right.stats : [];
    expect(stats).toEqual([
      { date: '2026-10-01', feed: 'google-play', metric: 'crashRate', value: 0.01, currency: null },
      { date: '2026-10-19', feed: 'google-play', metric: 'crashRate', value: 0.02, currency: null },
      { date: '2026-10-01', feed: 'google-play', metric: 'anrRate', value: 0.003, currency: null },
    ]);
    expect(askedWindows).toEqual([27, 27]);
  }

  test(
    'returns vitals as fractions with a note when no reports bucket is set',
    returnsVitalsAsFractionsWithANoteWhenNoReportsBucketIsSet,
  );
  async function neverCoversDaysAfterTheEndOfTheAskedRange() {
    const vitalsTimeline = createVitalsTimeline('crash', '2026-10-25', {});
    const playClient = createPlayClient(
      vitalsTimeline,
      createVitalsTimeline('anr', '2026-10-25', {}),
    );

    const reply = await fetchDays({
      async playReportingClient() {
        return playClient;
      },
    });

    expect(reply).toMatchObject({
      right: { status: 'fetched', stats: [], coveredThrough: '2026-10-20' },
    });
  }

  test(
    'never covers days after the end of the asked range',
    neverCoversDaysAfterTheEndOfTheAskedRange,
  );
  async function mapsEveryCSVColumnOfTheBucketAndCoversThroughTheLastInstallsDay() {
    const installs = encodeUtf16(
      `${'Date,Package Name,Current Device Installs,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Current User Installs,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs'}\r\n2026-10-01,com.fit,100,12,3,40,90,500,10,2,80\r\n2026-10-18,com.fit,100,5,1,2,90,500,10,2,81\r\n`,
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
    const stats = reply._tag == 'Right' && reply.right.status == 'fetched' ? reply.right.stats : [];
    function readPiece(stat: DailyStat) {
      return stat.value;
    }

    expect(statsOfMetric(stats, 'installs').map(readPiece)).toEqual([12, 5]);
    function readPiece2(stat: DailyStat) {
      return stat.value;
    }

    expect(statsOfMetric(stats, 'uninstalls').map(readPiece2)).toEqual([3, 1]);
    function readPiece3(stat: DailyStat) {
      return stat.value;
    }

    expect(statsOfMetric(stats, 'updates').map(readPiece3)).toEqual([40, 2]);
    function readPiece4(stat: DailyStat) {
      return stat.value;
    }

    expect(statsOfMetric(stats, 'activeInstalls').map(readPiece4)).toEqual([80, 81]);
    function readPiece5(stat: DailyStat) {
      return stat.value;
    }

    expect(statsOfMetric(stats, 'ratingAverage').map(readPiece5)).toEqual([4.16]);
    function readPiece6(stat: DailyStat) {
      return stat.value;
    }

    expect(statsOfMetric(stats, 'crashes').map(readPiece6)).toEqual([4]);
    function readPiece7(stat: DailyStat) {
      return stat.value;
    }

    expect(statsOfMetric(stats, 'productPageViews').map(readPiece7)).toEqual([120]);
    expect(statsOfMetric(stats, 'crashRate')).toHaveLength(2);
    expect(statsOfMetric(stats, 'proceeds')).toEqual([]);
  }

  test(
    'maps every CSV column of the bucket and covers through the last installs day',
    mapsEveryCSVColumnOfTheBucketAndCoversThroughTheLastInstallsDay,
  );
  async function readsTheFilesOfEveryMonthARangeTouches() {
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
    const vitalsTimeline = createVitalsTimeline('crash', '2026-10-19', {});
    const playClient = createPlayClient(
      vitalsTimeline,
      createVitalsTimeline('anr', '2026-10-19', {}),
    );
    const twoMonthRange = { from: '2026-09-29', to: '2026-10-20' };

    installFetch(routes);
    const credentials = makeStatsCredentialsTest(
      withBucket({
        async playReportingClient() {
          return playClient;
        },
      }),
    );
    const reply = await googlePlayFeed.fetchDays({
      app: ANDROID_APP,
      range: twoMonthRange,
      credentials,
    });

    expect(reply).toMatchObject({ status: 'fetched', coveredThrough: '2026-10-01' });
    const stats = reply.status == 'fetched' ? reply.stats : [];
    function readDate(stat: DailyStat) {
      return stat.date;
    }

    expect(statsOfMetric(stats, 'installs').map(readDate)).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ]);
  }

  test('reads the files of every month a range touches', readsTheFilesOfEveryMonthARangeTouches);
  async function coversNothingFromTheCSVsWhenTheMonthIsNotPublishedYet() {
    const routes = [...createBucketRoutes(['202610'], {}), createEarningsListRoute([])];

    const reply = await fetchDays(withBucket(), routes);

    expect(reply).toMatchObject({
      right: { status: 'fetched', coveredThrough: '2026-09-30', notes: [] },
    });
  }

  test(
    'covers nothing from the CSVs when the month is not published yet',
    coversNothingFromTheCSVsWhenTheMonthIsNotPublishedYet,
  );
  async function sumsEarningsPerDayAndCurrencyFromTheZippedCSV() {
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
    const stats = reply._tag == 'Right' && reply.right.status == 'fetched' ? reply.right.stats : [];
    expect(statsOfMetric(stats, 'proceeds')).toEqual([
      { date: '2026-10-01', feed: 'google-play', metric: 'proceeds', value: 8.5, currency: 'EUR' },
    ]);
  }

  test(
    'sums earnings per day and currency from the zipped CSV',
    sumsEarningsPerDayAndCurrencyFromTheZippedCSV,
  );
  async function holdsCoverageAtTheEndOfTheLastPublishedEarningsMonth() {
    const installs = encodeUtf16('Date,Daily Device Installs\r\n2026-10-18,5\r\n');
    const routes = [
      ...createBucketRoutes(['202610'], { [installsObjectName('202610')]: installs }),
      createEarningsListRoute(['earnings/earnings_202608.zip', 'earnings/earnings_202609.zip']),
    ];

    const reply = await fetchDays(withBucket(), routes);

    expect(reply).toMatchObject({ right: { status: 'fetched', coveredThrough: '2026-09-30' } });
  }

  test(
    'holds coverage at the end of the last published earnings month',
    holdsCoverageAtTheEndOfTheLastPublishedEarningsMonth,
  );
  async function notesTheMissingPermissionWhenACSVAnswers403() {
    const routes = createBucketRoutes(['202610'], {});
    function mapRoute(route: HttpRoute) {
      return { ...route, status: 403 };
    }

    const forbiddenRoutes = routes.map(mapRoute);

    const reply = await fetchDays(withBucket(), forbiddenRoutes);

    expect(reply).toMatchObject({
      right: {
        status: 'fetched',
        coveredThrough: '2026-10-18',
        notes: [expect.stringContaining('View app information and download bulk reports')],
      },
    });
    const stats = reply._tag == 'Right' && reply.right.status == 'fetched' ? reply.right.stats : [];
    function readMetric(stat: DailyStat) {
      return stat.metric;
    }

    expect(stats.map(readMetric)).toEqual(['crashRate', 'crashRate', 'anrRate']);
  }

  test(
    'notes the missing permission when a CSV answers 403',
    notesTheMissingPermissionWhenACSVAnswers403,
  );
  async function notesTheMissingPermissionWhenTheEarningsListingAnswers403() {
    const routes = [
      ...createBucketRoutes(['202610'], {}),
      { method: 'GET', url: EARNINGS_LIST_URL, status: 403, body: {} },
    ];

    const reply = await fetchDays(withBucket(), routes);

    expect(reply).toMatchObject({
      right: { notes: [expect.stringContaining('Global')] },
    });
  }

  test(
    'notes the missing permission when the earnings listing answers 403',
    notesTheMissingPermissionWhenTheEarningsListingAnswers403,
  );
  async function notesTheMissingPermissionWhenAnEarningsFileAnswers403() {
    const routes = [
      ...createBucketRoutes(['202610'], { 'earnings/earnings_202610.zip': 403 }),
      createEarningsListRoute(['earnings/earnings_202610.zip']),
    ];

    const reply = await fetchDays(withBucket(), routes);

    expect(reply).toMatchObject({
      right: { notes: [expect.stringContaining('Global')] },
    });
  }

  test(
    'notes the missing permission when an earnings file answers 403',
    notesTheMissingPermissionWhenAnEarningsFileAnswers403,
  );
  async function skipsAnEarningsFileThatVanishedBetweenTheListingAndTheDownload() {
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
  }

  test(
    'skips an earnings file that vanished between the listing and the download',
    skipsAnEarningsFileThatVanishedBetweenTheListingAndTheDownload,
  );
  async function failsWhenAnEarningsFileIsNotAZip() {
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
  }

  test('fails when an earnings file is not a zip', failsWhenAnEarningsFileIsNotAZip);
  async function failsWhenTheBucketIsSetButNoTokenCanBeMade() {
    const reply = await fetchDays(
      withBucket({
        async googleAccessToken() {
          return null;
        },
      }),
    );

    expect(reply).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'StatsFeedFailure', message: expect.stringContaining('android-com.fit') },
    });
  }

  test(
    'fails when the bucket is set but no token can be made',
    failsWhenTheBucketIsSetButNoTokenCanBeMade,
  );
  async function failsWithTheFeedAndAppNamedWhenTheVitalsCallFails() {
    const brokenClient: PlayVitalsReader = {
      async vitalsTimeline() {
        throw { message: 'quota exceeded' };
      },
    };

    const reply = await fetchDays({
      async playReportingClient() {
        return brokenClient;
      },
    });

    expect(reply).toMatchObject({
      _tag: 'Left',
      left: {
        _tag: 'StatsFeedFailure',
        feed: 'google-play',
        appKey: 'android-com.fit',
        message: 'quota exceeded',
      },
    });
  }

  test(
    'fails with the feed and app named when the vitals call fails',
    failsWithTheFeedAndAppNamedWhenTheVitalsCallFails,
  );
}

describe('googlePlayFeed.fetchDays', describeGooglePlayFeedFetchDays);
