import { describe, expect, test } from 'vitest';
import type { AppCoverage, DailyStat, StatsFreshness } from '../types/stats.ts';
import type { MetricTotal } from '../types/stats-report.ts';
import {
  createMetricSeries,
  foldMetricStats,
  foldMetricTotals,
  isAppStale,
  keepStatsInRange,
  listAppMessages,
  listMonthsInRange,
  pickHeadlineTotals,
  readHeadlineTotal,
} from './stats-series.ts';

function stat(overrides: Partial<DailyStat>): DailyStat {
  return {
    date: '2026-10-01',
    feed: 'app-store',
    metric: 'downloads',
    value: 1,
    currency: null,
    ...overrides,
  };
}

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

function describeListMonthsInRange() {
  function returnsOneMonthWhenTheRangeStaysInsideIt() {
    const monthsInRange = listMonthsInRange({ from: '2026-10-02', to: '2026-10-30' });
    expect(monthsInRange).toEqual(['2026-10']);
  }

  test(
    'returns one month when the range stays inside it',
    returnsOneMonthWhenTheRangeStaysInsideIt,
  );

  function returnsEveryMonthARangeTouchesAcrossAYearEnd() {
    const monthsInRange = listMonthsInRange({ from: '2026-11-30', to: '2027-02-01' });
    expect(monthsInRange).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  }

  test(
    'returns every month a range touches, across a year end',
    returnsEveryMonthARangeTouchesAcrossAYearEnd,
  );

  function returnsNothingWhenTheRangeEndsBeforeItStarts() {
    const monthsInRange = listMonthsInRange({ from: '2026-10-02', to: '2026-09-30' });
    expect(monthsInRange).toEqual([]);
  }

  test(
    'returns nothing when the range ends before it starts',
    returnsNothingWhenTheRangeEndsBeforeItStarts,
  );
}

describe('listMonthsInRange', describeListMonthsInRange);

function describeKeepStatsInRange() {
  function keepsBothEndsAndDropsDaysOutside() {
    function createDatedStat(date: string) {
      return stat({ date });
    }

    const stats = ['2026-09-30', '2026-10-01', '2026-10-05', '2026-10-06'].map(createDatedStat);

    const kept = keepStatsInRange(stats, { from: '2026-10-01', to: '2026-10-05' });

    function readDate(keptStat: DailyStat) {
      return keptStat.date;
    }

    expect(kept.map(readDate)).toEqual(['2026-10-01', '2026-10-05']);
  }

  test('keeps both ends and drops days outside', keepsBothEndsAndDropsDaysOutside);

  function returnsAnEmptyListForNoStats() {
    expect(keepStatsInRange([], { from: '2026-10-01', to: '2026-10-05' })).toEqual([]);
  }

  test('returns an empty list for no stats', returnsAnEmptyListForNoStats);
}

describe('keepStatsInRange', describeKeepStatsInRange);

function describeFoldMetricStats() {
  function addsUpASumMetric() {
    const stats = [stat({ value: 4 }), stat({ date: '2026-10-02', value: 6 })];

    expect(foldMetricStats('downloads', stats)).toBe(10);
  }

  test('adds up a sum metric', addsUpASumMetric);

  function takesTheNewestDayForALatestMetricWhateverTheOrder() {
    const stats = [
      stat({ metric: 'ratingAverage', date: '2026-10-03', value: 4.5 }),
      stat({ metric: 'ratingAverage', date: '2026-10-01', value: 3 }),
    ];

    expect(foldMetricStats('ratingAverage', stats)).toBe(4.5);
  }

  test(
    'takes the newest day for a latest metric, whatever the order',
    takesTheNewestDayForALatestMetricWhateverTheOrder,
  );

  function averagesAnAverageMetric() {
    const stats = [
      stat({ metric: 'crashRate', value: 0.01 }),
      stat({ metric: 'crashRate', date: '2026-10-02', value: 0.03 }),
    ];

    expect(foldMetricStats('crashRate', stats)).toBeCloseTo(0.02);
  }

  test('averages an average metric', averagesAnAverageMetric);

  function givesZeroForNoStatsUnderEveryRule() {
    expect(foldMetricStats('downloads', [])).toBe(0);
    expect(foldMetricStats('ratingAverage', [])).toBe(0);
    expect(foldMetricStats('crashRate', [])).toBe(0);
  }

  test('gives zero for no stats under every rule', givesZeroForNoStatsUnderEveryRule);
}

describe('foldMetricStats', describeFoldMetricStats);

function describeFoldMetricTotals() {
  function keepsProceedsOfDifferentCurrenciesApart() {
    const stats = [
      stat({ metric: 'proceeds', value: 5, currency: 'USD' }),
      stat({ metric: 'proceeds', date: '2026-10-02', value: 7, currency: 'USD' }),
      stat({ metric: 'proceeds', value: 3, currency: 'EUR' }),
    ];

    const totals = foldMetricTotals(stats);

    function readCurrencyTotal(oneTotal: MetricTotal) {
      return [oneTotal.currency, oneTotal.total];
    }

    expect(totals.map(readCurrencyTotal)).toEqual([
      ['EUR', 3],
      ['USD', 12],
    ]);
  }

  test('keeps proceeds of different currencies apart', keepsProceedsOfDifferentCurrenciesApart);

  function keepsFeedsApartOrdersGroupsAndCountsDistinctDays() {
    const stats = [
      stat({ feed: 'ga4', metric: 'sessions', value: 2 }),
      stat({ feed: 'app-store', metric: 'downloads', value: 1 }),
      stat({ feed: 'app-store', metric: 'downloads', value: 1 }),
    ];

    const totals = foldMetricTotals(stats);

    function readFeedMetric(oneTotal: MetricTotal) {
      return `${oneTotal.feed}:${oneTotal.metric}`;
    }

    expect(totals.map(readFeedMetric)).toEqual(['app-store:downloads', 'ga4:sessions']);
    expect(totals[0]).toMatchObject({ aggregation: 'sum', total: 2, dayCount: 1 });
  }

  test(
    'keeps feeds apart, orders groups and counts distinct days',
    keepsFeedsApartOrdersGroupsAndCountsDistinctDays,
  );

  function returnsNothingForNoStats() {
    expect(foldMetricTotals([])).toEqual([]);
  }

  test('returns nothing for no stats', returnsNothingForNoStats);
}

describe('foldMetricTotals', describeFoldMetricTotals);

function describeCreateMetricSeries() {
  function listsTheDaysOfEachGroupOldestFirst() {
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
  }

  test('lists the days of each group oldest first', listsTheDaysOfEachGroupOldestFirst);
}

describe('createMetricSeries', describeCreateMetricSeries);

function describePickHeadlineTotalsAndReadHeadlineTotal() {
  const totals = [
    total({ metric: 'installs', feed: 'google-play', total: 7 }),
    total({ metric: 'installs', feed: 'app-store', total: 5 }),
    total({ metric: 'ratingAverage', aggregation: 'latest', total: 4.2 }),
  ];

  function usesTheFirstPreferredMetricThatHasTotals() {
    const headlineTotals = pickHeadlineTotals(totals, ['downloads', 'installs']);
    expect(headlineTotals).toHaveLength(2);
  }

  test('uses the first preferred metric that has totals', usesTheFirstPreferredMetricThatHasTotals);

  function addsASumMetricOverFeeds() {
    const headlineTotal = readHeadlineTotal(totals, ['downloads', 'installs']);
    expect(headlineTotal).toBe(12);
  }

  test('adds a sum metric over feeds', addsASumMetricOverFeeds);

  function takesTheFirstFeedForAMetricThatDoesNotAddUp() {
    const headlineTotal = readHeadlineTotal(totals, ['ratingAverage']);
    expect(headlineTotal).toBe(4.2);
  }

  test(
    'takes the first feed for a metric that does not add up',
    takesTheFirstFeedForAMetricThatDoesNotAddUp,
  );

  function givesNullAndAnEmptyListWhenNoPreferredMetricExists() {
    const headlineTotal = readHeadlineTotal(totals, ['crashRate']);
    expect(headlineTotal).toBeNull();
    const headlineTotals = pickHeadlineTotals(totals, ['crashRate']);
    expect(headlineTotals).toEqual([]);
  }

  test(
    'gives null and an empty list when no preferred metric exists',
    givesNullAndAnEmptyListWhenNoPreferredMetricExists,
  );
}

describe(
  'pickHeadlineTotals and readHeadlineTotal',
  describePickHeadlineTotalsAndReadHeadlineTotal,
);

function describeIsAppStaleAndListAppMessages() {
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

  function isNotStaleWhenTheFreshnessCheckWasClean() {
    expect(isAppStale({ isStale: false, report: null }, 'ios-1')).toBe(false);
  }

  test('is not stale when the freshness check was clean', isNotStaleWhenTheFreshnessCheckWasClean);

  function isStaleForEveryAppWhenTheSyncCouldNotRun() {
    expect(isAppStale({ isStale: true, report: null }, 'ios-2')).toBe(true);
  }

  test(
    'is stale for every app when the sync could not run',
    isStaleForEveryAppWhenTheSyncCouldNotRun,
  );

  function isStaleOnlyForTheAppWhoseFeedFailed() {
    const freshness: StatsFreshness = { isStale: true, report };

    expect(isAppStale(freshness, 'ios-1')).toBe(true);
    expect(isAppStale(freshness, 'ios-2')).toBe(false);
  }

  test('is stale only for the app whose feed failed', isStaleOnlyForTheAppWhoseFeedFailed);

  function listsTheSavedErrorAndNoteOfEveryFeedOfOneApp() {
    const feedCoverage = {
      lastSyncedAt: '2026-10-29T00:00:00.000Z',
      coveredFrom: null,
      coveredThrough: null,
      lastError: null,
      lastNote: null,
    };
    const appCoverage: AppCoverage = {
      version: 1,
      appKey: 'ios-1',
      feeds: {
        'app-store': { ...feedCoverage, lastNote: 'Apple is preparing analytics' },
        ga4: { ...feedCoverage, lastError: 'API disabled' },
        'google-play': feedCoverage,
      },
    };

    const appMessages = listAppMessages(appCoverage);

    expect(appMessages).toEqual(['app-store: Apple is preparing analytics', 'ga4: API disabled']);
  }

  test(
    'lists the saved error and note of every feed of one app',
    listsTheSavedErrorAndNoteOfEveryFeedOfOneApp,
  );

  function listsNothingForAnAppThatWasNeverSynced() {
    const appMessages = listAppMessages({ version: 1, appKey: 'ios-1', feeds: {} });
    expect(appMessages).toEqual([]);
  }

  test('lists nothing for an app that was never synced', listsNothingForAnAppThatWasNeverSynced);
}

describe('isAppStale and listAppMessages', describeIsAppStaleAndListAppMessages);
