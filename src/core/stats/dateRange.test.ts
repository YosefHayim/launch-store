import { Effect, TestClock, TestContext } from 'effect';
import { describe, expect, test } from 'vitest';
import {
  createLastDaysRange,
  isSyncedAtStale,
  pickEarlierDate,
  pickLaterDate,
  readMonthOfDate,
  readYesterdayUtc,
  shiftDate,
} from './dateRange.js';

describe('shiftDate', () => {
  test('moves forward across a month end', () => {
    expect(shiftDate('2026-01-30', 3)).toBe('2026-02-02');
  });

  test('moves backward across a year start', () => {
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
  });

  test('handles a leap day', () => {
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('readMonthOfDate', () => {
  test('keeps the year and month', () => {
    expect(readMonthOfDate('2026-10-29')).toBe('2026-10');
  });
});

describe('createLastDaysRange', () => {
  test('one day is the last date only', () => {
    expect(createLastDaysRange('2026-10-28', 1)).toEqual({ from: '2026-10-28', to: '2026-10-28' });
  });

  test('many days end at the last date', () => {
    expect(createLastDaysRange('2026-10-28', 30)).toEqual({ from: '2026-09-29', to: '2026-10-28' });
  });
});

describe('readYesterdayUtc', () => {
  test('is the day before the clock date in UTC', async () => {
    const program = Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse('2026-10-29T00:30:00.000Z'));
      return yield* readYesterdayUtc();
    });

    const yesterday = await Effect.runPromise(
      program.pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(yesterday).toBe('2026-10-28');
  });
});

describe('isSyncedAtStale', () => {
  const now = Date.parse('2026-10-29T12:00:00.000Z');

  test('is fresh within 12 hours', () => {
    expect(isSyncedAtStale('2026-10-29T00:30:00.000Z', now)).toBe(false);
  });

  test('is stale after 12 hours', () => {
    expect(isSyncedAtStale('2026-10-28T23:00:00.000Z', now)).toBe(true);
  });

  test('is stale when the time cannot be read', () => {
    expect(isSyncedAtStale('not a time', now)).toBe(true);
  });
});

describe('pickEarlierDate', () => {
  test('returns the earlier of two dates in either order', () => {
    expect(pickEarlierDate('2026-10-01', '2026-10-05')).toBe('2026-10-01');
    expect(pickEarlierDate('2026-10-05', '2026-10-01')).toBe('2026-10-01');
  });
});

describe('pickLaterDate', () => {
  test('returns the later of two dates in either order', () => {
    expect(pickLaterDate('2026-10-01', '2026-10-05')).toBe('2026-10-05');
    expect(pickLaterDate('2026-10-05', '2026-10-01')).toBe('2026-10-05');
  });
});
