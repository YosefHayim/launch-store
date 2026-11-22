import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  downloadBucketObject,
  failBucketRead,
  listBucketObjectNames,
} from './play-reports-bucket-client.ts';

const BUCKET_URL = 'https://storage.googleapis.com/storage/v1/b/pubsite_prod_rev_1/o';
const LIST_URL = `${BUCKET_URL}?prefix=earnings%2Fearnings_&fields=items(name),nextPageToken`;

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

async function settle<Success>(work: () => Promise<Success>): Promise<Settled<Success>> {
  try {
    const right = await work();

    return { _tag: 'Right', right };
  } catch (left) {
    return { _tag: 'Left', left };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downloadBucketObject', () => {
  const downloadInstalls = (status: number, body: unknown) => {
    installFetch([
      {
        method: 'GET',
        url: `${BUCKET_URL}/stats%2Finstalls%2Finstalls_com.fit_202610_overview.csv?alt=media`,
        status,
        body,
      },
    ]);

    return settle(() =>
      downloadBucketObject(
        'pubsite_prod_rev_1',
        'stats/installs/installs_com.fit_202610_overview.csv',
        'token-1',
      ),
    );
  };

  test('returns the bytes of an object that exists', async () => {
    const reply = await downloadInstalls(200, new Uint8Array([1, 2, 3]));

    expect(reply).toMatchObject({
      _tag: 'Right',
      right: { status: 'found', bytes: new Uint8Array([1, 2, 3]) },
    });
  });

  test('says missing for a 404, a month Play has not published yet', async () => {
    const reply = await downloadInstalls(404, { error: 'not found' });

    expect(reply).toMatchObject({ _tag: 'Right', right: { status: 'missing' } });
  });

  test('says forbidden for a 403', async () => {
    const reply = await downloadInstalls(403, { error: 'forbidden' });

    expect(reply).toMatchObject({ _tag: 'Right', right: { status: 'forbidden' } });
  });

  test('fails with a readable message for any other status', async () => {
    const reply = await downloadInstalls(500, { error: 'boom' });

    expect(reply).toMatchObject({
      _tag: 'Left',
      left: {
        _tag: 'PlayReportsBucketFailure',
        message: expect.stringContaining('HTTP 500'),
      },
    });
  });
});

describe('listBucketObjectNames', () => {
  const listEarnings = (routes: readonly HttpRoute[]) => {
    installFetch(routes);

    return settle(() =>
      listBucketObjectNames('pubsite_prod_rev_1', 'earnings/earnings_', 'token-1'),
    );
  };

  test('collects the names over every page', async () => {
    const reply = await listEarnings([
      {
        method: 'GET',
        url: LIST_URL,
        status: 200,
        body: { items: [{ name: 'earnings/earnings_202609.zip' }], nextPageToken: 'page-2' },
      },
      {
        method: 'GET',
        url: `${LIST_URL}&pageToken=page-2`,
        status: 200,
        body: { items: [{ name: 'earnings/earnings_202610.zip' }] },
      },
    ]);

    expect(reply).toMatchObject({
      _tag: 'Right',
      right: {
        status: 'listed',
        objectNames: ['earnings/earnings_202609.zip', 'earnings/earnings_202610.zip'],
      },
    });
  });

  test('lists nothing when the bucket has no matching object', async () => {
    const reply = await listEarnings([{ method: 'GET', url: LIST_URL, status: 200, body: {} }]);

    expect(reply).toMatchObject({ _tag: 'Right', right: { status: 'listed', objectNames: [] } });
  });

  test('says forbidden for a 403', async () => {
    const reply = await listEarnings([{ method: 'GET', url: LIST_URL, status: 403, body: {} }]);

    expect(reply).toMatchObject({ _tag: 'Right', right: { status: 'forbidden' } });
  });

  test('fails for a missing bucket or an unreadable listing', async () => {
    const missingBucket = await listEarnings([
      { method: 'GET', url: LIST_URL, status: 404, body: {} },
    ]);
    const brokenListing = await listEarnings([
      { method: 'GET', url: LIST_URL, status: 200, body: { items: 'nope' } },
    ]);

    expect(missingBucket).toMatchObject({
      _tag: 'Left',
      left: { message: expect.stringContaining('HTTP 404') },
    });
    expect(brokenListing).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'PlayReportsBucketFailure' },
    });
  });
});

describe('failBucketRead', () => {
  test('words the operation and the cause, and keeps the cause', () => {
    const failure = failBucketRead('unzip an earnings report', new Error('bad zip'));

    expect(failure.message).toBe('Could not unzip an earnings report: bad zip');
    expect(failure.cause).toBeInstanceOf(Error);
  });
});
