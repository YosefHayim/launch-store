import { describe, expect, test } from 'vitest';
import { readCell, readNumberCell, readTotal, roundMoney, sumColumn } from './reportCells.js';

describe('readCell', () => {
  test('returns the trimmed cell under the column', () => {
    const cell = readCell({ Units: '  4 ' }, 'Units');

    expect(cell).toBe('4');
  });

  test('returns an empty string when the report has no such column', () => {
    const cell = readCell({ Units: '4' }, 'SKU');

    expect(cell).toBe('');
  });
});

describe('readNumberCell', () => {
  test('reads a number', () => {
    expect(readNumberCell({ Units: '12.5' }, 'Units')).toBe(12.5);
  });

  test('counts a blank cell as 0', () => {
    expect(readNumberCell({ Units: ' ' }, 'Units')).toBe(0);
  });

  test('counts a cell that is not a number as 0', () => {
    expect(readNumberCell({ Units: 'n/a' }, 'Units')).toBe(0);
  });
});

describe('sumColumn', () => {
  test('adds the column over many lines', () => {
    const total = sumColumn([{ Counts: '2' }, { Counts: '3' }, { Counts: '' }], 'Counts');

    expect(total).toBe(5);
  });

  test('is 0 for no lines', () => {
    expect(sumColumn([], 'Counts')).toBe(0);
  });
});

describe('readTotal', () => {
  test('returns the known total', () => {
    expect(readTotal(new Map([['a', 7]]), 'a')).toBe(7);
  });

  test('returns 0 for an unknown key', () => {
    expect(readTotal(new Map<string, number>(), 'a')).toBe(0);
  });
});

describe('roundMoney', () => {
  test('removes float noise down to cents', () => {
    expect(roundMoney(0.7 * 3)).toBe(2.1);
  });
});
