import { Clock, Effect } from 'effect';
import type { DateRange } from '../types/stats.js';

export const REFRESH_TAIL_DAYS = 3;
const STATS_STALE_AFTER_HOURS = 12;
export const MAX_SYNC_DAYS = 365;
export const DEFAULT_SYNC_DAYS = 30;

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const HOUR_MILLISECONDS = 60 * 60 * 1000;

export const shiftDate = (date: string, dayCount: number): string => {
  const shiftedMilliseconds = Date.parse(`${date}T00:00:00.000Z`) + dayCount * DAY_MILLISECONDS;
  return new Date(shiftedMilliseconds).toISOString().slice(0, 10);
};

export const readMonthOfDate = (date: string): string => date.slice(0, 7);

export const createLastDaysRange = (lastDate: string, dayCount: number): DateRange => ({
  from: shiftDate(lastDate, 1 - dayCount),
  to: lastDate,
});

export const readYesterdayUtc = (): Effect.Effect<string> =>
  Effect.gen(function* () {
    const nowMilliseconds = yield* Clock.currentTimeMillis;
    return new Date(nowMilliseconds - DAY_MILLISECONDS).toISOString().slice(0, 10);
  });

export const isSyncedAtStale = (lastSyncedAt: string, nowMilliseconds: number): boolean => {
  const lastSyncedMilliseconds = Date.parse(lastSyncedAt);
  const isTimeUnreadable = Number.isNaN(lastSyncedMilliseconds);
  if (isTimeUnreadable) return true;
  return nowMilliseconds - lastSyncedMilliseconds > STATS_STALE_AFTER_HOURS * HOUR_MILLISECONDS;
};
