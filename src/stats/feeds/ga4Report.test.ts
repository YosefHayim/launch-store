import { describe, expect, test } from 'vitest';
import { createStatsFromReport, readReportDate } from './ga4Report.js';

describe('readReportDate', () => {
  test('turns YYYYMMDD into YYYY-MM-DD', () => {
    expect(readReportDate('20261029')).toBe('2026-10-29');
  });
});

describe('createStatsFromReport', () => {
  test('returns nothing for a reply without rows', () => {
    expect(createStatsFromReport({ rows: [], rowCount: 0 })).toEqual([]);
  });

  test('skips a row without a date and a metric without a value', () => {
    const dailyStats = createStatsFromReport({
      rows: [
        { dimensionValues: [], metricValues: [{ value: '1' }] },
        { dimensionValues: [{ value: '20261001' }], metricValues: [{ value: '7' }] },
      ],
      rowCount: 2,
    });

    expect(dailyStats).toEqual([
      { date: '2026-10-01', feed: 'ga4', metric: 'activeUsers', value: 7, currency: null },
    ]);
  });
});
