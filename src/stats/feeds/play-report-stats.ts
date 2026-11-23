import type { DailyStat, DateRange, StatsMetric } from '@/types/stats.js';
import { pickLaterDate, readMonthOfDate } from '../date-range.ts';
import type { PlayCsvTable } from './play-csv-table.ts';

interface PlayColumnMapping {
  readonly columnNames: readonly string[];
  readonly metric: StatsMetric;
}

export function pickLaterKnownDate(firstDate: string | null, secondDate: string): string {
  if (firstDate == null) return secondDate;

  return pickLaterDate(firstDate, secondDate);
}

function isDateInRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

function readNumber(cell: string | undefined): number | null {
  if (cell == null) return null;

  const withoutThousandsSeparators = cell.replaceAll(',', '');

  const isCellBlank = withoutThousandsSeparators == '';

  if (isCellBlank) return null;

  const cellNumber = Number(withoutThousandsSeparators);

  const isCellNumeric = Number.isFinite(cellNumber);

  if (!isCellNumeric) return null;

  return cellNumber;
}

function readFirstColumn(
  line: Readonly<Record<string, string>>,
  columnNames: readonly string[],
): string | undefined {
  function findColumnName(columnName: string) {
    return line[columnName] != null;
  }

  const presentColumnName = columnNames.find(findColumnName);

  if (presentColumnName == null) return undefined;

  return line[presentColumnName];
}

function readDateOfLine(line: Readonly<Record<string, string>>): string | null {
  const date = line['date'];

  if (date == null) return null;

  const isDateIso = /^\d{4}-\d{2}-\d{2}$/.test(date);

  if (!isDateIso) return null;

  return date;
}

function readMappedStats(
  table: PlayCsvTable,
  range: DateRange,
  mappings: readonly PlayColumnMapping[],
): DailyStat[] {
  function flatMapLine3(line: { readonly [x: string]: string }) {
    const date = readDateOfLine(line);

    if (date == null) return [];

    if (!isDateInRange(date, range)) return [];

    const statDate = date;

    function flatMapMapping(mapping: PlayColumnMapping) {
      const firstColumn = readFirstColumn(line, mapping.columnNames);
      const cellNumber = readNumber(firstColumn);

      if (cellNumber == null) return [];

      return [
        {
          date: statDate,
          feed: 'google-play',
          metric: mapping.metric,
          value: cellNumber,
          currency: null,
        } satisfies DailyStat,
      ];
    }

    return mappings.flatMap(flatMapMapping);
  }

  return table.lines.flatMap(flatMapLine3);
}

function sumStatsByIdentity(stats: readonly DailyStat[]): DailyStat[] {
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
}

/** Installs overview: device installs, uninstalls, upgrades and installs on active devices per day. */
export function readInstallStats(table: PlayCsvTable, range: DateRange): DailyStat[] {
  return readMappedStats(table, range, [
    { columnNames: ['daily device installs'], metric: 'installs' },
    { columnNames: ['daily device uninstalls'], metric: 'uninstalls' },
    { columnNames: ['daily device upgrades'], metric: 'updates' },
    {
      columnNames: ['active device installs', 'installs on active devices'],
      metric: 'activeInstalls',
    },
  ]);
}

/** Ratings overview: the running average rating per day. */
export function readRatingStats(table: PlayCsvTable, range: DateRange): DailyStat[] {
  return readMappedStats(table, range, [
    { columnNames: ['total average rating'], metric: 'ratingAverage' },
  ]);
}

/** Crashes overview: crash count per day. */
export function readCrashStats(table: PlayCsvTable, range: DateRange): DailyStat[] {
  return readMappedStats(table, range, [{ columnNames: ['daily crashes'], metric: 'crashes' }]);
}

/** Store performance by country: listing visitors summed over countries per day. */
export function readStorePerformanceStats(table: PlayCsvTable, range: DateRange): DailyStat[] {
  const mappedStats = readMappedStats(table, range, [
    { columnNames: ['store listing visitors'], metric: 'productPageViews' },
  ]);
  return sumStatsByIdentity(mappedStats);
}

/** The newest day that has a line, whatever the range, so a half-published month is covered only as far as it goes. */
export function findLatestCsvDate(table: PlayCsvTable): string | null {
  function flatMapLine(line: { readonly [x: string]: string }) {
    const date = readDateOfLine(line);

    if (date == null) return [];

    return [date];
  }

  const dates = table.lines.flatMap(flatMapLine);

  function reduceLatestDate(latestDate: string | null, date: string) {
    return pickLaterKnownDate(latestDate, date);
  }

  return dates.reduce<string | null>(reduceLatestDate, null);
}

/** `Nov 30, 2016` (Pacific Time, as the earnings report writes it) as `2016-11-30`. */
function readEarningsDate(earningsDate: string): string | null {
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
}

function isTaxTransaction(transactionType: string | undefined): boolean {
  if (transactionType == null) return false;

  return transactionType.toLowerCase().includes('tax');
}

/** Net proceeds per day and merchant currency for one package */
export function readEarningsStats(
  table: PlayCsvTable,
  packageName: string,
  range: DateRange,
): DailyStat[] {
  function flatMapLine2(line: { readonly [x: string]: string }) {
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
  }

  const proceeds = table.lines.flatMap(flatMapLine2);

  return sumStatsByIdentity(proceeds);
}

/** The `yyyyMM` months a range touches, the form Play puts in file names. */
export function listReportMonths(range: DateRange): string[] {
  const monthOfDate = readMonthOfDate(range.from);
  const firstMonth = new Date(`${monthOfDate}-01T00:00:00.000Z`);
  const lastMonth = new Date(`${readMonthOfDate(range.to)}-01T00:00:00.000Z`);
  const monthsInYear = 12;
  const monthCount =
    (lastMonth.getUTCFullYear() - firstMonth.getUTCFullYear()) * monthsInYear +
    lastMonth.getUTCMonth() -
    firstMonth.getUTCMonth() +
    1;

  function fromPiece(_: unknown, monthOffset: number) {
    const monthStart = new Date(
      Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + monthOffset, 1),
    );
    return monthStart.toISOString().slice(0, 7).replace('-', '');
  }

  return Array.from({ length: monthCount }, fromPiece);
}

/** The last day of a `yyyyMM` month, as `YYYY-MM-DD`. */
export function findLastDayOfReportMonth(reportMonth: string): string {
  const year = Number(reportMonth.slice(0, 4));
  const month = Number(reportMonth.slice(4, 6));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${reportMonth.slice(0, 4)}-${reportMonth.slice(4, 6)}-${String(lastDay).padStart(2, '0')}`;
}
