import type { AppCoverage, DateRange, FeedCoverage, StatsFeed } from '../types/stats.js';
import {
  isSyncedAtStale,
  pickEarlierDate,
  pickLaterDate,
  REFRESH_TAIL_DAYS,
  shiftDate,
} from './dateRange.js';

const NEVER_SYNCED_AT = '1970-01-01T00:00:00.000Z';

export const findFeedCoverage = (
  appCoverage: AppCoverage,
  feed: StatsFeed,
): FeedCoverage | null => {
  const savedFeedCoverage = appCoverage.feeds[feed];
  const isFeedCoverageMissing = savedFeedCoverage === undefined;
  if (isFeedCoverageMissing) return null;
  return savedFeedCoverage;
};

// Stores revise their newest days, so the last REFRESH_TAIL_DAYS covered days are pulled again.
export const subtractCoverage = (
  requested: DateRange,
  covered: Pick<FeedCoverage, 'coveredFrom' | 'coveredThrough'> | null,
): DateRange | null => {
  const isNothingCovered = covered === null;
  if (isNothingCovered) return requested;
  const { coveredFrom, coveredThrough } = covered;
  const isCoverageEmpty = coveredFrom === null || coveredThrough === null;
  if (isCoverageEmpty) return requested;
  const refreshFrom = shiftDate(coveredThrough, 1 - REFRESH_TAIL_DAYS);
  const isRangeReachingTail = requested.to >= refreshFrom;
  const isRangeStartingBeforeCoverage = requested.from < coveredFrom;
  const isWholeRangeNeeded = isRangeStartingBeforeCoverage && isRangeReachingTail;
  if (isWholeRangeNeeded) return requested;
  if (isRangeStartingBeforeCoverage) {
    return { from: requested.from, to: pickLaterDate(requested.to, shiftDate(coveredFrom, -1)) };
  }
  const isRangeInsideCoverage = !isRangeReachingTail;
  if (isRangeInsideCoverage) return null;
  const tailStart = pickLaterDate(requested.from, refreshFrom);
  return { from: pickEarlierDate(tailStart, shiftDate(coveredThrough, 1)), to: requested.to };
};

export const mergeFeedCoverage = (
  previous: FeedCoverage | null,
  range: DateRange,
  coveredThrough: string,
  syncedAt: string,
): FeedCoverage => {
  const isNothingPulled = coveredThrough < range.from;
  const isPreviousCoverageMissing =
    previous === null || previous.coveredFrom === null || previous.coveredThrough === null;
  if (isPreviousCoverageMissing && isNothingPulled) {
    return {
      lastSyncedAt: syncedAt,
      coveredFrom: null,
      coveredThrough: null,
      lastError: null,
      lastNote: null,
    };
  }
  if (isPreviousCoverageMissing) {
    return {
      lastSyncedAt: syncedAt,
      coveredFrom: range.from,
      coveredThrough,
      lastError: null,
      lastNote: null,
    };
  }
  if (isNothingPulled)
    return { ...previous, lastSyncedAt: syncedAt, lastError: null, lastNote: null };
  return {
    lastSyncedAt: syncedAt,
    coveredFrom: pickEarlierDate(range.from, previous.coveredFrom),
    coveredThrough: pickLaterDate(coveredThrough, previous.coveredThrough),
    lastError: null,
    lastNote: null,
  };
};

// A skipped feed counts as checked, or every read would try it again.
export const markFeedCoverageSkipped = (
  previous: FeedCoverage | null,
  syncedAt: string,
  reason: string,
): FeedCoverage => {
  const isNeverSynced = previous === null;
  if (isNeverSynced) {
    return {
      lastSyncedAt: syncedAt,
      coveredFrom: null,
      coveredThrough: null,
      lastError: null,
      lastNote: reason,
    };
  }
  return { ...previous, lastSyncedAt: syncedAt, lastError: null, lastNote: reason };
};

export const markFeedCoverageFailed = (
  previous: FeedCoverage | null,
  message: string,
): FeedCoverage => {
  const isNeverSynced = previous === null;
  if (isNeverSynced) {
    return {
      lastSyncedAt: NEVER_SYNCED_AT,
      coveredFrom: null,
      coveredThrough: null,
      lastError: message,
      lastNote: null,
    };
  }
  return { ...previous, lastError: message, lastNote: null };
};

export const createNotesMessage = (notes: readonly string[]): string | null => {
  const hasNoNotes = notes.length === 0;
  if (hasNoNotes) return null;
  return notes.join('; ');
};

export const isFeedCoverageStale = (
  coverage: FeedCoverage | null,
  nowMilliseconds: number,
): boolean => {
  const isNeverSynced = coverage === null;
  if (isNeverSynced) return true;
  const hasLastSyncFailed = coverage.lastError !== null;
  if (hasLastSyncFailed) return true;
  return isSyncedAtStale(coverage.lastSyncedAt, nowMilliseconds);
};
