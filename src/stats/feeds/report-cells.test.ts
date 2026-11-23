import { describe, expect, test } from 'vitest';
import { readCell, readNumberCell, readTotal, roundMoney, sumColumn } from './report-cells.ts';

function describeReadCell() {
  function returnsTheTrimmedCellUnderTheColumn() {
    const cell = readCell({ Units: '  4 ' }, 'Units');

    expect(cell).toBe('4');
  }

  test('returns the trimmed cell under the column', returnsTheTrimmedCellUnderTheColumn);

  function returnsAnEmptyStringWhenTheReportHasNoSuchColumn() {
    const cell = readCell({ Units: '4' }, 'SKU');

    expect(cell).toBe('');
  }

  test(
    'returns an empty string when the report has no such column',
    returnsAnEmptyStringWhenTheReportHasNoSuchColumn,
  );
}

describe('readCell', describeReadCell);

function describeReadNumberCell() {
  function readsANumber() {
    const numberCell = readNumberCell({ Units: '12.5' }, 'Units');
    expect(numberCell).toBe(12.5);
  }

  test('reads a number', readsANumber);

  function countsABlankCellAs0() {
    const numberCell = readNumberCell({ Units: ' ' }, 'Units');
    expect(numberCell).toBe(0);
  }

  test('counts a blank cell as 0', countsABlankCellAs0);

  function countsACellThatIsNotANumberAs0() {
    const numberCell = readNumberCell({ Units: 'n/a' }, 'Units');
    expect(numberCell).toBe(0);
  }

  test('counts a cell that is not a number as 0', countsACellThatIsNotANumberAs0);
}

describe('readNumberCell', describeReadNumberCell);

function describeSumColumn() {
  function addsTheColumnOverManyLines() {
    const total = sumColumn([{ Counts: '2' }, { Counts: '3' }, { Counts: '' }], 'Counts');

    expect(total).toBe(5);
  }

  test('adds the column over many lines', addsTheColumnOverManyLines);

  function is0ForNoLines() {
    expect(sumColumn([], 'Counts')).toBe(0);
  }

  test('is 0 for no lines', is0ForNoLines);
}

describe('sumColumn', describeSumColumn);

function describeReadTotal() {
  function returnsTheKnownTotal() {
    const total = readTotal(new Map([['a', 7]]), 'a');
    expect(total).toBe(7);
  }

  test('returns the known total', returnsTheKnownTotal);

  function returns0ForAnUnknownKey() {
    const total = readTotal(new Map<string, number>(), 'a');
    expect(total).toBe(0);
  }

  test('returns 0 for an unknown key', returns0ForAnUnknownKey);
}

describe('readTotal', describeReadTotal);

function describeRoundMoney() {
  function removesFloatNoiseDownToCents() {
    expect(roundMoney(0.7 * 3)).toBe(2.1);
  }

  test('removes float noise down to cents', removesFloatNoiseDownToCents);
}

describe('roundMoney', describeRoundMoney);
