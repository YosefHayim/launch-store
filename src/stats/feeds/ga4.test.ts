import { afterEach, describe, expect, test, vi } from 'vitest';
import type { PortfolioApp } from '../../types/portfolio.ts';
import type { FeedFetchReply } from '../../types/stats.ts';
import type { StatsCredentialsApi } from '../statsCredentials.ts';
import { makeStatsCredentialsTest, useStatsCredentials } from '../statsCredentials.ts';
import { ga4Feed } from './ga4.ts';

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

interface SequenceReply {
  readonly status: number;
  readonly document: unknown;
}

interface SequenceRoute {
  readonly method: string;
  readonly url: string;
  readonly replies: readonly SequenceReply[];
}

interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly sentDocument: string | null;
}

function readRequestUrl(url: string | URL | Request): string {
  if (typeof url == 'string') {
    return url;
  }

  if (url instanceof URL) {
    return url.toString();
  }

  return url.url;
}

function isHeaderRecord(candidate: unknown): candidate is { authorization?: unknown } {
  const isMissing = candidate == null;

  if (isMissing) {
    return false;
  }

  const isObject = typeof candidate == 'object';

  if (isObject == false) {
    return false;
  }

  const isList = Array.isArray(candidate);

  return isList == false;
}

function readAuthorization(headers: unknown): string | null {
  const hasNoHeaders = headers == null;

  if (hasNoHeaders) {
    return null;
  }

  const isHeadersObject = headers instanceof Headers;

  if (isHeadersObject) {
    return headers.get('authorization');
  }

  const isRecordedHeader = isHeaderRecord(headers);

  if (isRecordedHeader == false) {
    return null;
  }

  const authorization = headers.authorization;
  const isAuthorizationText = typeof authorization == 'string';

  if (isAuthorizationText == false) {
    return null;
  }

  return authorization;
}

function readSentDocument(body: unknown): string | null {
  const isTextBody = typeof body == 'string';

  if (isTextBody == false) {
    return null;
  }

  return body;
}

function createReplyBody(document: unknown): string {
  if (typeof document == 'string') {
    return document;
  }

  return JSON.stringify(document);
}

function installSequenceFetch(routes: readonly SequenceRoute[], sentRequests: SentRequest[]): void {
  const answeredCounts = new Map<string, number>();

  vi.stubGlobal(
    'fetch',
    async function fetchRoute(url: string | URL | Request, init?: RequestInit): Promise<Response> {
      const method = init?.method ?? 'GET';
      const requestUrl = readRequestUrl(url);
      const routeKey = `${method} ${requestUrl}`;
      sentRequests.push({
        method,
        url: requestUrl,
        authorization: readAuthorization(init?.headers),
        sentDocument: readSentDocument(init?.body),
      });

      function matchesRoute(route: SequenceRoute): boolean {
        if (route.method != method) {
          return false;
        }

        return route.url == requestUrl;
      }

      const requestedRoute = routes.find(matchesRoute);

      if (requestedRoute == undefined) {
        throw new Error(`No test route for ${routeKey}`);
      }

      const answeredCount = answeredCounts.get(routeKey) ?? 0;
      answeredCounts.set(routeKey, answeredCount + 1);
      const lastReplyIndex = requestedRoute.replies.length - 1;
      const reply = requestedRoute.replies[Math.min(answeredCount, lastReplyIndex)];

      if (reply == undefined) {
        throw new Error(`Route ${routeKey} has no replies`);
      }

      return new Response(createReplyBody(reply.document), { status: reply.status });
    },
  );
}

const readTwoPropertySummaries = (): SequenceRoute => ({
  method: 'GET',
  url: ACCOUNT_SUMMARIES_URL,
  replies: [
    {
      status: 200,
      document: {
        accountSummaries: [
          { propertySummaries: [{ property: 'properties/111' }, { property: 'properties/222' }] },
        ],
      },
    },
  ],
});

const streamsRoute = (propertyId: string, dataStreams: readonly unknown[]): SequenceRoute => ({
  method: 'GET',
  url: `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/dataStreams?pageSize=200`,
  replies: [{ status: 200, document: { dataStreams } }],
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

const reportRoute = (propertyId: string, replies: SequenceRoute['replies']): SequenceRoute => ({
  method: 'POST',
  url: `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
  replies,
});

function makeCredentials(overrides: Partial<StatsCredentialsApi> = {}): StatsCredentialsApi {
  return makeStatsCredentialsTest({
    async googleAccessToken() {
      return SECRET_TOKEN;
    },
    async playServiceAccount() {
      return { clientEmail: SECRET_EMAIL, privateKey: 'key', tokenUri: 'uri' };
    },
    ...overrides,
  });
}

interface Ga4Run {
  readonly app: PortfolioApp;
  readonly routes: readonly SequenceRoute[];
  readonly credentials: StatsCredentialsApi;
}

async function runFeed(run: Ga4Run) {
  const sentRequests: SentRequest[] = [];
  installSequenceFetch(run.routes, sentRequests);
  const reply = await ga4Feed.fetchDays({
    app: run.app,
    range: RANGE,
    credentials: run.credentials,
  });

  return { reply, sentRequests };
}

function readThrownMessage(cause: unknown): string | null {
  if (cause == null) {
    return null;
  }

  if (typeof cause != 'object') {
    return null;
  }

  if ('message' in cause == false) {
    return null;
  }

  if (typeof cause.message != 'string') {
    return null;
  }

  return cause.message;
}

async function readFailureMessage(run: Ga4Run): Promise<string> {
  const sentRequests: SentRequest[] = [];
  installSequenceFetch(run.routes, sentRequests);

  try {
    await ga4Feed.fetchDays({ app: run.app, range: RANGE, credentials: run.credentials });
  } catch (cause) {
    const failureMessage = readThrownMessage(cause);

    if (failureMessage != null) {
      return failureMessage;
    }

    throw cause;
  }

  throw new Error('expected a failure');
}

afterEach(() => {
  useStatsCredentials(null);
  vi.unstubAllGlobals();
});

function readSentQuery(sentRequest: SentRequest | undefined) {
  if (sentRequest == null) {
    throw new Error('expected a sent report request');
  }

  if (sentRequest.sentDocument == null) {
    throw new Error('expected a sent report request');
  }

  return JSON.parse(sentRequest.sentDocument);
}

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
            document: { rows: [reportRow('20261001', '5', '2', '9')], rowCount: 1 },
          },
        ]),
      ],
      credentials: makeCredentials(),
    });

    const reportRequest = sentRequests.find((sent) => sent.url === RUN_REPORT_URL);
    const reportQuery = readSentQuery(reportRequest);
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
    expect(reportQuery.dateRanges).toEqual([{ startDate: '2026-10-01', endDate: '2026-10-03' }]);
    expect(reportQuery.dimensionFilter.filter).toEqual({
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
        reportRoute('222', [{ status: 200, document: { rows: [], rowCount: 0 } }]),
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
        reportRoute('111', [{ status: 200, document: { rows: [], rowCount: 0 } }]),
      ],
      credentials: makeCredentials(),
    });

    const reportRequest = sentRequests.find((sent) => sent.url === RUN_REPORT_URL);
    expect(reply.status).toBe('fetched');
    expect(sentRequests.some((sent) => sent.url === ACCOUNT_SUMMARIES_URL)).toBe(false);
    expect(readSentQuery(reportRequest).dimensionFilter).toBeDefined();
  });

  test('reports the whole tagged property without a stream filter when it has no stream for the app', async () => {
    const { reply, sentRequests } = await runFeed({
      app: { ...IOS_APP, ga4PropertyId: '111' },
      routes: [
        streamsRoute('111', [WEB_STREAM]),
        reportRoute('111', [{ status: 200, document: { rows: [], rowCount: 0 } }]),
      ],
      credentials: makeCredentials(),
    });

    const reportRequest = sentRequests.find((sent) => sent.url === RUN_REPORT_URL);
    expect(reply.status === 'fetched' && reply.notes).toEqual([
      'GA4 property 111 has no stream for this app, so the numbers cover the whole property',
    ]);
    expect(readSentQuery(reportRequest).dimensionFilter).toBeUndefined();
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
              document: {
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
              document: {
                accountSummaries: [{ propertySummaries: [{ property: 'properties/111' }] }],
              },
            },
          ],
        },
        streamsRoute('222', [WEB_STREAM]),
        {
          method: 'GET',
          url: 'https://analyticsadmin.googleapis.com/v1beta/properties/111/dataStreams?pageSize=200',
          replies: [
            { status: 200, document: { dataStreams: [WEB_STREAM], nextPageToken: 'streams-2' } },
          ],
        },
        {
          method: 'GET',
          url: 'https://analyticsadmin.googleapis.com/v1beta/properties/111/dataStreams?pageSize=200&pageToken=streams-2',
          replies: [{ status: 200, document: { dataStreams: [IOS_STREAM] } }],
        },
        reportRoute('111', [{ status: 200, document: { rowCount: 0 } }]),
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
          { status: 200, document: { rows: [reportRow('20261001', '1', '1', '1')], rowCount: 2 } },
          { status: 200, document: { rows: [reportRow('20261002', '3', '3', '3')], rowCount: 2 } },
        ]),
      ],
      credentials: makeCredentials(),
    });

    const reportQueries = sentRequests
      .filter((sent) => sent.url === RUN_REPORT_URL)
      .map((sent) => JSON.parse(String(sent.sentDocument)));
    expect(reportQueries.map((reportQuery) => reportQuery.offset)).toEqual(['0', '1']);
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
            document: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'no access' } },
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
          replies: [{ status: 403, document: { error: { status: 'PERMISSION_DENIED' } } }],
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
              document: {
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
          replies: [{ status: 403, document: { error: { status: 'PERMISSION_DENIED' } } }],
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
        reportRoute('111', [
          { status: 400, document: { error: { message: 'Invalid dimension' } } },
        ]),
      ],
      credentials: makeCredentials(),
    });

    expect(message).toBe('Google Analytics error: Invalid dimension');
  });

  test('fails with the HTTP status when an error reply is not JSON', async () => {
    vi.stubGlobal('fetch', async function fetchHtml(): Promise<Response> {
      return new Response('<html>Bad Gateway</html>', { status: 502 });
    });

    var failureMessage: string | null = null;

    try {
      await ga4Feed.fetchDays({ app: IOS_APP, range: RANGE, credentials: makeCredentials() });
    } catch (cause) {
      failureMessage = readThrownMessage(cause);
    }

    const shownMessage = failureMessage ?? '';

    expect(shownMessage).toContain('(HTTP 502) was not JSON');
  });
});
