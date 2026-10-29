import { describe, expect, test } from 'vitest';
import type { DailyStat, StatsFreshness } from '../types/stats.js';
import type { MetricSeries, MetricTotal } from '../types/statsReport.js';
import {
  createMetricSeries,
  foldMetricStats,
  foldMetricTotals,
  isAppStale,
  keepStatsInRange,
  listAppMessages,
  listMonthsInRange,
  mergeHeadlinePoints,
  pickHeadlineTotals,
  readHeadlineTotal,
} from './statsReportLogic.js';

const stat = (overrides: Partial<DailyStat>): DailyStat => ({
  date: '2026-10-01',
  feed: 'app-store',
  metric: 'downloads',
  value: 1,
  currency: null,
  ...overrides,
});

const total = (overrides: Partial<MetricTotal>): MetricTotal => ({
  feed: 'app-store',
  metric: 'downloads',
  currency: null,
  aggregation: 'sum',
  total: 1,
  dayCount: 1,
  ...overrides,
});

describe('listMonthsInRange', () => {
  test('returns one month when the range stays inside it', () => {
    expect(listMonthsInRange({ from: '2026-10-02', to: '2026-10-30' })).toEqual(['2026-10']);
  });

  test('returns every month a range touches, across a year end', () => {
    expect(listMonthsInRange({ from: '2026-11-30', to: '2027-02-01' })).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  test('returns nothing when the range ends before it starts', () => {
    expect(listMonthsInRange({ from: '2026-10-02', to: '2026-09-30' })).toEqual([]);
  });
});

describe('keepStatsInRange', () => {
  test('keeps both ends and drops days outside', () => {
    const stats = ['2026-09-30', '2026-10-01', '2026-10-05', '2026-10-06'].map((date) =>
      stat({ date }),
    );

    const kept = keepStatsInRange(stats, { from: '2026-10-01', to: '2026-10-05' });

    expect(kept.map((keptStat) => keptStat.date)).toEqual(['2026-10-01', '2026-10-05']);
  });

  test('returns an empty list for no stats', () => {
    expect(keepStatsInRange([], { from: '2026-10-01', to: '2026-10-05' })).toEqual([]);
  });
});

describe('foldMetricStats', () => {
  test('adds up a sum metric', () => {
    const stats = [stat({ value: 4 }), stat({ date: '2026-10-02', value: 6 })];

    expect(foldMetricStats('downloads', stats)).toBe(10);
  });

  test('takes the newest day for a latest metric, whatever the order', () => {
    const stats = [
      stat({ metric: 'ratingAverage', date: '2026-10-03', value: 4.5 }),
      stat({ metric: 'ratingAverage', date: '2026-10-01', value: 3 }),
    ];

    expect(foldMetricStats('ratingAverage', stats)).toBe(4.5);
  });

  test('averages an average metric', () => {
    const stats = [
      stat({ metric: 'crashRate', value: 0.01 }),
      stat({ metric: 'crashRate', date: '2026-10-02', value: 0.03 }),
    ];

    expect(foldMetricStats('crashRate', stats)).toBeCloseTo(0.02);
  });

  test('gives zero for no stats under every rule', () => {
    expect(foldMetricStats('downloads', [])).toBe(0);
    expect(foldMetricStats('ratingAverage', [])).toBe(0);
    expect(foldMetricStats('crashRate', [])).toBe(0);
  });
});

describe('foldMetricTotals', () => {
  test('keeps proceeds of different currencies apart', () => {
    const stats = [
      stat({ metric: 'proceeds', value: 5, currency: 'USD' }),
      stat({ metric: 'proceeds', date: '2026-10-02', value: 7, currency: 'USD' }),
      stat({ metric: 'proceeds', value: 3, currency: 'EUR' }),
    ];

    const totals = foldMetricTotals(stats);

    expect(totals.map((oneTotal) => [oneTotal.currency, oneTotal.total])).toEqual([
      ['EUR', 3],
      ['USD', 12],
    ]);
  });

  test('keeps feeds apart, orders groups and counts distinct days', () => {
    const stats = [
      stat({ feed: 'ga4', metric: 'sessions', value: 2 }),
      stat({ feed: 'app-store', metric: 'downloads', value: 1 }),
      stat({ feed: 'app-store', metric: 'downloads', value: 1 }),
    ];

    const totals = foldMetricTotals(stats);

    expect(totals.map((oneTotal) => `${oneTotal.feed}:${oneTotal.metric}`)).toEqual([
      'app-store:downloads',
      'ga4:sessions',
    ]);
    expect(totals[0]).toMatchObject({ aggregation: 'sum', total: 2, dayCount: 1 });
  });

  test('returns nothing for no stats', () => {
    expect(foldMetricTotals([])).toEqual([]);
  });
});

describe('createMetricSeries', () => {
  test('lists the days of each group oldest first', () => {
    const stats = [
      stat({ date: '2026-10-03', value: 3 }),
      stat({ date: '2026-10-01', value: 1 }),
      stat({ metric: 'sessions', value: 9 }),
    ];

    const series = createMetricSeries(stats);

    expect(series).toHaveLength(2);
    expect(series[0]?.points).toEqual([
      { date: '2026-10-01', amount: 1 },
      { date: '2026-10-03', amount: 3 },
    ]);
  });
});

describe('pickHeadlineTotals and readHeadlineTotal', () => {
  const totals = [
    total({ metric: 'installs', feed: 'google-play', total: 7 }),
    total({ metric: 'installs', feed: 'app-store', total: 5 }),
    total({ metric: 'ratingAverage', aggregation: 'latest', total: 4.2 }),
  ];

  test('uses the first preferred metric that has totals', () => {
    expect(pickHeadlineTotals(totals, ['downloads', 'installs'])).toHaveLength(2);
  });

  test('adds a sum metric over feeds', () => {
    expect(readHeadlineTotal(totals, ['downloads', 'installs'])).toBe(12);
  });

  test('takes the first feed for a metric that does not add up', () => {
    expect(readHeadlineTotal(totals, ['ratingAverage'])).toBe(4.2);
  });

  test('gives null and an empty list when no preferred metric exists', () => {
    expect(readHeadlineTotal(totals, ['crashRate'])).toBeNull();
    expect(pickHeadlineTotals(totals, ['crashRate'])).toEqual([]);
  });
});

describe('mergeHeadlinePoints', () => {
  const series: MetricSeries[] = [
    {
      feed: 'app-store',
      metric: 'downloads',
      currency: null,
      points: [
        { date: '2026-10-02', amount: 2 },
        { date: '2026-10-01', amount: 1 },
      ],
    },
    {
      feed: 'google-play',
      metric: 'downloads',
      currency: null,
      points: [{ date: '2026-10-02', amount: 5 }],
    },
    { feed: 'ga4', metric: 'sessions', currency: null, points: [] },
  ];

  test('adds feeds per day and sorts by day', () => {
    expect(mergeHeadlinePoints(series, ['downloads'])).toEqual([
      { date: '2026-10-01', amount: 1 },
      { date: '2026-10-02', amount: 7 },
    ]);
  });

  test('skips a metric whose series are empty and moves to the next', () => {
    expect(mergeHeadlinePoints(series, ['sessions', 'downloads'])).toHaveLength(2);
  });

  test('gives an empty list when nothing matches', () => {
    expect(mergeHeadlinePoints(series, ['crashRate'])).toEqual([]);
  });
});

describe('isAppStale and listAppMessages', () => {
  const report = {
    syncedAt: '2026-10-29T00:00:00.000Z',
    appFeeds: [
      {
        appKey: 'ios-1',
        feed: 'app-store' as const,
        status: 'failed' as const,
        statsWritten: 0,
        message: 'report not ready',
      },
      {
        appKey: 'ios-2',
        feed: 'app-store' as const,
        status: 'synced' as const,
        statsWritten: 3,
        message: null,
      },
    ],
  };

  test('is not stale when the freshness check was clean', () => {
    expect(isAppStale({ isStale: false, report: null }, 'ios-1')).toBe(false);
  });

  test('is stale for every app when the sync could not run', () => {
    expect(isAppStale({ isStale: true, report: null }, 'ios-2')).toBe(true);
  });

  test('is stale only for the app whose feed failed', () => {
    const freshness: StatsFreshness = { isStale: true, report };

    expect(isAppStale(freshness, 'ios-1')).toBe(true);
    expect(isAppStale(freshness, 'ios-2')).toBe(false);
  });

  test('lists the messages of one app only', () => {
    const freshness: StatsFreshness = { isStale: true, report };

    expect(listAppMessages(freshness, 'ios-1')).toEqual(['app-store: report not ready']);
    expect(listAppMessages(freshness, 'ios-2')).toEqual([]);
    expect(listAppMessages({ isStale: false, report: null }, 'ios-1')).toEqual([]);
  });
});
