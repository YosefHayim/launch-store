import type { DailyStat, DateRange, StatsMetric } from '../../types/stats.js';
import { readMonthOfDate } from '../dateRange.js';
import type { PlayCsvTable } from './playCsvTable.js';

interface PlayColumnMapping {
  readonly columnNames: readonly string[];
  readonly metric: StatsMetric;
}

const INSTALL_COLUMNS: readonly PlayColumnMapping[] = [
  { columnNames: ['daily device installs'], metric: 'installs' },
  { columnNames: ['daily device uninstalls'], metric: 'uninstalls' },
  { columnNames: ['daily device upgrades'], metric: 'updates' },
  {
    columnNames: ['active device installs', 'installs on active devices'],
    metric: 'activeInstalls',
  },
];
const RATING_COLUMNS: readonly PlayColumnMapping[] = [
  { columnNames: ['total average rating'], metric: 'ratingAverage' },
];
const CRASH_COLUMNS: readonly PlayColumnMapping[] = [
  { columnNames: ['daily crashes'], metric: 'crashes' },
];
const STORE_PERFORMANCE_COLUMNS: readonly PlayColumnMapping[] = [
  { columnNames: ['store listing visitors'], metric: 'productPageViews' },
];

const DATE_COLUMN = 'date';
const EARNINGS_DATE_COLUMN = 'transaction date';
const EARNINGS_TYPE_COLUMN = 'transaction type';
const EARNINGS_PACKAGE_COLUMN = 'package id';
const EARNINGS_CURRENCY_COLUMN = 'merchant currency';
const EARNINGS_AMOUNT_COLUMN = 'amount (merchant currency)';
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EARNINGS_DATE_PATTERN = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/;
const MONTH_NAMES: readonly string[] = [
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
];

const MONTHS_IN_YEAR = 12;

// ISO dates sort as text, so a plain string compare orders them.
export const pickLaterDate = (first: string | null, second: string): string => {
  if (first === null) return second;
  if (first > second) return first;
  return second;
};

const isDateInRange = (date: string, range: DateRange): boolean =>
  date >= range.from && date <= range.to;

const readNumber = (cell: string | undefined): number | null => {
  if (cell === undefined) return null;
  const withoutThousandsSeparators = cell.replaceAll(',', '');
  const isCellBlank = withoutThousandsSeparators === '';
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
  const presentColumnName = columnNames.find((columnName) => line[columnName] !== undefined);
  if (presentColumnName === undefined) return undefined;
  return line[presentColumnName];
};

const readDateOfLine = (line: Readonly<Record<string, string>>): string | null => {
  const date = line[DATE_COLUMN];
  if (date === undefined) return null;
  const isDateIso = ISO_DATE_PATTERN.test(date);
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
    if (date === null) return [];
    if (!isDateInRange(date, range)) return [];
    return mappings.flatMap((mapping) => {
      const cellNumber = readNumber(readFirstColumn(line, mapping.columnNames));
      if (cellNumber === null) return [];
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
    if (total === undefined) {
      totals.set(identity, stat);
      continue;
    }
    totals.set(identity, { ...total, value: total.value + stat.value });
  }
  return [...totals.values()];
};

/** Installs overview: device installs, uninstalls, upgrades and installs on active devices per day. */
export const readInstallStats = (table: PlayCsvTable, range: DateRange): DailyStat[] =>
  readMappedStats(table, range, INSTALL_COLUMNS);

/** Ratings overview: the running average rating per day. */
export const readRatingStats = (table: PlayCsvTable, range: DateRange): DailyStat[] =>
  readMappedStats(table, range, RATING_COLUMNS);

/** Crashes overview: crash count per day. */
export const readCrashStats = (table: PlayCsvTable, range: DateRange): DailyStat[] =>
  readMappedStats(table, range, CRASH_COLUMNS);

/** Store performance by country: listing visitors summed over countries per day. */
export const readStorePerformanceStats = (table: PlayCsvTable, range: DateRange): DailyStat[] =>
  sumStatsByIdentity(readMappedStats(table, range, STORE_PERFORMANCE_COLUMNS));

/** The newest day that has a line, whatever the range, so a half-published month is covered only as far as it goes. */
export const findLatestCsvDate = (table: PlayCsvTable): string | null => {
  const dates = table.lines.flatMap((line) => {
    const date = readDateOfLine(line);
    if (date === null) return [];
    return [date];
  });
  return dates.reduce<string | null>((latestDate, date) => pickLaterDate(latestDate, date), null);
};

/** `Nov 30, 2016` (Pacific Time, as the earnings report writes it) as `2016-11-30`. */
const readEarningsDate = (earningsDate: string): string | null => {
  const dateParts = EARNINGS_DATE_PATTERN.exec(earningsDate);
  if (dateParts === null) return null;
  const [, monthName, dayOfMonth, year] = dateParts;
  if (monthName === undefined || dayOfMonth === undefined || year === undefined) return null;
  const monthPosition = MONTH_NAMES.indexOf(monthName.toLowerCase());
  const isMonthUnknown = monthPosition === -1;
  if (isMonthUnknown) return null;
  const month = String(monthPosition + 1).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth.padStart(2, '0')}`;
};

const isTaxTransaction = (transactionType: string | undefined): boolean => {
  if (transactionType === undefined) return false;
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
    const isOtherPackage = line[EARNINGS_PACKAGE_COLUMN] !== packageName;
    if (isOtherPackage) return [];
    if (isTaxTransaction(line[EARNINGS_TYPE_COLUMN])) return [];
    const transactionDate = line[EARNINGS_DATE_COLUMN];
    if (transactionDate === undefined) return [];
    const date = readEarningsDate(transactionDate);
    if (date === null) return [];
    if (!isDateInRange(date, range)) return [];
    const merchantCurrency = line[EARNINGS_CURRENCY_COLUMN];
    const isCurrencyMissing = merchantCurrency === undefined || merchantCurrency === '';
    if (isCurrencyMissing) return [];
    const amount = readNumber(line[EARNINGS_AMOUNT_COLUMN]);
    if (amount === null) return [];
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
  const monthCount =
    (lastMonth.getUTCFullYear() - firstMonth.getUTCFullYear()) * MONTHS_IN_YEAR +
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
