import { describe, expect, test } from 'vitest';
import type { DailyStat } from '../types/stats.ts';
import { groupStatsByMonth, mergeStats } from './daily-stats.ts';

function createStat(overrides: Partial<DailyStat>): DailyStat {
  return {
    date: '2026-10-01',
    feed: 'app-store',
    metric: 'downloads',
    value: 1,
    currency: null,
    ...overrides,
  };
}

function describeMergeStats() {
  function replacesASavedNumberWithTheNewNumberOfTheSameIdentity() {
    const stat = createStat({ value: 1 });
    const merged = mergeStats([stat], [createStat({ value: 5 })]);

    expect(merged).toEqual([createStat({ value: 5 })]);
  }

  test(
    'replaces a saved number with the new number of the same identity',
    replacesASavedNumberWithTheNewNumberOfTheSameIdentity,
  );

  function keepsSavedDaysThatAreNotSentAgainSortedByDate() {
    const stat = createStat({ date: '2026-10-03' });
    const merged = mergeStats([stat], [createStat({ date: '2026-10-01' })]);

    function readDate(stat: DailyStat) {
      return stat.date;
    }

    expect(merged.map(readDate)).toEqual(['2026-10-01', '2026-10-03']);
  }

  test(
    'keeps saved days that are not sent again, sorted by date',
    keepsSavedDaysThatAreNotSentAgainSortedByDate,
  );

  function treatsAnotherCurrencyOrMetricAsAnotherIdentity() {
    const stat = createStat({ metric: 'proceeds', currency: 'USD' });
    const merged = mergeStats(
      [stat],
      [createStat({ metric: 'proceeds', currency: 'ILS' }), createStat({ metric: 'downloads' })],
    );

    expect(merged).toHaveLength(3);
  }

  test(
    'treats another currency or metric as another identity',
    treatsAnotherCurrencyOrMetricAsAnotherIdentity,
  );

  function returnsAnEmptyListForEmptyInputs() {
    const stats = mergeStats([], []);
    expect(stats).toEqual([]);
  }

  test('returns an empty list for empty inputs', returnsAnEmptyListForEmptyInputs);
}

describe('mergeStats', describeMergeStats);

function describeGroupStatsByMonth() {
  function groupsStatsOfTheSameMonthTogether() {
    const stat = createStat({ date: '2026-09-30' });
    const grouped = groupStatsByMonth([
      stat,
      createStat({ date: '2026-10-01' }),
      createStat({ date: '2026-10-02' }),
    ]);

    expect([...grouped.keys()]).toEqual(['2026-09', '2026-10']);
    expect(grouped.get('2026-10')).toHaveLength(2);
  }

  test('groups stats of the same month together', groupsStatsOfTheSameMonthTogether);

  function returnsAnEmptyMapForNoStats() {
    expect(groupStatsByMonth([]).size).toBe(0);
  }

  test('returns an empty map for no stats', returnsAnEmptyMapForNoStats);
}

describe('groupStatsByMonth', describeGroupStatsByMonth);
