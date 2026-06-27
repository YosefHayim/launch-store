import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { parseServiceAccount } from './playClient.js';
import { PlayReportingClient, resolveVitalsWindow, DEFAULT_VITALS_DAYS } from './playReporting.js';

/** A real RSA PKCS#8 key so `jose` can actually sign — the client mints a genuine RS256 assertion. */
function makeServiceAccountJson(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({
    type: 'service_account',
    client_email: 'launch@proj.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    private_key_id: 'kid-123',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
}

/** Minimal stand-in for the parts of `Response` the client reads. */
function fakeResponse(status: number, body: string) {
  return { status, ok: status >= 200 && status < 300, text: () => Promise.resolve(body) };
}

/** Decode a JWT payload (no verification needed — we only assert the claims we set). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload!, 'base64url').toString());
}

/** A freshness `:get` body with a DAILY latest end of the given ISO date. */
function freshnessBody(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return JSON.stringify({
    freshnessInfo: {
      freshnesses: [{ aggregationPeriod: 'DAILY', latestEndTime: { year, month, day } }],
    },
  });
}

/** A `:query` row for one day with crash-rate-shaped metric columns. */
function crashRow(iso: string, rate: string, userPerceived: string, users: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return {
    startTime: { year, month, day },
    metrics: [
      { metric: 'crashRate', decimalValue: { value: rate } },
      { metric: 'userPerceivedCrashRate', decimalValue: { value: userPerceived } },
      { metric: 'distinctUsers', decimalValue: { value: users } },
    ],
  };
}

describe('resolveVitalsWindow', () => {
  it('spans DEFAULT_VITALS_DAYS ending at the freshness date (inclusive)', () => {
    const window = resolveVitalsWindow('2026-06-28');
    expect(window.endDate).toBe('2026-06-28');
    expect(window.startDate).toBe('2026-06-01'); // 28 inclusive days: Jun 1 → Jun 28
    expect(DEFAULT_VITALS_DAYS).toBe(28);
  });

  it('honors a custom day count', () => {
    expect(resolveVitalsWindow('2026-06-28', 7)).toEqual({
      startDate: '2026-06-22',
      endDate: '2026-06-28',
    });
  });

  it('crosses month boundaries correctly', () => {
    expect(resolveVitalsWindow('2026-03-03', 7).startDate).toBe('2026-02-25');
  });

  it("falls back to today's date when freshness is unknown", () => {
    // Pin the clock so the two date reads (here + inside resolveVitalsWindow) can't straddle midnight.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    try {
      expect(resolveVitalsWindow(null, 1)).toEqual({
        startDate: '2026-06-15',
        endDate: '2026-06-15',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

const fetchMock = vi.fn();
let client: PlayReportingClient;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  client = new PlayReportingClient(parseServiceAccount(makeServiceAccountJson()));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PlayReportingClient — auth + crash-rate query', () => {
  it('mints a reporting-scoped token, then POSTs a DAILY timeline and normalizes the rows', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            rows: [
              crashRow('2026-06-02', '0.0123', '0.0099', '5000'),
              crashRow('2026-06-01', '0.02', '0.015', '4800'),
            ],
          }),
        ),
      );

    const rows = await client.queryCrashRate('com.example.app', {
      startDate: '2026-06-01',
      endDate: '2026-06-02',
    });

    // First call: token exchange carrying the reporting scope (NOT androidpublisher).
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    const assertion = (tokenInit.body as URLSearchParams).get('assertion')!;
    expect(decodeJwtPayload(assertion)['scope']).toBe(
      'https://www.googleapis.com/auth/playdeveloperreporting',
    );

    // Second call: the :query POST against the crash metric set with the bearer token + timelineSpec.
    const [queryUrl, queryInit] = fetchMock.mock.calls[1]!;
    expect(queryUrl).toBe(
      'https://playdeveloperreporting.googleapis.com/v1beta1/apps/com.example.app/crashRateMetricSet:query',
    );
    expect(queryInit.method).toBe('POST');
    expect((queryInit.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
    const body = JSON.parse(queryInit.body as string) as {
      timelineSpec: { aggregationPeriod: string; startTime: object; endTime: object };
      metrics: string[];
    };
    expect(body.timelineSpec.aggregationPeriod).toBe('DAILY');
    expect(body.timelineSpec.startTime).toEqual({ year: 2026, month: 6, day: 1 });
    expect(body.timelineSpec.endTime).toEqual({ year: 2026, month: 6, day: 2 });
    expect(body.metrics).toEqual(['crashRate', 'userPerceivedCrashRate', 'distinctUsers']);

    // Rows are normalized (string → number), tagged with the metric, and sorted ascending by date.
    expect(rows).toEqual([
      {
        metric: 'crash',
        date: '2026-06-01',
        rate: 0.02,
        userPerceivedRate: 0.015,
        distinctUsers: 4800,
      },
      {
        metric: 'crash',
        date: '2026-06-02',
        rate: 0.0123,
        userPerceivedRate: 0.0099,
        distinctUsers: 5000,
      },
    ]);
  });

  it('pages through nextPageToken and reuses the cached token', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            rows: [crashRow('2026-06-01', '0.02', '0.01', '10')],
            nextPageToken: 'p2',
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ rows: [crashRow('2026-06-02', '0.03', '0.02', '11')] })),
      );

    const rows = await client.queryCrashRate('com.example.app', {
      startDate: '2026-06-01',
      endDate: '2026-06-02',
    });

    expect(rows.map((row) => row.date)).toEqual(['2026-06-01', '2026-06-02']);
    // One token exchange + two query pages = three fetches; the second page carries the pageToken.
    expect(fetchMock.mock.calls).toHaveLength(3);
    const secondPage = JSON.parse(fetchMock.mock.calls[2]![1].body as string) as {
      pageToken?: string;
    };
    expect(secondPage.pageToken).toBe('p2');
  });

  it('queries the ANR metric set with its own metric names', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            rows: [
              {
                startTime: { year: 2026, month: 6, day: 1 },
                metrics: [
                  { metric: 'anrRate', decimalValue: { value: '0.005' } },
                  { metric: 'userPerceivedAnrRate', decimalValue: { value: '0.004' } },
                  { metric: 'distinctUsers', decimalValue: { value: '900' } },
                ],
              },
            ],
          }),
        ),
      );

    const rows = await client.queryAnrRate('com.example.app', {
      startDate: '2026-06-01',
      endDate: '2026-06-01',
    });

    expect(fetchMock.mock.calls[1]![0]).toContain('/anrRateMetricSet:query');
    const anrBody = JSON.parse(fetchMock.mock.calls[1]![1].body as string) as { metrics: string[] };
    expect(anrBody.metrics).toEqual(['anrRate', 'userPerceivedAnrRate', 'distinctUsers']);
    expect(rows).toEqual([
      {
        metric: 'anr',
        date: '2026-06-01',
        rate: 0.005,
        userPerceivedRate: 0.004,
        distinctUsers: 900,
      },
    ]);
  });

  it('omits missing metric columns rather than emitting NaN', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({ rows: [{ startTime: { year: 2026, month: 6, day: 1 }, metrics: [] }] }),
        ),
      );

    const rows = await client.queryCrashRate('com.example.app', {
      startDate: '2026-06-01',
      endDate: '2026-06-01',
    });
    expect(rows).toEqual([{ metric: 'crash', date: '2026-06-01' }]);
  });

  it('reads the latest DAILY freshness date from the metric set :get', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
      )
      .mockResolvedValueOnce(fakeResponse(200, freshnessBody('2026-06-20')));

    expect(await client.latestDailyDate('com.example.app', 'crash')).toBe('2026-06-20');
    expect(fetchMock.mock.calls[1]![0]).toBe(
      'https://playdeveloperreporting.googleapis.com/v1beta1/apps/com.example.app/crashRateMetricSet',
    );
  });

  it('returns null when no freshness has been published yet', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
      )
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({})));

    expect(await client.latestDailyDate('com.example.fresh', 'anr')).toBeNull();
  });

  it('vitalsTimeline bounds the window by freshness, then queries exactly that window', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
      )
      .mockResolvedValueOnce(fakeResponse(200, freshnessBody('2026-06-20')))
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({ rows: [crashRow('2026-06-20', '0.01', '0.008', '1000')] }),
        ),
      );

    const timeline = await client.vitalsTimeline('com.example.app', 'crash', 7);

    // Window ends at the freshness date and spans `days` inclusive (Jun 14 → Jun 20).
    expect(timeline.metric).toBe('crash');
    expect(timeline.window).toEqual({ startDate: '2026-06-14', endDate: '2026-06-20' });
    expect(timeline.rows).toEqual([
      {
        metric: 'crash',
        date: '2026-06-20',
        rate: 0.01,
        userPerceivedRate: 0.008,
        distinctUsers: 1000,
      },
    ]);
    // token (cached after) + freshness :get + :query = three fetches; the :query carried the bounded window.
    expect(fetchMock.mock.calls).toHaveLength(3);
    const queryBody = JSON.parse(fetchMock.mock.calls[2]![1].body as string) as {
      timelineSpec: { startTime: object; endTime: object };
    };
    expect(queryBody.timelineSpec.startTime).toEqual({ year: 2026, month: 6, day: 14 });
    expect(queryBody.timelineSpec.endTime).toEqual({ year: 2026, month: 6, day: 20 });
  });

  it("surfaces Google's error message on a failed query", async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
      )
      .mockResolvedValueOnce(
        fakeResponse(403, JSON.stringify({ error: { message: 'Reporting API not enabled.' } })),
      );

    await expect(
      client.queryCrashRate('com.example.app', { startDate: '2026-06-01', endDate: '2026-06-01' }),
    ).rejects.toThrow(/Reporting API not enabled/);
  });
});
