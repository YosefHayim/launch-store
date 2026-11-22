import type { DailyStat, DateRange, StatsMetric } from '../../types/stats.ts';
import { pickLaterDate, readMonthOfDate } from '../date-range.ts';
import type { PlayCsvTable } from './play-csv-table.ts';

interface PlayColumnMapping {
  readonly columnNames: readonly string[];
  readonly metric: StatsMetric;
}

export const pickLaterKnownDate = (firstDate: string | null, secondDate: string): string => {
  if (firstDate == null) return secondDate;
  return pickLaterDate(firstDate, secondDate);
};

const isDateInRange = (date: string, range: DateRange): boolean =>
  date >= range.from && date <= range.to;

const readNumber = (cell: string | undefined): number | null => {
  if (cell == null) return null;
  const withoutThousandsSeparators = cell.replaceAll(',', '');
  const isCellBlank = withoutThousandsSeparators == '';
  if (isCellBlank) return null;
  const cellNumber = Number(withoutThousandsSeparators);
  const isCellNumeric = Number.isFinite(cellNumber);
  if (!isCellNumeric) return null;
  return cellNumber;
};

const readFirstColumn = (
  line: Readonly<Record<string, string>>,
  columnNames: readonly string[],
): string | undefined => {
  const presentColumnName = columnNames.find((columnName) => line[columnName] != null);
  if (presentColumnName == null) return undefined;
  return line[presentColumnName];
};

const readDateOfLine = (line: Readonly<Record<string, string>>): string | null => {
  const date = line['date'];
  if (date == null) return null;
  const isDateIso = /^\d{4}-\d{2}-\d{2}$/.test(date);
  if (!isDateIso) return null;
  return date;
};

const readMappedStats = (
  table: PlayCsvTable,
  range: DateRange,
  mappings: readonly PlayColumnMapping[],
): DailyStat[] =>
  table.lines.flatMap((line) => {
    const date = readDateOfLine(line);
    if (date == null) return [];
    if (!isDateInRange(date, range)) return [];
    return mappings.flatMap((mapping) => {
      const cellNumber = readNumber(readFirstColumn(line, mapping.columnNames));
      if (cellNumber == null) return [];
      return [
        {
          date,
          feed: 'google-play',
          metric: mapping.metric,
          value: cellNumber,
          currency: null,
        } satisfies DailyStat,
      ];
    });
  });

const sumStatsByIdentity = (stats: readonly DailyStat[]): DailyStat[] => {
  const totals = new Map<string, DailyStat>();
  for (const stat of stats) {
    const identity = `${stat.date}|${stat.metric}|${String(stat.currency)}`;
    const total = totals.get(identity);
    if (total == null) {
      totals.set(identity, stat);
      continue;
    }
    totals.set(identity, { ...total, value: total.value + stat.value });
  }
  return [...totals.values()];
};

/** Installs overview: device installs, uninstalls, upgrades and installs on active devices per day. */
export const readInstallStats = (table: PlayCsvTable, range: DateRange): DailyStat[] =>
  readMappedStats(table, range, [
    { columnNames: ['daily device installs'], metric: 'installs' },
    { columnNames: ['daily device uninstalls'], metric: 'uninstalls' },
    { columnNames: ['daily device upgrades'], metric: 'updates' },
    {
      columnNames: ['active device installs', 'installs on active devices'],
      metric: 'activeInstalls',
    },
  ]);

/** Ratings overview: the running average rating per day. */
export const readRatingStats = (table: PlayCsvTable, range: DateRange): DailyStat[] =>
  readMappedStats(table, range, [
    { columnNames: ['total average rating'], metric: 'ratingAverage' },
  ]);

/** Crashes overview: crash count per day. */
export const readCrashStats = (table: PlayCsvTable, range: DateRange): DailyStat[] =>
  readMappedStats(table, range, [{ columnNames: ['daily crashes'], metric: 'crashes' }]);

/** Store performance by country: listing visitors summed over countries per day. */
export const readStorePerformanceStats = (table: PlayCsvTable, range: DateRange): DailyStat[] =>
  sumStatsByIdentity(
    readMappedStats(table, range, [
      { columnNames: ['store listing visitors'], metric: 'productPageViews' },
    ]),
  );

/** The newest day that has a line, whatever the range, so a half-published month is covered only as far as it goes. */
export const findLatestCsvDate = (table: PlayCsvTable): string | null => {
  const dates = table.lines.flatMap((line) => {
    const date = readDateOfLine(line);
    if (date == null) return [];
    return [date];
  });
  return dates.reduce<string | null>(
    (latestDate, date) => pickLaterKnownDate(latestDate, date),
    null,
  );
};

/** `Nov 30, 2016` (Pacific Time, as the earnings report writes it) as `2016-11-30`. */
const readEarningsDate = (earningsDate: string): string | null => {
  const dateParts = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/.exec(earningsDate);
  if (dateParts == null) return null;
  const [, monthName, dayOfMonth, year] = dateParts;
  if (monthName == null || dayOfMonth == null || year == null) return null;
  const monthPosition = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ].indexOf(monthName.toLowerCase());
  const isMonthUnknown = monthPosition == -1;
  if (isMonthUnknown) return null;
  const month = String(monthPosition + 1).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth.padStart(2, '0')}`;
};

const isTaxTransaction = (transactionType: string | undefined): boolean => {
  if (transactionType == null) return false;
  return transactionType.toLowerCase().includes('tax');
};

/**
 * Net proceeds per day and merchant currency for one package: charges, Google fees, refunds, rebills
 * and adjustments added up as signed amounts. Tax lines are left out because the developer does not keep them.
 */
export const readEarningsStats = (
  table: PlayCsvTable,
  packageName: string,
  range: DateRange,
): DailyStat[] => {
  const proceeds = table.lines.flatMap((line) => {
    const isOtherPackage = line['package id'] != packageName;
    if (isOtherPackage) return [];
    if (isTaxTransaction(line['transaction type'])) return [];
    const transactionDate = line['transaction date'];
    if (transactionDate == null) return [];
    const date = readEarningsDate(transactionDate);
    if (date == null) return [];
    if (!isDateInRange(date, range)) return [];
    const merchantCurrency = line['merchant currency'];
    const isCurrencyMissing = merchantCurrency == null || merchantCurrency == '';
    if (isCurrencyMissing) return [];
    const amount = readNumber(line['amount (merchant currency)']);
    if (amount == null) return [];
    return [
      {
        date,
        feed: 'google-play',
        metric: 'proceeds',
        value: amount,
        currency: merchantCurrency,
      } satisfies DailyStat,
    ];
  });
  return sumStatsByIdentity(proceeds);
};

/** The `yyyyMM` months a range touches, the form Play puts in file names. */
export const listReportMonths = (range: DateRange): string[] => {
  const firstMonth = new Date(`${readMonthOfDate(range.from)}-01T00:00:00.000Z`);
  const lastMonth = new Date(`${readMonthOfDate(range.to)}-01T00:00:00.000Z`);
  const monthsInYear = 12;
  const monthCount =
    (lastMonth.getUTCFullYear() - firstMonth.getUTCFullYear()) * monthsInYear +
    lastMonth.getUTCMonth() -
    firstMonth.getUTCMonth() +
    1;
  return Array.from({ length: monthCount }, (_, monthOffset) => {
    const monthStart = new Date(
      Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + monthOffset, 1),
    );
    return monthStart.toISOString().slice(0, 7).replace('-', '');
  });
};

/** The last day of a `yyyyMM` month, as `YYYY-MM-DD`. */
export const findLastDayOfReportMonth = (reportMonth: string): string => {
  const year = Number(reportMonth.slice(0, 4));
  const month = Number(reportMonth.slice(4, 6));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${reportMonth.slice(0, 4)}-${reportMonth.slice(4, 6)}-${String(lastDay).padStart(2, '0')}`;
};
