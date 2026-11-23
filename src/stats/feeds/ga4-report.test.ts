import { describe, expect, test } from 'vitest';
import { createStatsFromReport, readReportDate } from './ga4-report.ts';

function describeReadReportDate() {
  function turnsYYYYMMDDIntoYYYYMMDD() {
    const reportDate = readReportDate('20261029');
    expect(reportDate).toBe('2026-10-29');
  }

  test('turns YYYYMMDD into YYYY-MM-DD', turnsYYYYMMDDIntoYYYYMMDD);
}

describe('readReportDate', describeReadReportDate);

function describeCreateStatsFromReport() {
  function returnsNothingForAReplyWithoutRows() {
    const statsFromReport = createStatsFromReport({ rows: [], rowCount: 0 });
    expect(statsFromReport).toEqual([]);
  }

  test('returns nothing for a reply without rows', returnsNothingForAReplyWithoutRows);

  function skipsAPieceWithoutADateAndAMetricWithoutAPiece() {
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
  }

  test(
    'skips a row without a date and a metric without a value',
    skipsAPieceWithoutADateAndAMetricWithoutAPiece,
  );
}

describe('createStatsFromReport', describeCreateStatsFromReport);
