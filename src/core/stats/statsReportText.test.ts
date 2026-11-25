import { describe, expect, test } from 'vitest';
import type { AppStatsReport, MetricTotal } from '../types/statsReport.js';
import {
  describeAppStats,
  describeCount,
  describeCrashRate,
  describeOwner,
  describeProceeds,
  describeRating,
} from './statsReportText.js';

const total = (overrides: Partial<MetricTotal>): MetricTotal => ({
  feed: 'app-store',
  metric: 'downloads',
  currency: null,
  aggregation: 'sum',
  total: 1,
  dayCount: 1,
  ...overrides,
});

const appReport = (overrides: Partial<AppStatsReport>): AppStatsReport => ({
  key: 'ios-1',
  name: 'Cal Friend',
  platform: 'ios',
  owner: 'mine',
  accountLabel: 'alpha',
  totals: [],
  series: [],
  isStale: false,
  messages: [],
  ...overrides,
});

describe('describeCount', () => {
  test('adds thousands separators and drops long decimals', () => {
    expect(describeCount(1234567)).toBe('1,234,567');
    expect(describeCount(2.345)).toBe('2.3');
  });

  test('shows a dash for no number', () => {
    expect(describeCount(null)).toBe('-');
  });
});

describe('describeProceeds', () => {
  test('lists one part per currency', () => {
    const totals = [
      total({ metric: 'proceeds', currency: 'EUR', total: 10 }),
      total({ metric: 'proceeds', currency: 'USD', total: 56.2 }),
    ];

    expect(describeProceeds(totals)).toBe('EUR 10.00, USD 56.20');
  });

  test('shows a dash when there are no proceeds', () => {
    expect(describeProceeds([total({})])).toBe('-');
  });
});

describe('describeCrashRate and describeRating', () => {
  test('shows a fraction as a percent and a rating with two decimals', () => {
    expect(describeCrashRate(0.0042)).toBe('0.42%');
    expect(describeRating(4.666)).toBe('4.67');
  });

  test('shows a dash for no number', () => {
    expect(describeCrashRate(null)).toBe('-');
    expect(describeRating(null)).toBe('-');
  });
});

describe('describeOwner', () => {
  test('shows the owner, or untagged when there is none', () => {
    expect(describeOwner('mine')).toBe('mine');
    expect(describeOwner(null)).toBe('untagged');
  });
});

describe('describeAppStats', () => {
  test('shows a title and one line per headline with sessions', () => {
    const lines = describeAppStats(
      appReport({
        totals: [
          total({ total: 1200 }),
          total({ feed: 'ga4', metric: 'sessions', total: 300 }),
          total({ feed: 'ga4', metric: 'crashRate', aggregation: 'average', total: 0.01 }),
          total({ metric: 'ratingAverage', aggregation: 'latest', total: 4.7 }),
        ],
      }),
    );

    expect(lines[0]).toBe('Cal Friend (ios, mine, alpha)');
    expect(lines).toContain('  downloads     1,200');
    expect(lines).toContain('  sessions      300');
    expect(lines).toContain('  crash rate    1.00%');
    expect(lines).toContain('  rating        4.70');
  });

  test('shows the saved feed messages under the numbers', () => {
    const lines = describeAppStats(appReport({ messages: ['app-store: Apple is preparing'] }));

    expect(lines.at(-1)).toBe('  note: app-store: Apple is preparing');
  });

  test('names active users when only that feed has usage, and marks untagged apps', () => {
    const lines = describeAppStats(
      appReport({
        owner: null,
        totals: [total({ feed: 'ga4', metric: 'activeUsers', total: 40 })],
      }),
    );

    expect(lines[0]).toBe('Cal Friend (ios, untagged, alpha)');
    expect(lines).toContain('  active users  40');
    expect(lines).toContain('  downloads     -');
  });
});
