import type { DateRange, FeedCoverage } from '../types/stats.js';
import { isSyncedAtStale, REFRESH_TAIL_DAYS, shiftDate } from './dateRange.js';

const NEVER_SYNCED_AT = '1970-01-01T00:00:00.000Z';

// ISO dates sort as text, so a plain string compare orders them.
const earlierDate = (first: string, second: string): string => {
  if (first < second) return first;
  return second;
};

const laterDate = (first: string, second: string): string => {
  if (first > second) return first;
  return second;
};

/**
 * The days still to pull: the requested range minus what is covered, plus a re-pull of the last
 * `REFRESH_TAIL_DAYS` covered days (stores revise recent days). Null when nothing is missing.
 */
export const subtractCoverage = (
  requested: DateRange,
  covered: Pick<FeedCoverage, 'coveredFrom' | 'coveredThrough'> | null,
): DateRange | null => {
  if (covered === null) return requested;
  const { coveredFrom, coveredThrough } = covered;
  if (coveredFrom === null || coveredThrough === null) return requested;
  const refreshFrom = shiftDate(coveredThrough, 1 - REFRESH_TAIL_DAYS);
  const isRangeReachingTail = requested.to >= refreshFrom;
  const isRangeStartingBeforeCoverage = requested.from < coveredFrom;
  if (isRangeStartingBeforeCoverage && isRangeReachingTail) return requested;
  if (isRangeStartingBeforeCoverage) {
    return { from: requested.from, to: laterDate(requested.to, shiftDate(coveredFrom, -1)) };
  }
  if (!isRangeReachingTail) return null;
  const tailStart = laterDate(requested.from, refreshFrom);
  return { from: earlierDate(tailStart, shiftDate(coveredThrough, 1)), to: requested.to };
};

/** The coverage after a successful pull of `range` that reached `coveredThrough`. */
export const mergeFeedCoverage = (
  previous: FeedCoverage | null,
  range: DateRange,
  coveredThrough: string,
  syncedAt: string,
): FeedCoverage => {
  const isNothingPulled = coveredThrough < range.from;
  const hasPreviousCoverage =
    previous !== null && previous.coveredFrom !== null && previous.coveredThrough !== null;
  if (!hasPreviousCoverage && isNothingPulled) {
    return { lastSyncedAt: syncedAt, coveredFrom: null, coveredThrough: null, lastError: null };
  }
  if (!hasPreviousCoverage) {
    return { lastSyncedAt: syncedAt, coveredFrom: range.from, coveredThrough, lastError: null };
  }
  if (isNothingPulled) return { ...previous, lastSyncedAt: syncedAt, lastError: null };
  return {
    lastSyncedAt: syncedAt,
    coveredFrom: earlierDate(range.from, previous.coveredFrom),
    coveredThrough: laterDate(coveredThrough, previous.coveredThrough),
    lastError: null,
  };
};

/** The coverage after a failed pull: the covered days and sync time stay, the error is recorded. */
export const markFeedCoverageFailed = (
  previous: FeedCoverage | null,
  message: string,
): FeedCoverage => {
  if (previous === null) {
    return {
      lastSyncedAt: NEVER_SYNCED_AT,
      coveredFrom: null,
      coveredThrough: null,
      lastError: message,
    };
  }
  return { ...previous, lastError: message };
};

/** True when a feed was never synced, failed last time, or was synced too long ago. */
export const isFeedCoverageStale = (
  coverage: FeedCoverage | null,
  nowMilliseconds: number,
): boolean => {
  if (coverage === null) return true;
  const hasLastSyncFailed = coverage.lastError !== null;
  if (hasLastSyncFailed) return true;
  return isSyncedAtStale(coverage.lastSyncedAt, nowMilliseconds);
};
