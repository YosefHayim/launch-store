import { describe, expect, test } from 'vitest';
import type { DailyStat } from '../types/stats.js';
import { groupStatsByMonth, mergeStats } from './statsLogic.js';

const createStat = (overrides: Partial<DailyStat>): DailyStat => ({
  date: '2026-10-01',
  feed: 'app-store',
  metric: 'downloads',
  value: 1,
  currency: null,
  ...overrides,
});

describe('mergeStats', () => {
  test('replaces a saved number with the new number of the same identity', () => {
    const merged = mergeStats([createStat({ value: 1 })], [createStat({ value: 5 })]);

    expect(merged).toEqual([createStat({ value: 5 })]);
  });

  test('keeps saved days that are not sent again, sorted by date', () => {
    const merged = mergeStats(
      [createStat({ date: '2026-10-03' })],
      [createStat({ date: '2026-10-01' })],
    );

    expect(merged.map((stat) => stat.date)).toEqual(['2026-10-01', '2026-10-03']);
  });

  test('treats another currency or metric as another identity', () => {
    const merged = mergeStats(
      [createStat({ metric: 'proceeds', currency: 'USD' })],
      [createStat({ metric: 'proceeds', currency: 'ILS' }), createStat({ metric: 'downloads' })],
    );

    expect(merged).toHaveLength(3);
  });

  test('returns an empty list for empty inputs', () => {
    expect(mergeStats([], [])).toEqual([]);
  });
});

describe('groupStatsByMonth', () => {
  test('groups stats of the same month together', () => {
    const grouped = groupStatsByMonth([
      createStat({ date: '2026-09-30' }),
      createStat({ date: '2026-10-01' }),
      createStat({ date: '2026-10-02' }),
    ]);

    expect([...grouped.keys()]).toEqual(['2026-09', '2026-10']);
    expect(grouped.get('2026-10')).toHaveLength(2);
  });

  test('returns an empty map for no stats', () => {
    expect(groupStatsByMonth([]).size).toBe(0);
  });
});
