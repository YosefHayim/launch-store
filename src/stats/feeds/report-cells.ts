// Reads one cell, a number, or a column sum from an App Store Connect report row.

import type { ReportLine } from './app-store-feed-types.ts';

const MONEY_ROUNDING_FACTOR = 100;

/** The cell under a column, or an empty string when the report has no such column. */
export function readCell(line: ReportLine, column: string): string {
  const cell = line[column];

  if (cell == null) return '';

  return cell.trim();
}

/** A numeric cell; Apple leaves some numbers blank, which count as 0. */
export function readNumberCell(line: ReportLine, column: string): number {
  const cell = readCell(line, column);

  const isCellBlank = cell == '';

  if (isCellBlank) return 0;

  const parsedNumber = Number(cell);

  const isNumberReadable = Number.isFinite(parsedNumber);

  if (!isNumberReadable) return 0;

  return parsedNumber;
}

export function sumColumn(lines: readonly ReportLine[], column: string): number {
  function addCellNumber(total: number, line: { readonly [x: string]: string }) {
    return total + readNumberCell(line, column);
  }

  return lines.reduce(addCellNumber, 0);
}

export function readTotal<Key>(totals: ReadonlyMap<Key, number>, key: Key): number {
  const total = totals.get(key);

  if (total == null) return 0;

  return total;
}

/** Money rounded to cents, so float noise from Units x Developer Proceeds never reaches the files. */
export function roundMoney(amount: number): number {
  return Math.round(amount * MONEY_ROUNDING_FACTOR) / MONEY_ROUNDING_FACTOR;
}
