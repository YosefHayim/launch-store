import { describe, expect, test } from 'vitest';
import type { DailyStat, DateRange } from '../../types/stats.js';
import { readPlayCsvTable } from './playCsvTable.js';
import {
  findLastDayOfReportMonth,
  findLatestCsvDate,
  listReportMonths,
  pickLaterKnownDate,
  readCrashStats,
  readEarningsStats,
  readInstallStats,
  readRatingStats,
  readStorePerformanceStats,
} from './playReportStats.js';

const OCTOBER: DateRange = { from: '2026-10-01', to: '2026-10-31' };

const INSTALLS_HEADER =
  'Date,Package Name,Current Device Installs,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Current User Installs,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs';
const EARNINGS_HEADER =
  'Description,Transaction Date,Transaction Time,Tax Type,Transaction Type,Refund Type,Product Title,Package ID,Product Type,SKU ID,Hardware,Buyer Country,Buyer State,Buyer Postcode,Buyer Currency,Amount (Buyer Currency),Currency Conversion Rate,Merchant Currency,Amount (Merchant Currency)';

const statOf = (
  date: string,
  metric: DailyStat['metric'],
  value: number,
  currency: string | null = null,
): DailyStat => ({ date, feed: 'google-play', metric, value, currency });

const earningsLine = (
  transactionDate: string,
  transactionType: string,
  packageName: string,
  merchantCurrency: string,
  merchantAmount: string,
): string =>
  `GPA.1,"${transactionDate}",12:00:00 PM PDT,,${transactionType},,Coins,${packageName},One-time product,coins,mako,US,MA,02140,USD,1.00,1,${merchantCurrency},${merchantAmount}`;

describe('readInstallStats', () => {
  test('maps the documented install columns to metrics for each day in range', () => {
    const table = readPlayCsvTable(
      `${INSTALLS_HEADER}\n2026-10-01,com.fit,100,12,3,40,90,500,10,2,80\n`,
    );

    const stats = readInstallStats(table, OCTOBER);

    expect(stats).toEqual([
      statOf('2026-10-01', 'installs', 12),
      statOf('2026-10-01', 'uninstalls', 3),
      statOf('2026-10-01', 'updates', 40),
      statOf('2026-10-01', 'activeInstalls', 80),
    ]);
  });

  test('reads active installs from the documented "installs on active devices" header too', () => {
    const table = readPlayCsvTable(
      'Date,Daily Device Installs,Installs on Active Devices\n2026-10-01,12,75\n',
    );

    const stats = readInstallStats(table, OCTOBER);

    expect(stats).toContainEqual(statOf('2026-10-01', 'activeInstalls', 75));
  });

  test('keeps only days inside the range', () => {
    const table = readPlayCsvTable(
      'Date,Daily Device Installs\n2026-09-30,1\n2026-10-01,2\n2026-10-31,3\n2026-11-01,4\n',
    );

    const stats = readInstallStats(table, OCTOBER);

    expect(stats.map((stat) => stat.date)).toEqual(['2026-10-01', '2026-10-31']);
  });

  test('skips blank and unreadable cells and lines with a bad date', () => {
    const table = readPlayCsvTable(
      'Date,Daily Device Installs,Daily Device Uninstalls\n2026-10-01,,abc\nnot-a-date,5,5\n,5,5\n2026-10-02,6,\n',
    );

    const stats = readInstallStats(table, OCTOBER);

    expect(stats).toEqual([statOf('2026-10-02', 'installs', 6)]);
  });

  test('gives nothing for a file without a date column', () => {
    const table = readPlayCsvTable('Daily Device Installs\n5\n');

    expect(readInstallStats(table, OCTOBER)).toEqual([]);
  });
});

describe('readRatingStats', () => {
  test('maps the total average rating and leaves out a day with no rating yet', () => {
    const table = readPlayCsvTable(
      'Date,Package Name,Daily Average Rating,Total Average Rating\n2026-10-01,com.fit,5.00,4.16\n2026-10-02,com.fit,,\n',
    );

    const stats = readRatingStats(table, OCTOBER);

    expect(stats).toEqual([statOf('2026-10-01', 'ratingAverage', 4.16)]);
  });
});

describe('readCrashStats', () => {
  test('maps daily crashes and ignores the ANR column', () => {
    const table = readPlayCsvTable(
      'Date,Package Name,Daily Crashes,Daily ANRs\n2026-10-03,com.fit,4,9\n',
    );

    const stats = readCrashStats(table, OCTOBER);

    expect(stats).toEqual([statOf('2026-10-03', 'crashes', 4)]);
  });
});

describe('readStorePerformanceStats', () => {
  test('adds store listing visitors over the countries of one day', () => {
    const table = readPlayCsvTable(
      'Date,Package name,Country,Store listing acquisitions,Store listing visitors,Store listing conversion rate\n2026-10-01,com.fit,US,10,100,0.1\n2026-10-01,com.fit,UK,2,40,0.05\n2026-10-02,com.fit,US,1,30,0.03\n',
    );

    const stats = readStorePerformanceStats(table, OCTOBER);

    expect(stats).toEqual([
      statOf('2026-10-01', 'productPageViews', 140),
      statOf('2026-10-02', 'productPageViews', 30),
    ]);
  });
});

describe('findLatestCsvDate', () => {
  test('returns the newest date in the file, even outside any range', () => {
    const table = readPlayCsvTable(
      'Date,Daily Crashes\n2026-10-02,1\n2026-10-09,1\n2026-10-05,1\n',
    );

    expect(findLatestCsvDate(table)).toBe('2026-10-09');
  });

  test('returns null for a file with no readable date', () => {
    const table = readPlayCsvTable('Date,Daily Crashes\nsoon,1\n');

    expect(findLatestCsvDate(table)).toBeNull();
  });
});

describe('readEarningsStats', () => {
  test('adds signed merchant amounts per day and currency for the package', () => {
    const table = readPlayCsvTable(
      [
        EARNINGS_HEADER,
        earningsLine('Oct 1, 2026', 'Charge', 'com.fit', 'EUR', '10.00'),
        earningsLine('Oct 1, 2026', 'Google fee', 'com.fit', 'EUR', '-1.50'),
        earningsLine('Oct 1, 2026', 'Charge', 'com.fit', 'ILS', '"1,000.00"'),
        earningsLine('Oct 2, 2026', 'Charge refund', 'com.fit', 'EUR', '-4.00'),
      ].join('\n'),
    );

    const stats = readEarningsStats(table, 'com.fit', OCTOBER);

    expect(stats).toEqual([
      statOf('2026-10-01', 'proceeds', 8.5, 'EUR'),
      statOf('2026-10-01', 'proceeds', 1000, 'ILS'),
      statOf('2026-10-02', 'proceeds', -4, 'EUR'),
    ]);
  });

  test('leaves out tax lines, other packages and days outside the range', () => {
    const table = readPlayCsvTable(
      [
        EARNINGS_HEADER,
        earningsLine('Oct 1, 2026', 'Tax', 'com.fit', 'EUR', '2.00'),
        earningsLine('Oct 1, 2026', 'Tax rebill', 'com.fit', 'EUR', '2.00'),
        earningsLine('Oct 1, 2026', 'Charge', 'com.other', 'EUR', '9.00'),
        earningsLine('Nov 1, 2026', 'Charge', 'com.fit', 'EUR', '9.00'),
        earningsLine('Oct 3, 2026', 'Charge', 'com.fit', 'EUR', '3.00'),
      ].join('\n'),
    );

    const stats = readEarningsStats(table, 'com.fit', OCTOBER);

    expect(stats).toEqual([statOf('2026-10-03', 'proceeds', 3, 'EUR')]);
  });

  test('skips lines with an unreadable date, no currency or no amount', () => {
    const table = readPlayCsvTable(
      [
        EARNINGS_HEADER,
        earningsLine('someday', 'Charge', 'com.fit', 'EUR', '1.00'),
        earningsLine('Foo 3, 2026', 'Charge', 'com.fit', 'EUR', '1.00'),
        earningsLine('Oct 3, 2026', 'Charge', 'com.fit', '', '1.00'),
        earningsLine('Oct 3, 2026', 'Charge', 'com.fit', 'EUR', ''),
      ].join('\n'),
    );

    expect(readEarningsStats(table, 'com.fit', OCTOBER)).toEqual([]);
  });

  test('gives nothing when the file lacks the earnings columns', () => {
    const table = readPlayCsvTable('Date,Daily Crashes\n2026-10-01,1\n');

    expect(readEarningsStats(table, 'com.fit', OCTOBER)).toEqual([]);
  });
});

describe('listReportMonths', () => {
  test('lists one month for a range inside a month', () => {
    expect(listReportMonths(OCTOBER)).toEqual(['202610']);
  });

  test('lists every month a range touches across a year end', () => {
    const months = listReportMonths({ from: '2025-11-20', to: '2026-02-03' });

    expect(months).toEqual(['202511', '202512', '202601', '202602']);
  });
});

describe('findLastDayOfReportMonth', () => {
  test('returns the last day of short, long and leap-year months', () => {
    expect(findLastDayOfReportMonth('202609')).toBe('2026-09-30');
    expect(findLastDayOfReportMonth('202610')).toBe('2026-10-31');
    expect(findLastDayOfReportMonth('202402')).toBe('2024-02-29');
  });
});

describe('pickLaterKnownDate', () => {
  test('returns the later of two dates and takes the second when there is no first', () => {
    expect(pickLaterKnownDate(null, '2026-10-01')).toBe('2026-10-01');
    expect(pickLaterKnownDate('2026-10-05', '2026-10-01')).toBe('2026-10-05');
    expect(pickLaterKnownDate('2026-10-01', '2026-10-05')).toBe('2026-10-05');
  });
});
