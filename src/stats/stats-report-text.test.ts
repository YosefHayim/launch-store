import { describe, expect, test } from 'vitest';
import type { AppStatsReport, MetricTotal } from '../types/stats-report.ts';
import {
  describeAppStats,
  describeCount,
  describeCrashRate,
  describeOwner,
  describeProceeds,
  describeRating,
} from './stats-report-text.ts';

function total(overrides: Partial<MetricTotal>): MetricTotal {
  return {
    feed: 'app-store',
    metric: 'downloads',
    currency: null,
    aggregation: 'sum',
    total: 1,
    dayCount: 1,
    ...overrides,
  };
}

function appReport(overrides: Partial<AppStatsReport>): AppStatsReport {
  return {
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
  };
}
function describeDescribeCount() {
  function addsThousandsSeparatorsAndDropsLongDecimals() {
    expect(describeCount(1234567)).toBe('1,234,567');
    expect(describeCount(2.345)).toBe('2.3');
  }

  test(
    'adds thousands separators and drops long decimals',
    addsThousandsSeparatorsAndDropsLongDecimals,
  );
  function showsADashForNoNumber() {
    expect(describeCount(null)).toBe('-');
  }

  test('shows a dash for no number', showsADashForNoNumber);
}

describe('describeCount', describeDescribeCount);
function describeDescribeProceeds() {
  function listsOnePartPerCurrency() {
    const totals = [
      total({ metric: 'proceeds', currency: 'EUR', total: 10 }),
      total({ metric: 'proceeds', currency: 'USD', total: 56.2 }),
    ];

    const proceeds = describeProceeds(totals);
    expect(proceeds).toBe('EUR 10.00, USD 56.20');
  }

  test('lists one part per currency', listsOnePartPerCurrency);
  function showsADashWhenThereAreNoProceeds() {
    const proceeds = describeProceeds([total({})]);
    expect(proceeds).toBe('-');
  }

  test('shows a dash when there are no proceeds', showsADashWhenThereAreNoProceeds);
}

describe('describeProceeds', describeDescribeProceeds);
function describeDescribeCrashRateAndDescribeRating() {
  function showsAFractionAsAPercentAndARatingWithTwoDecimals() {
    const crashRate = describeCrashRate(0.0042);
    expect(crashRate).toBe('0.42%');
    const rating = describeRating(4.666);
    expect(rating).toBe('4.67');
  }

  test(
    'shows a fraction as a percent and a rating with two decimals',
    showsAFractionAsAPercentAndARatingWithTwoDecimals,
  );
  function showsADashForNoNumber2() {
    const crashRate = describeCrashRate(null);
    expect(crashRate).toBe('-');
    const rating = describeRating(null);
    expect(rating).toBe('-');
  }

  test('shows a dash for no number', showsADashForNoNumber2);
}

describe('describeCrashRate and describeRating', describeDescribeCrashRateAndDescribeRating);
function describeDescribeOwner() {
  function showsTheOwnerOrUntaggedWhenThereIsNone() {
    const owner = describeOwner('mine');
    expect(owner).toBe('mine');
    expect(describeOwner(null)).toBe('untagged');
  }

  test('shows the owner, or untagged when there is none', showsTheOwnerOrUntaggedWhenThereIsNone);
}

describe('describeOwner', describeDescribeOwner);
function describeDescribeAppStats() {
  function showsATitleAndOneLinePerHeadlineWithSessions() {
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
  }

  test(
    'shows a title and one line per headline with sessions',
    showsATitleAndOneLinePerHeadlineWithSessions,
  );
  function showsTheSavedFeedMessagesUnderTheNumbers() {
    const lines = describeAppStats(appReport({ messages: ['app-store: Apple is preparing'] }));

    expect(lines.at(-1)).toBe('  note: app-store: Apple is preparing');
  }

  test('shows the saved feed messages under the numbers', showsTheSavedFeedMessagesUnderTheNumbers);
  function namesActiveUsersWhenOnlyThatFeedHasUsageAndMarksUntaggedApps() {
    const lines = describeAppStats(
      appReport({
        owner: null,
        totals: [total({ feed: 'ga4', metric: 'activeUsers', total: 40 })],
      }),
    );

    expect(lines[0]).toBe('Cal Friend (ios, untagged, alpha)');
    expect(lines).toContain('  active users  40');
    expect(lines).toContain('  downloads     -');
  }

  test(
    'names active users when only that feed has usage, and marks untagged apps',
    namesActiveUsersWhenOnlyThatFeedHasUsageAndMarksUntaggedApps,
  );
}

describe('describeAppStats', describeDescribeAppStats);
