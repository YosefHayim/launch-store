import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseServiceAccount } from './play-client.ts';
import {
  PlayReportingClient,
  type PlayReportingTransport,
  vitalsWindowFromLatestDate,
} from './play-reporting.ts';
/** Minimal valid service-account JSON for adapter construction. */
const makeServiceAccountJson = (): string => {
  return JSON.stringify({
    type: 'service_account',
    client_email: 'launch@proj.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    private_key_id: 'kid-123',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
};
/** Generated freshness shape for one DAILY end date. */
const dailyFreshness = (isoDate: string) => {
  const dateSegments = isoDate.split('-').map(Number);
  return {
    freshnessInfo: {
      freshnesses: [
        {
          aggregationPeriod: 'DAILY',
          latestEndTime: {
            year: dateSegments[0],
            month: dateSegments[1],
            day: dateSegments[2],
          },
        },
      ],
    },
  };
};
/** Generated metrics entry for one crash-rate day. */
const crashMetricEntry = (
  isoDate: string,
  rate: string,
  userPerceivedRate: string,
  distinctUsers: string,
) => {
  const dateSegments = isoDate.split('-').map(Number);
  return {
    startTime: { year: dateSegments[0], month: dateSegments[1], day: dateSegments[2] },
    metrics: [
      { metric: 'crashRate', decimalValue: { value: rate } },
      { metric: 'userPerceivedCrashRate', decimalValue: { value: userPerceivedRate } },
      { metric: 'distinctUsers', decimalValue: { value: distinctUsers } },
    ],
  };
};
const getCrashFreshness = vi.fn();
const getAnrFreshness = vi.fn();
const queryCrashRate = vi.fn();
const queryAnrRate = vi.fn();
const searchApps = vi.fn();
/** Build the generated reporting-client slice exercised by adapter tests. */
const generatedReportingFake = (): PlayReportingTransport => {
  return {
    apps: { search: searchApps },
    vitals: {
      crashrate: { get: getCrashFreshness, query: queryCrashRate },
      anrrate: { get: getAnrFreshness, query: queryAnrRate },
    },
  };
};
let client: PlayReportingClient;
beforeEach(() => {
  vi.clearAllMocks();
  const makeServiceAccount = makeServiceAccountJson();
  const serviceAccount = parseServiceAccount(makeServiceAccount);
  client = new PlayReportingClient(serviceAccount, generatedReportingFake());
});
describe('vitalsWindowFromLatestDate', () => {
  it('spans the default inclusive window ending at freshness', () => {
    expect(vitalsWindowFromLatestDate('2026-06-28', 28)).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-06-28',
    });
  });
  it('honors a custom day count across month boundaries', () => {
    expect(vitalsWindowFromLatestDate('2026-03-03', 7)).toEqual({
      startDate: '2026-02-25',
      endDate: '2026-03-03',
    });
  });
  it("falls back to today's date when freshness is unknown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    try {
      expect(vitalsWindowFromLatestDate(null, 1)).toEqual({
        startDate: '2026-06-15',
        endDate: '2026-06-15',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
describe('PlayReportingClient generated metrics', () => {
  it('queries and normalizes crash-rate entries in date order', async () => {
    const crashMetric = crashMetricEntry('2026-06-02', '0.0123', '0.0099', '5000');
    queryCrashRate.mockResolvedValue({
      data: {
        rows: [crashMetric, crashMetricEntry('2026-06-01', '0.02', '0.015', '4800')],
      },
    });
    const entries = await client.queryCrashRate('com.example.app', {
      startDate: '2026-06-01',
      endDate: '2026-06-02',
    });
    expect(queryCrashRate).toHaveBeenCalledWith({
      name: 'apps/com.example.app/crashRateMetricSet',
      requestBody: {
        timelineSpec: {
          aggregationPeriod: 'DAILY',
          startTime: { year: 2026, month: 6, day: 1 },
          endTime: { year: 2026, month: 6, day: 2 },
        },
        metrics: ['crashRate', 'userPerceivedCrashRate', 'distinctUsers'],
      },
    });
    expect(entries).toEqual([
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
  it('pages through the generated nextPageToken', async () => {
    const crashMetric = crashMetricEntry('2026-06-01', '0.02', '0.01', '10');
    queryCrashRate
      .mockResolvedValueOnce({
        data: {
          rows: [crashMetric],
          nextPageToken: 'second-page',
        },
      })
      .mockResolvedValueOnce({
        data: { rows: [crashMetricEntry('2026-06-02', '0.03', '0.02', '11')] },
      });
    const entries = await client.queryCrashRate('com.example.app', {
      startDate: '2026-06-01',
      endDate: '2026-06-02',
    });
    expect(entries.map((metricEntry) => metricEntry.date)).toEqual(['2026-06-01', '2026-06-02']);
    expect(queryCrashRate).toHaveBeenCalledTimes(2);
    expect(queryCrashRate.mock.calls[1]?.[0].requestBody.pageToken).toBe('second-page');
  });
  it('uses the ANR resource and metric names', async () => {
    queryAnrRate.mockResolvedValue({
      data: {
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
      },
    });
    expect(
      await client.queryAnrRate('com.example.app', {
        startDate: '2026-06-01',
        endDate: '2026-06-01',
      }),
    ).toEqual([
      {
        metric: 'anr',
        date: '2026-06-01',
        rate: 0.005,
        userPerceivedRate: 0.004,
        distinctUsers: 900,
      },
    ]);
    expect(queryAnrRate.mock.calls[0]?.[0].name).toBe('apps/com.example.app/anrRateMetricSet');
  });
  it('omits missing metric columns', async () => {
    queryCrashRate.mockResolvedValue({
      data: { rows: [{ startTime: { year: 2026, month: 6, day: 1 }, metrics: [] }] },
    });
    expect(
      await client.queryCrashRate('com.example.app', {
        startDate: '2026-06-01',
        endDate: '2026-06-01',
      }),
    ).toEqual([{ metric: 'crash', date: '2026-06-01' }]);
  });
  it('reads DAILY freshness from the matching generated metric set', async () => {
    getCrashFreshness.mockResolvedValue({ data: dailyFreshness('2026-06-20') });
    getAnrFreshness.mockResolvedValue({ data: {} });
    expect(await client.latestDailyDate('com.example.app', 'crash')).toBe('2026-06-20');
    expect(getCrashFreshness).toHaveBeenCalledWith({
      name: 'apps/com.example.app/crashRateMetricSet',
    });
    expect(await client.latestDailyDate('com.example.app', 'anr')).toBeNull();
  });
  it('bounds the timeline query by generated freshness', async () => {
    getCrashFreshness.mockResolvedValue({ data: dailyFreshness('2026-06-20') });
    const crashMetric = crashMetricEntry('2026-06-20', '0.01', '0.008', '1000');
    queryCrashRate.mockResolvedValue({
      data: { rows: [crashMetric] },
    });
    const timeline = await client.vitalsTimeline('com.example.app', 'crash', 7);
    expect(timeline.window).toEqual({ startDate: '2026-06-14', endDate: '2026-06-20' });
    expect(timeline.rows[0]?.date).toBe('2026-06-20');
    expect(queryCrashRate.mock.calls[0]?.[0].requestBody.timelineSpec).toMatchObject({
      startTime: { year: 2026, month: 6, day: 14 },
      endTime: { year: 2026, month: 6, day: 20 },
    });
  });
  it("surfaces Google's error text from a generated request failure", async () => {
    queryCrashRate.mockRejectedValue(new Error('Reporting API not enabled.'));
    await expect(
      client.queryCrashRate('com.example.app', {
        startDate: '2026-06-01',
        endDate: '2026-06-01',
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Reporting API not enabled/),
    });
  });
});
describe('PlayReportingClient.listApps', () => {
  it('pages through every search page and keeps the package names', async () => {
    searchApps
      .mockResolvedValueOnce({
        data: {
          apps: [{ packageName: 'com.acme.one', displayName: 'One' }],
          nextPageToken: 'page-2',
        },
      })
      .mockResolvedValueOnce({
        data: { apps: [{ packageName: 'com.acme.two' }, { displayName: 'No package' }] },
      });

    const apps = await client.listApps();

    expect(apps).toEqual([
      { packageName: 'com.acme.one', displayName: 'One' },
      { packageName: 'com.acme.two', displayName: 'com.acme.two' },
    ]);
    expect(searchApps).toHaveBeenNthCalledWith(1, { pageSize: 1000 });
    expect(searchApps).toHaveBeenNthCalledWith(2, { pageSize: 1000, pageToken: 'page-2' });
  });

  it('returns an empty list when a page has no apps', async () => {
    searchApps.mockResolvedValueOnce({ data: {} });

    const apps = await client.listApps();

    expect(apps).toEqual([]);
  });

  it('fails with a reporting error when the search request fails', async () => {
    searchApps.mockRejectedValueOnce(new Error('forbidden'));

    await expect(client.listApps()).rejects.toMatchObject({
      message: expect.stringMatching(/search accessible apps/),
    });
  });
});
