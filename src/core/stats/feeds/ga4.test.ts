import { Effect, Layer } from 'effect';
import { describe, expect, test } from 'vitest';
import {
  makeHttpClientSequenceTest,
  type HttpClientSequenceRoute,
} from '@testkit/httpClientSequence.testkit.js';
import type { PortfolioApp } from '../../types/portfolio.js';
import type { FeedFetchReply, StatsCredentialsShape } from '../../types/stats.js';
import { makeStatsCredentialsTest, StatsCredentials } from '../statsCredentials.js';
import { makeGa4Feed } from './ga4.js';

const ACCOUNT_SUMMARIES_URL =
  'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200';
const RUN_REPORT_URL = 'https://analyticsdata.googleapis.com/v1beta/properties/111:runReport';
const SECRET_TOKEN = 'secret-access-token';
const SECRET_EMAIL = 'launch-bot@client-project.iam.gserviceaccount.com';
const RANGE = { from: '2026-10-01', to: '2026-10-03' };

const IOS_APP: PortfolioApp = {
  key: 'ios-1',
  platform: 'ios',
  storeId: '1',
  name: 'calfriend',
  bundleId: 'com.example.calfriend',
  packageName: null,
  accountKeyId: 'KEYA',
  accountLabel: 'mine',
  owner: 'mine',
  ga4PropertyId: null,
};
const ANDROID_APP: PortfolioApp = {
  ...IOS_APP,
  key: 'android-com.example.calfriend',
  platform: 'android',
  bundleId: null,
  packageName: 'com.example.calfriend',
};

const readTwoPropertySummaries = (): HttpClientSequenceRoute => ({
  method: 'GET',
  url: ACCOUNT_SUMMARIES_URL,
  replies: [
    {
      status: 200,
      body: {
        accountSummaries: [
          { propertySummaries: [{ property: 'properties/111' }, { property: 'properties/222' }] },
        ],
      },
    },
  ],
});

const streamsRoute = (
  propertyId: string,
  dataStreams: readonly unknown[],
): HttpClientSequenceRoute => ({
  method: 'GET',
  url: `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/dataStreams?pageSize=200`,
  replies: [{ status: 200, body: { dataStreams } }],
});

const IOS_STREAM = {
  name: 'properties/111/dataStreams/9001',
  iosAppStreamData: { bundleId: 'com.example.calfriend' },
};
const ANDROID_STREAM = {
  name: 'properties/222/dataStreams/9002',
  androidAppStreamData: { packageName: 'com.example.calfriend' },
};
const WEB_STREAM = { name: 'properties/222/dataStreams/9003', webStreamData: {} };

const reportRow = (
  compactDate: string,
  activeUsers: string,
  newUsers: string,
  sessions: string,
) => ({
  dimensionValues: [{ value: compactDate }],
  metricValues: [{ value: activeUsers }, { value: newUsers }, { value: sessions }],
});

const reportRoute = (
  propertyId: string,
  replies: HttpClientSequenceRoute['replies'],
): HttpClientSequenceRoute => ({
  method: 'POST',
  url: `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
  replies,
});

const makeCredentials = (overrides: Partial<StatsCredentialsShape> = {}) =>
  makeStatsCredentialsTest({
    googleAccessToken: () => Effect.succeed(SECRET_TOKEN),
    playServiceAccount: () =>
      Effect.succeed({ clientEmail: SECRET_EMAIL, privateKey: 'key', tokenUri: 'uri' }),
    ...overrides,
  });

interface Ga4Run {
  readonly app: PortfolioApp;
  readonly routes: readonly HttpClientSequenceRoute[];
  readonly credentials: Layer.Layer<StatsCredentialsShape>;
}

const runFeed = async (run: Ga4Run, feed = makeGa4Feed()) => {
  const httpTest = makeHttpClientSequenceTest(run.routes);
  const reply = await Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* StatsCredentials;
      return yield* feed.fetchDays({ app: run.app, range: RANGE, credentials });
    }).pipe(Effect.provide(Layer.merge(httpTest.layer, run.credentials))),
  );
  return { reply, sentRequests: httpTest.sentRequests };
};

const readFailureMessage = async (run: Ga4Run): Promise<string> => {
  const httpTest = makeHttpClientSequenceTest(run.routes);
  const failure = await Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* StatsCredentials;
      return yield* makeGa4Feed().fetchDays({ app: run.app, range: RANGE, credentials });
    }).pipe(Effect.flip, Effect.provide(Layer.merge(httpTest.layer, run.credentials))),
  );
  return failure.message;
};

const readSkippedReason = (reply: FeedFetchReply): string => {
  if (reply.status !== 'skipped') throw new Error('expected a skipped reply');
  return reply.reason;
};

describe('ga4Feed', () => {
  test('skips when no Google service account is saved', async () => {
    const { reply, sentRequests } = await runFeed({
      app: IOS_APP,
      routes: [],
      credentials: makeStatsCredentialsTest(),
    });

    expect(reply.status).toBe('skipped');
    expect(readSkippedReason(reply)).toContain('No Google service account saved');
    expect(sentRequests).toHaveLength(0);
  });

  test('finds the property by iOS bundle id and filters the report by its stream', async () => {
    const { reply, sentRequests } = await runFeed({
      app: IOS_APP,
      routes: [
        readTwoPropertySummaries(),
        streamsRoute('111', [IOS_STREAM]),
        streamsRoute('222', [ANDROID_STREAM, WEB_STREAM]),
        reportRoute('111', [
          {
            status: 200,
            body: { rows: [reportRow('20261001', '5', '2', '9')], rowCount: 1 },
          },
        ]),
      ],
      credentials: makeCredentials(),
    });

    const reportRequest = sentRequests.find((sent) => sent.url === RUN_REPORT_URL);
    const reportBody = JSON.parse(reportRequest?.bodyText ?? 'null');
    expect(reply).toEqual({
      status: 'fetched',
      coveredThrough: '2026-10-03',
      notes: [],
      stats: [
        { date: '2026-10-01', feed: 'ga4', metric: 'activeUsers', value: 5, currency: null },
        { date: '2026-10-01', feed: 'ga4', metric: 'newUsers', value: 2, currency: null },
        { date: '2026-10-01', feed: 'ga4', metric: 'sessions', value: 9, currency: null },
      ],
    });
    expect(reportRequest?.authorization).toBe(`Bearer ${SECRET_TOKEN}`);
    expect(reportBody.dateRanges).toEqual([{ startDate: '2026-10-01', endDate: '2026-10-03' }]);
    expect(reportBody.dimensionFilter.filter).toEqual({
      fieldName: 'streamId',
      stringFilter: { matchType: 'EXACT', value: '9001' },
    });
  });

  test('finds the property by Android package name', async () => {
    const { reply, sentRequests } = await runFeed({
      app: ANDROID_APP,
      routes: [
        readTwoPropertySummaries(),
        streamsRoute('111', [IOS_STREAM]),
        streamsRoute('222', [ANDROID_STREAM]),
        reportRoute('222', [{ status: 200, body: { rows: [], rowCount: 0 } }]),
      ],
      credentials: makeCredentials(),
    });

    expect(reply).toEqual({
      status: 'fetched',
      coveredThrough: '2026-10-03',
      notes: [],
      stats: [],
    });
    expect(sentRequests.some((sent) => sent.url.includes('properties/222:runReport'))).toBe(true);
  });

  test('skips with a tag hint when no property has a stream for the app', async () => {
    const { reply } = await runFeed({
      app: IOS_APP,
      routes: [
        readTwoPropertySummaries(),
        streamsRoute('111', [ANDROID_STREAM]),
        streamsRoute('222', [WEB_STREAM]),
      ],
      credentials: makeCredentials(),
    });

    expect(readSkippedReason(reply)).toBe(
      'No GA4 property with a stream for com.example.calfriend; tag one with launch apps tag --app calfriend --ga4-property <id>',
    );
  });

  test('uses the tagged property and filters by stream when it has one', async () => {
    const { reply, sentRequests } = await runFeed({
      app: { ...IOS_APP, ga4PropertyId: '111' },
      routes: [
        streamsRoute('111', [IOS_STREAM]),
        reportRoute('111', [{ status: 200, body: { rows: [], rowCount: 0 } }]),
      ],
      credentials: makeCredentials(),
    });

    const reportRequest = sentRequests.find((sent) => sent.url === RUN_REPORT_URL);
    expect(reply.status).toBe('fetched');
    expect(sentRequests.some((sent) => sent.url === ACCOUNT_SUMMARIES_URL)).toBe(false);
    expect(JSON.parse(reportRequest?.bodyText ?? 'null').dimensionFilter).toBeDefined();
  });

  test('reports the whole tagged property without a stream filter when it has no stream for the app', async () => {
    const { reply, sentRequests } = await runFeed({
      app: { ...IOS_APP, ga4PropertyId: '111' },
      routes: [
        streamsRoute('111', [WEB_STREAM]),
        reportRoute('111', [{ status: 200, body: { rows: [], rowCount: 0 } }]),
      ],
      credentials: makeCredentials(),
    });

    const reportRequest = sentRequests.find((sent) => sent.url === RUN_REPORT_URL);
    expect(reply.status === 'fetched' && reply.notes).toEqual([
      'GA4 property 111 has no stream for this app, so the numbers cover the whole property',
    ]);
    expect(JSON.parse(reportRequest?.bodyText ?? 'null').dimensionFilter).toBeUndefined();
  });

  test('pages the account summaries and data streams', async () => {
    const { reply, sentRequests } = await runFeed({
      app: IOS_APP,
      routes: [
        {
          method: 'GET',
          url: ACCOUNT_SUMMARIES_URL,
          replies: [
            {
              status: 200,
              body: {
                accountSummaries: [{ propertySummaries: [{ property: 'properties/222' }] }],
                nextPageToken: 'summaries-2',
              },
            },
          ],
        },
        {
          method: 'GET',
          url: `${ACCOUNT_SUMMARIES_URL}&pageToken=summaries-2`,
          replies: [
            {
              status: 200,
              body: { accountSummaries: [{ propertySummaries: [{ property: 'properties/111' }] }] },
            },
          ],
        },
        streamsRoute('222', [WEB_STREAM]),
        {
          method: 'GET',
          url: 'https://analyticsadmin.googleapis.com/v1beta/properties/111/dataStreams?pageSize=200',
          replies: [
            { status: 200, body: { dataStreams: [WEB_STREAM], nextPageToken: 'streams-2' } },
          ],
        },
        {
          method: 'GET',
          url: 'https://analyticsadmin.googleapis.com/v1beta/properties/111/dataStreams?pageSize=200&pageToken=streams-2',
          replies: [{ status: 200, body: { dataStreams: [IOS_STREAM] } }],
        },
        reportRoute('111', [{ status: 200, body: { rowCount: 0 } }]),
      ],
      credentials: makeCredentials(),
    });

    expect(reply.status).toBe('fetched');
    expect(sentRequests.some((sent) => sent.url.endsWith('pageToken=streams-2'))).toBe(true);
  });

  test('pages the report until the row count is reached', async () => {
    const { reply, sentRequests } = await runFeed({
      app: { ...IOS_APP, ga4PropertyId: '111' },
      routes: [
        streamsRoute('111', [IOS_STREAM]),
        reportRoute('111', [
          { status: 200, body: { rows: [reportRow('20261001', '1', '1', '1')], rowCount: 2 } },
          { status: 200, body: { rows: [reportRow('20261002', '3', '3', '3')], rowCount: 2 } },
        ]),
      ],
      credentials: makeCredentials(),
    });

    const reportBodies = sentRequests
      .filter((sent) => sent.url === RUN_REPORT_URL)
      .map((sent) => JSON.parse(sent.bodyText ?? 'null'));
    expect(reportBodies.map((reportBody) => reportBody.offset)).toEqual(['0', '1']);
    expect(reply.status === 'fetched' && reply.stats).toHaveLength(6);
  });

  test('skips with the Viewer hint when the report is permission denied', async () => {
    const { reply } = await runFeed({
      app: { ...IOS_APP, ga4PropertyId: '111' },
      routes: [
        streamsRoute('111', [IOS_STREAM]),
        reportRoute('111', [
          {
            status: 403,
            body: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'no access' } },
          },
        ]),
      ],
      credentials: makeCredentials(),
    });

    expect(readSkippedReason(reply)).toBe(
      'Add the launch Google service account as a Viewer on GA4 property 111',
    );
  });

  test('skips with the Viewer hint when the stream list is permission denied', async () => {
    const { reply } = await runFeed({
      app: { ...IOS_APP, ga4PropertyId: '111' },
      routes: [
        {
          method: 'GET',
          url: 'https://analyticsadmin.googleapis.com/v1beta/properties/111/dataStreams?pageSize=200',
          replies: [{ status: 403, body: { error: { status: 'PERMISSION_DENIED' } } }],
        },
      ],
      credentials: makeCredentials(),
    });

    expect(readSkippedReason(reply)).toContain('Viewer on GA4 property 111');
  });

  test('skips with the enable link and no secrets when an API is disabled', async () => {
    const { reply } = await runFeed({
      app: IOS_APP,
      routes: [
        {
          method: 'GET',
          url: ACCOUNT_SUMMARIES_URL,
          replies: [
            {
              status: 403,
              body: {
                error: {
                  status: 'PERMISSION_DENIED',
                  message: 'API has not been used',
                  details: [{ reason: 'SERVICE_DISABLED' }],
                },
              },
            },
          ],
        },
      ],
      credentials: makeCredentials(),
    });

    const reason = readSkippedReason(reply);
    expect(reason).toBe(
      'Enable the analyticsadmin.googleapis.com API for the launch Google service account project: https://console.developers.google.com/apis/api/analyticsadmin.googleapis.com/overview?project=client-project',
    );
    expect(reason).not.toContain(SECRET_EMAIL);
    expect(reason).not.toContain(SECRET_TOKEN);
  });

  test('skips when permission is denied while listing properties', async () => {
    const { reply } = await runFeed({
      app: IOS_APP,
      routes: [
        {
          method: 'GET',
          url: ACCOUNT_SUMMARIES_URL,
          replies: [{ status: 403, body: { error: { status: 'PERMISSION_DENIED' } } }],
        },
      ],
      credentials: makeCredentials(),
    });

    expect(readSkippedReason(reply)).toContain('refused to list properties');
  });

  test('fails with the Google message on any other error', async () => {
    const message = await readFailureMessage({
      app: { ...IOS_APP, ga4PropertyId: '111' },
      routes: [
        streamsRoute('111', [IOS_STREAM]),
        reportRoute('111', [{ status: 400, body: { error: { message: 'Invalid dimension' } } }]),
      ],
      credentials: makeCredentials(),
    });

    expect(message).toBe('Google Analytics error: Invalid dimension');
  });

  test('looks up the properties once for several apps in one run', async () => {
    const feed = makeGa4Feed();
    const routes = [
      readTwoPropertySummaries(),
      streamsRoute('111', [IOS_STREAM]),
      streamsRoute('222', [ANDROID_STREAM]),
      reportRoute('111', [{ status: 200, body: { rowCount: 0 } }]),
      reportRoute('222', [{ status: 200, body: { rowCount: 0 } }]),
    ];

    await runFeed({ app: IOS_APP, routes, credentials: makeCredentials() }, feed);
    const secondRun = await runFeed(
      { app: ANDROID_APP, routes, credentials: makeCredentials() },
      feed,
    );

    const summaryRequests = secondRun.sentRequests.filter(
      (sent) => sent.url === ACCOUNT_SUMMARIES_URL,
    );
    expect(summaryRequests).toHaveLength(0);
    expect(secondRun.reply.status).toBe('fetched');
  });
});
