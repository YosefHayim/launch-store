import { describe, expect, test } from 'vitest';
import {
  createLastDaysRange,
  isSyncedAtStale,
  pickEarlierDate,
  pickLaterDate,
  readMonthOfDate,
  readYesterdayUtc,
  shiftDate,
} from './date-range.ts';

function describeShiftDate() {
  function movesForwardAcrossAMonthEnd() {
    expect(shiftDate('2026-01-30', 3)).toBe('2026-02-02');
  }

  test('moves forward across a month end', movesForwardAcrossAMonthEnd);

  function movesBackwardAcrossAYearStart() {
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
  }

  test('moves backward across a year start', movesBackwardAcrossAYearStart);

  function handlesALeapDay() {
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29');
  }

  test('handles a leap day', handlesALeapDay);
}

describe('shiftDate', describeShiftDate);

function describeReadMonthOfDate() {
  function keepsTheYearAndMonth() {
    const monthOfDate = readMonthOfDate('2026-10-29');
    expect(monthOfDate).toBe('2026-10');
  }

  test('keeps the year and month', keepsTheYearAndMonth);
}

describe('readMonthOfDate', describeReadMonthOfDate);

function describeCreateLastDaysRange() {
  function oneDayIsTheLastDateOnly() {
    const lastDaysRange = createLastDaysRange('2026-10-28', 1);
    expect(lastDaysRange).toEqual({ from: '2026-10-28', to: '2026-10-28' });
  }

  test('one day is the last date only', oneDayIsTheLastDateOnly);

  function manyDaysEndAtTheLastDate() {
    const lastDaysRange = createLastDaysRange('2026-10-28', 30);
    expect(lastDaysRange).toEqual({ from: '2026-09-29', to: '2026-10-28' });
  }

  test('many days end at the last date', manyDaysEndAtTheLastDate);
}

describe('createLastDaysRange', describeCreateLastDaysRange);

function describeReadYesterdayUtc() {
  function isTheDayBeforeTheClockDateInUTC() {
    const yesterday = readYesterdayUtc(Date.parse('2026-10-29T00:30:00.000Z'));

    expect(yesterday).toBe('2026-10-28');
  }

  test('is the day before the clock date in UTC', isTheDayBeforeTheClockDateInUTC);
}

describe('readYesterdayUtc', describeReadYesterdayUtc);

function describeIsSyncedAtStale() {
  const now = Date.parse('2026-10-29T12:00:00.000Z');

  function isFreshWithin12Hours() {
    expect(isSyncedAtStale('2026-10-29T00:30:00.000Z', now)).toBe(false);
  }

  test('is fresh within 12 hours', isFreshWithin12Hours);

  function isStaleAfter12Hours() {
    expect(isSyncedAtStale('2026-10-28T23:00:00.000Z', now)).toBe(true);
  }

  test('is stale after 12 hours', isStaleAfter12Hours);

  function isStaleWhenTheTimeCannotBeRead() {
    expect(isSyncedAtStale('not a time', now)).toBe(true);
  }

  test('is stale when the time cannot be read', isStaleWhenTheTimeCannotBeRead);
}

describe('isSyncedAtStale', describeIsSyncedAtStale);

function describePickEarlierDate() {
  function returnsTheEarlierOfTwoDatesInEitherOrder() {
    const earlierDate = pickEarlierDate('2026-10-01', '2026-10-05');
    expect(earlierDate).toBe('2026-10-01');
    expect(pickEarlierDate('2026-10-05', '2026-10-01')).toBe('2026-10-01');
  }

  test(
    'returns the earlier of two dates in either order',
    returnsTheEarlierOfTwoDatesInEitherOrder,
  );
}

describe('pickEarlierDate', describePickEarlierDate);

function describePickLaterDate() {
  function returnsTheLaterOfTwoDatesInEitherOrder() {
    const laterDate = pickLaterDate('2026-10-01', '2026-10-05');
    expect(laterDate).toBe('2026-10-05');
    expect(pickLaterDate('2026-10-05', '2026-10-01')).toBe('2026-10-05');
  }

  test('returns the later of two dates in either order', returnsTheLaterOfTwoDatesInEitherOrder);
}

describe('pickLaterDate', describePickLaterDate);
