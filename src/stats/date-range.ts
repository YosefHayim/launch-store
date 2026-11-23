import type { DateRange } from '../types/stats.ts';

export const REFRESH_TAIL_DAYS = 3;
export const MAX_SYNC_DAYS = 365;
export const DEFAULT_SYNC_DAYS = 30;

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const hourMilliseconds = 60 * 60 * 1000;

export function shiftDate(date: string, dayCount: number): string {
  const shiftedMilliseconds = Date.parse(`${date}T00:00:00.000Z`) + dayCount * DAY_MILLISECONDS;
  return new Date(shiftedMilliseconds).toISOString().slice(0, 10);
}

// ISO dates sort as text, so a plain string compare orders them.
export function pickEarlierDate(firstDate: string, secondDate: string): string {
  const isFirstEarlier = firstDate < secondDate;
  if (isFirstEarlier) return firstDate;
  return secondDate;
}

export function pickLaterDate(firstDate: string, secondDate: string): string {
  const isFirstLater = firstDate > secondDate;
  if (isFirstLater) return firstDate;
  return secondDate;
}

export function readMonthOfDate(date: string): string {
  return date.slice(0, 7);
}

export function createLastDaysRange(lastDate: string, dayCount: number): DateRange {
  return {
    from: shiftDate(lastDate, 1 - dayCount),
    to: lastDate,
  };
}

export function readYesterdayUtc(nowMilliseconds: number = Date.now()): string {
  return new Date(nowMilliseconds - DAY_MILLISECONDS).toISOString().slice(0, 10);
}

export function isSyncedAtStale(lastSyncedAt: string, nowMilliseconds: number): boolean {
  const lastSyncedMilliseconds = Date.parse(lastSyncedAt);
  const isTimeUnreadable = Number.isNaN(lastSyncedMilliseconds);
  if (isTimeUnreadable) return true;
  const statsStaleAfterHours = 12;
  return nowMilliseconds - lastSyncedMilliseconds > statsStaleAfterHours * hourMilliseconds;
}
