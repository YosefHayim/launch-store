import { describe, expect, test } from 'vitest';
import type { DailyStat, DateRange } from '@/types/stats.js';
import { readPlayCsvTable } from './play-csv-table.ts';
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
} from './play-report-stats.ts';

const OCTOBER: DateRange = { from: '2026-10-01', to: '2026-10-31' };
const EARNINGS_HEADER =
  'Description,Transaction Date,Transaction Time,Tax Type,Transaction Type,Refund Type,Product Title,Package ID,Product Type,SKU ID,Hardware,Buyer Country,Buyer State,Buyer Postcode,Buyer Currency,Amount (Buyer Currency),Currency Conversion Rate,Merchant Currency,Amount (Merchant Currency)';

function statOf(
  date: string,
  metric: DailyStat['metric'],
  value: number,
  currency: string | null = null,
): DailyStat {
  return { date, feed: 'google-play', metric, value, currency };
}

function earningsLine(
  transactionDate: string,
  transactionType: string,
  packageName: string,
  merchantCurrency: string,
  merchantAmount: string,
): string {
  return `GPA.1,"${transactionDate}",12:00:00 PM PDT,,${transactionType},,Coins,${packageName},One-time product,coins,mako,US,MA,02140,USD,1.00,1,${merchantCurrency},${merchantAmount}`;
}
function describeReadInstallStats() {
  function mapsTheDocumentedInstallColumnsToMetricsForEachDayInRange() {
    const table = readPlayCsvTable(
      `${'Date,Package Name,Current Device Installs,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Current User Installs,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs'}\n2026-10-01,com.fit,100,12,3,40,90,500,10,2,80\n`,
    );

    const stats = readInstallStats(table, OCTOBER);

    expect(stats).toEqual([
      statOf('2026-10-01', 'installs', 12),
      statOf('2026-10-01', 'uninstalls', 3),
      statOf('2026-10-01', 'updates', 40),
      statOf('2026-10-01', 'activeInstalls', 80),
    ]);
  }

  test(
    'maps the documented install columns to metrics for each day in range',
    mapsTheDocumentedInstallColumnsToMetricsForEachDayInRange,
  );

  function readsActiveInstallsFromTheDocumentedInstallsOnActiveDevicesHeaderToo() {
    const table = readPlayCsvTable(
      'Date,Daily Device Installs,Installs on Active Devices\n2026-10-01,12,75\n',
    );

    const stats = readInstallStats(table, OCTOBER);

    expect(stats).toContainEqual(statOf('2026-10-01', 'activeInstalls', 75));
  }

  test(
    'reads active installs from the documented "installs on active devices" header too',
    readsActiveInstallsFromTheDocumentedInstallsOnActiveDevicesHeaderToo,
  );

  function keepsOnlyDaysInsideTheRange() {
    const table = readPlayCsvTable(
      'Date,Daily Device Installs\n2026-09-30,1\n2026-10-01,2\n2026-10-31,3\n2026-11-01,4\n',
    );

    const stats = readInstallStats(table, OCTOBER);

    function readDate(stat: DailyStat) {
      return stat.date;
    }

    expect(stats.map(readDate)).toEqual(['2026-10-01', '2026-10-31']);
  }

  test('keeps only days inside the range', keepsOnlyDaysInsideTheRange);

  function skipsBlankAndUnreadableCellsAndLinesWithABadDate() {
    const table = readPlayCsvTable(
      'Date,Daily Device Installs,Daily Device Uninstalls\n2026-10-01,,abc\nnot-a-date,5,5\n,5,5\n2026-10-02,6,\n',
    );

    const stats = readInstallStats(table, OCTOBER);

    expect(stats).toEqual([statOf('2026-10-02', 'installs', 6)]);
  }

  test(
    'skips blank and unreadable cells and lines with a bad date',
    skipsBlankAndUnreadableCellsAndLinesWithABadDate,
  );

  function givesNothingForAFileWithoutADateColumn() {
    const table = readPlayCsvTable('Daily Device Installs\n5\n');

    const installStats = readInstallStats(table, OCTOBER);
    expect(installStats).toEqual([]);
  }

  test('gives nothing for a file without a date column', givesNothingForAFileWithoutADateColumn);
}

describe('readInstallStats', describeReadInstallStats);
function describeReadRatingStats() {
  function mapsTheTotalAverageRatingAndLeavesOutADayWithNoRatingYet() {
    const table = readPlayCsvTable(
      'Date,Package Name,Daily Average Rating,Total Average Rating\n2026-10-01,com.fit,5.00,4.16\n2026-10-02,com.fit,,\n',
    );

    const stats = readRatingStats(table, OCTOBER);

    expect(stats).toEqual([statOf('2026-10-01', 'ratingAverage', 4.16)]);
  }

  test(
    'maps the total average rating and leaves out a day with no rating yet',
    mapsTheTotalAverageRatingAndLeavesOutADayWithNoRatingYet,
  );
}

describe('readRatingStats', describeReadRatingStats);
function describeReadCrashStats() {
  function mapsDailyCrashesAndIgnoresTheANRColumn() {
    const table = readPlayCsvTable(
      'Date,Package Name,Daily Crashes,Daily ANRs\n2026-10-03,com.fit,4,9\n',
    );

    const stats = readCrashStats(table, OCTOBER);

    expect(stats).toEqual([statOf('2026-10-03', 'crashes', 4)]);
  }

  test('maps daily crashes and ignores the ANR column', mapsDailyCrashesAndIgnoresTheANRColumn);
}

describe('readCrashStats', describeReadCrashStats);
function describeReadStorePerformanceStats() {
  function addsStoreListingVisitorsOverTheCountriesOfOneDay() {
    const table = readPlayCsvTable(
      'Date,Package name,Country,Store listing acquisitions,Store listing visitors,Store listing conversion rate\n2026-10-01,com.fit,US,10,100,0.1\n2026-10-01,com.fit,UK,2,40,0.05\n2026-10-02,com.fit,US,1,30,0.03\n',
    );

    const stats = readStorePerformanceStats(table, OCTOBER);

    expect(stats).toEqual([
      statOf('2026-10-01', 'productPageViews', 140),
      statOf('2026-10-02', 'productPageViews', 30),
    ]);
  }

  test(
    'adds store listing visitors over the countries of one day',
    addsStoreListingVisitorsOverTheCountriesOfOneDay,
  );
}

describe('readStorePerformanceStats', describeReadStorePerformanceStats);
function describeFindLatestCsvDate() {
  function returnsTheNewestDateInTheFileEvenOutsideAnyRange() {
    const table = readPlayCsvTable(
      'Date,Daily Crashes\n2026-10-02,1\n2026-10-09,1\n2026-10-05,1\n',
    );

    const latestCsvDate = findLatestCsvDate(table);

    expect(latestCsvDate).toBe('2026-10-09');
  }

  test(
    'returns the newest date in the file, even outside any range',
    returnsTheNewestDateInTheFileEvenOutsideAnyRange,
  );

  function returnsNullForAFileWithNoReadableDate() {
    const table = readPlayCsvTable('Date,Daily Crashes\nsoon,1\n');

    const latestCsvDate = findLatestCsvDate(table);
    expect(latestCsvDate).toBeNull();
  }

  test('returns null for a file with no readable date', returnsNullForAFileWithNoReadableDate);
}

describe('findLatestCsvDate', describeFindLatestCsvDate);
function describeReadEarningsStats() {
  function addsSignedMerchantAmountsPerDayAndCurrencyForThePackage() {
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
  }

  test(
    'adds signed merchant amounts per day and currency for the package',
    addsSignedMerchantAmountsPerDayAndCurrencyForThePackage,
  );

  function leavesOutTaxLinesOtherPackagesAndDaysOutsideTheRange() {
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
  }

  test(
    'leaves out tax lines, other packages and days outside the range',
    leavesOutTaxLinesOtherPackagesAndDaysOutsideTheRange,
  );

  function skipsLinesWithAnUnreadableDateNoCurrencyOrNoAmount() {
    const table = readPlayCsvTable(
      [
        EARNINGS_HEADER,
        earningsLine('someday', 'Charge', 'com.fit', 'EUR', '1.00'),
        earningsLine('Foo 3, 2026', 'Charge', 'com.fit', 'EUR', '1.00'),
        earningsLine('Oct 3, 2026', 'Charge', 'com.fit', '', '1.00'),
        earningsLine('Oct 3, 2026', 'Charge', 'com.fit', 'EUR', ''),
      ].join('\n'),
    );

    const earningsStats = readEarningsStats(table, 'com.fit', OCTOBER);

    expect(earningsStats).toEqual([]);
  }

  test(
    'skips lines with an unreadable date, no currency or no amount',
    skipsLinesWithAnUnreadableDateNoCurrencyOrNoAmount,
  );

  function givesNothingWhenTheFileLacksTheEarningsColumns() {
    const table = readPlayCsvTable('Date,Daily Crashes\n2026-10-01,1\n');

    const earningsStats = readEarningsStats(table, 'com.fit', OCTOBER);
    expect(earningsStats).toEqual([]);
  }

  test(
    'gives nothing when the file lacks the earnings columns',
    givesNothingWhenTheFileLacksTheEarningsColumns,
  );
}

describe('readEarningsStats', describeReadEarningsStats);
function describeListReportMonths() {
  function listsOneMonthForARangeInsideAMonth() {
    const reportMonths = listReportMonths(OCTOBER);
    expect(reportMonths).toEqual(['202610']);
  }

  test('lists one month for a range inside a month', listsOneMonthForARangeInsideAMonth);

  function listsEveryMonthARangeTouchesAcrossAYearEnd() {
    const months = listReportMonths({ from: '2025-11-20', to: '2026-02-03' });

    expect(months).toEqual(['202511', '202512', '202601', '202602']);
  }

  test(
    'lists every month a range touches across a year end',
    listsEveryMonthARangeTouchesAcrossAYearEnd,
  );
}

describe('listReportMonths', describeListReportMonths);
function describeFindLastDayOfReportMonth() {
  function returnsTheLastDayOfShortLongAndLeapYearMonths() {
    const lastDayOfReportMonth = findLastDayOfReportMonth('202609');
    expect(lastDayOfReportMonth).toBe('2026-09-30');
    expect(findLastDayOfReportMonth('202610')).toBe('2026-10-31');
    expect(findLastDayOfReportMonth('202402')).toBe('2024-02-29');
  }

  test(
    'returns the last day of short, long and leap-year months',
    returnsTheLastDayOfShortLongAndLeapYearMonths,
  );
}

describe('findLastDayOfReportMonth', describeFindLastDayOfReportMonth);
function describePickLaterKnownDate() {
  function returnsTheLaterOfTwoDatesAndTakesTheSecondWhenThereIsNoFirst() {
    const laterKnownDate = pickLaterKnownDate(null, '2026-10-01');
    expect(laterKnownDate).toBe('2026-10-01');
    expect(pickLaterKnownDate('2026-10-05', '2026-10-01')).toBe('2026-10-05');
    expect(pickLaterKnownDate('2026-10-01', '2026-10-05')).toBe('2026-10-05');
  }

  test(
    'returns the later of two dates and takes the second when there is no first',
    returnsTheLaterOfTwoDatesAndTakesTheSecondWhenThereIsNoFirst,
  );
}

describe('pickLaterKnownDate', describePickLaterKnownDate);
