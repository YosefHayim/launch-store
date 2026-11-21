import type { ReportLine } from './appStoreFeedTypes.js';

const MONEY_ROUNDING_FACTOR = 100;

/** The cell under a column, or an empty string when the report has no such column. */
export const readCell = (line: ReportLine, column: string): string => {
  const cell = line[column];
  if (cell === undefined) return '';
  return cell.trim();
};

/** A numeric cell; Apple leaves some numbers blank, which count as 0. */
export const readNumberCell = (line: ReportLine, column: string): number => {
  const cell = readCell(line, column);
  const isCellBlank = cell === '';
  if (isCellBlank) return 0;
  const parsedNumber = Number(cell);
  const isNumberReadable = Number.isFinite(parsedNumber);
  if (!isNumberReadable) return 0;
  return parsedNumber;
};

export const sumColumn = (lines: readonly ReportLine[], column: string): number =>
  lines.reduce((total, line) => total + readNumberCell(line, column), 0);

export const readTotal = <Key>(totals: ReadonlyMap<Key, number>, key: Key): number => {
  const total = totals.get(key);
  if (total === undefined) return 0;
  return total;
};

/** Money rounded to cents, so float noise from Units x Developer Proceeds never reaches the files. */
export const roundMoney = (amount: number): number =>
  Math.round(amount * MONEY_ROUNDING_FACTOR) / MONEY_ROUNDING_FACTOR;
