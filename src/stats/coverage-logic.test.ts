import { describe, expect, test } from 'vitest';
import type { AppCoverage, FeedCoverage } from '../types/stats.ts';
import {
  createNotesMessage,
  findFeedCoverage,
  isFeedCoverageStale,
  markFeedCoverageFailed,
  markFeedCoverageSkipped,
  mergeFeedCoverage,
  subtractCoverage,
} from './coverage-logic.ts';

const SYNCED_AT = '2026-10-29T08:00:00.000Z';
const COVERED = { coveredFrom: '2026-10-01', coveredThrough: '2026-10-20' };

function createCoverage(overrides: Partial<FeedCoverage>): FeedCoverage {
  return {
    lastSyncedAt: SYNCED_AT,
    ...COVERED,
    lastError: null,
    lastNote: null,
    ...overrides,
  };
}

function describeSubtractCoverage() {
  function asksForTheWholeRangeWhenThereIsNoCoverage() {
    const requested = { from: '2026-10-01', to: '2026-10-10' };

    expect(subtractCoverage(requested, null)).toEqual(requested);
  }

  test(
    'asks for the whole range when there is no coverage',
    asksForTheWholeRangeWhenThereIsNoCoverage,
  );

  function asksForTheWholeRangeWhenCoverageHoldsNoDays() {
    const requested = { from: '2026-10-01', to: '2026-10-10' };

    expect(subtractCoverage(requested, { coveredFrom: null, coveredThrough: null })).toEqual(
      requested,
    );
  }

  test(
    'asks for the whole range when coverage holds no days',
    asksForTheWholeRangeWhenCoverageHoldsNoDays,
  );

  function asksForNothingWhenTheRangeIsCoveredAndOlderThanTheRefreshTail() {
    expect(subtractCoverage({ from: '2026-10-02', to: '2026-10-10' }, COVERED)).toBeNull();
  }

  test(
    'asks for nothing when the range is covered and older than the refresh tail',
    asksForNothingWhenTheRangeIsCoveredAndOlderThanTheRefreshTail,
  );

  function rePullsTheLastThreeCoveredDaysAndTheNewDays() {
    const missing = subtractCoverage({ from: '2026-10-05', to: '2026-10-25' }, COVERED);

    expect(missing).toEqual({ from: '2026-10-18', to: '2026-10-25' });
  }

  test(
    're-pulls the last three covered days and the new days',
    rePullsTheLastThreeCoveredDaysAndTheNewDays,
  );

  function pullsOnlyTheTailWhenTheRangeEndsInsideIt() {
    const missing = subtractCoverage({ from: '2026-10-05', to: '2026-10-19' }, COVERED);

    expect(missing).toEqual({ from: '2026-10-18', to: '2026-10-19' });
  }

  test(
    'pulls only the tail when the range ends inside it',
    pullsOnlyTheTailWhenTheRangeEndsInsideIt,
  );

  function startsAtTheRangeStartWhenItIsInsideTheTail() {
    const missing = subtractCoverage({ from: '2026-10-19', to: '2026-10-25' }, COVERED);

    expect(missing).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  }

  test(
    'starts at the range start when it is inside the tail',
    startsAtTheRangeStartWhenItIsInsideTheTail,
  );

  function startsAfterTheCoveredDaysWhenTheRangeStartsLater() {
    const missing = subtractCoverage({ from: '2026-10-23', to: '2026-10-25' }, COVERED);

    expect(missing).toEqual({ from: '2026-10-21', to: '2026-10-25' });
  }

  test(
    'starts after the covered days when the range starts later',
    startsAfterTheCoveredDaysWhenTheRangeStartsLater,
  );

  function asksForTheWholeRangeWhenItStartsBeforeCoverageAndReachesTheTail() {
    const requested = { from: '2026-09-20', to: '2026-10-25' };

    expect(subtractCoverage(requested, COVERED)).toEqual(requested);
  }

  test(
    'asks for the whole range when it starts before coverage and reaches the tail',
    asksForTheWholeRangeWhenItStartsBeforeCoverageAndReachesTheTail,
  );

  function asksForTheOlderDaysWhenTheRangeStartsBeforeCoverageAndEndsInsideIt() {
    const missing = subtractCoverage({ from: '2026-09-20', to: '2026-10-05' }, COVERED);

    expect(missing).toEqual({ from: '2026-09-20', to: '2026-10-05' });
  }

  test(
    'asks for the older days when the range starts before coverage and ends inside it',
    asksForTheOlderDaysWhenTheRangeStartsBeforeCoverageAndEndsInsideIt,
  );

  function stopsAtTheDayBeforeCoverageWhenTheRangeEndsBeforeCoverage() {
    const missing = subtractCoverage({ from: '2026-09-20', to: '2026-09-25' }, COVERED);

    expect(missing).toEqual({ from: '2026-09-20', to: '2026-09-30' });
  }

  test(
    'stops at the day before coverage when the range ends before coverage',
    stopsAtTheDayBeforeCoverageWhenTheRangeEndsBeforeCoverage,
  );
}

describe('subtractCoverage', describeSubtractCoverage);

function describeMergeFeedCoverage() {
  function startsCoverageFromTheFirstPull() {
    const merged = mergeFeedCoverage(
      null,
      { from: '2026-10-01', to: '2026-10-10' },
      '2026-10-10',
      SYNCED_AT,
    );

    expect(merged).toEqual({
      lastSyncedAt: SYNCED_AT,
      coveredFrom: '2026-10-01',
      coveredThrough: '2026-10-10',
      lastError: null,
      lastNote: null,
    });
  }

  test('starts coverage from the first pull', startsCoverageFromTheFirstPull);

  function recordsNoCoveredDaysWhenTheFirstPullReachedNothing() {
    const merged = mergeFeedCoverage(
      null,
      { from: '2026-10-05', to: '2026-10-10' },
      '2026-10-04',
      SYNCED_AT,
    );

    expect(merged).toMatchObject({ coveredFrom: null, coveredThrough: null });
  }

  test(
    'records no covered days when the first pull reached nothing',
    recordsNoCoveredDaysWhenTheFirstPullReachedNothing,
  );

  function widensBothEndsAndClearsTheError() {
    const previous = createCoverage({ lastError: 'boom' });

    const merged = mergeFeedCoverage(
      previous,
      { from: '2026-09-25', to: '2026-10-25' },
      '2026-10-25',
      SYNCED_AT,
    );

    expect(merged).toEqual({
      lastSyncedAt: SYNCED_AT,
      coveredFrom: '2026-09-25',
      coveredThrough: '2026-10-25',
      lastError: null,
      lastNote: null,
    });
  }

  test('widens both ends and clears the error', widensBothEndsAndClearsTheError);

  function keepsTheWiderOldCoverageWhenTheNewPullIsSmaller() {
    const coverage = createCoverage({});
    const merged = mergeFeedCoverage(
      coverage,
      { from: '2026-10-05', to: '2026-10-10' },
      '2026-10-10',
      SYNCED_AT,
    );

    expect(merged).toMatchObject(COVERED);
  }

  test(
    'keeps the wider old coverage when the new pull is smaller',
    keepsTheWiderOldCoverageWhenTheNewPullIsSmaller,
  );

  function keepsTheOldDaysWhenTheNewPullReachedNothing() {
    const coverage = createCoverage({ lastError: 'boom' });
    const merged = mergeFeedCoverage(
      coverage,
      { from: '2026-10-25', to: '2026-10-26' },
      '2026-10-24',
      SYNCED_AT,
    );

    expect(merged).toEqual({
      lastSyncedAt: SYNCED_AT,
      ...COVERED,
      lastError: null,
      lastNote: null,
    });
  }

  test(
    'keeps the old days when the new pull reached nothing',
    keepsTheOldDaysWhenTheNewPullReachedNothing,
  );
}

describe('mergeFeedCoverage', describeMergeFeedCoverage);

function describeMarkFeedCoverageFailed() {
  function createsAnEmptyCoverageWithTheErrorWhenNothingWasSyncedBefore() {
    const failed = markFeedCoverageFailed(null, 'boom');

    expect(failed).toMatchObject({ coveredFrom: null, coveredThrough: null, lastError: 'boom' });
  }

  test(
    'creates an empty coverage with the error when nothing was synced before',
    createsAnEmptyCoverageWithTheErrorWhenNothingWasSyncedBefore,
  );

  function keepsTheCoveredDaysAndTheSyncTime() {
    const coverage = createCoverage({});
    const failed = markFeedCoverageFailed(coverage, 'boom');

    expect(failed).toEqual(createCoverage({ lastError: 'boom' }));
  }

  test('keeps the covered days and the sync time', keepsTheCoveredDaysAndTheSyncTime);
}

describe('markFeedCoverageFailed', describeMarkFeedCoverageFailed);

function describeMarkFeedCoverageSkipped() {
  function createsAnEmptyCoverageWithTheSyncTimeWhenNothingWasSyncedBefore() {
    const skipped = markFeedCoverageSkipped(null, SYNCED_AT, 'not ready');

    expect(skipped).toEqual({
      lastSyncedAt: SYNCED_AT,
      coveredFrom: null,
      coveredThrough: null,
      lastError: null,
      lastNote: 'not ready',
    });
  }

  test(
    'creates an empty coverage with the sync time when nothing was synced before',
    createsAnEmptyCoverageWithTheSyncTimeWhenNothingWasSyncedBefore,
  );

  function keepsTheCoveredDaysAndMovesTheSyncTimeAndClearsTheError() {
    const previous = createCoverage({ lastSyncedAt: '2026-10-01T00:00:00.000Z', lastError: 'old' });

    const skipped = markFeedCoverageSkipped(previous, SYNCED_AT, 'not ready');

    const coverage = createCoverage({ lastNote: 'not ready' });

    expect(skipped).toEqual(coverage);
  }

  test(
    'keeps the covered days and moves the sync time and clears the error',
    keepsTheCoveredDaysAndMovesTheSyncTimeAndClearsTheError,
  );
}

describe('markFeedCoverageSkipped', describeMarkFeedCoverageSkipped);

function describeFindFeedCoverage() {
  const appCoverage: AppCoverage = {
    version: 1,
    appKey: 'ios-1',
    feeds: { 'app-store': createCoverage({}) },
  };

  function returnsTheSavedCoverageOfAFeed() {
    const feedCoverage = findFeedCoverage(appCoverage, 'app-store');
    const coverage = createCoverage({});
    expect(feedCoverage).toEqual(coverage);
  }

  test('returns the saved coverage of a feed', returnsTheSavedCoverageOfAFeed);

  function returnsNullForAFeedThatWasNeverSynced() {
    const feedCoverage = findFeedCoverage(appCoverage, 'ga4');
    expect(feedCoverage).toBeNull();
  }

  test('returns null for a feed that was never synced', returnsNullForAFeedThatWasNeverSynced);
}

describe('findFeedCoverage', describeFindFeedCoverage);

function describeIsFeedCoverageStale() {
  const now = Date.parse('2026-10-29T12:00:00.000Z');

  function isStaleWhenNeverSynced() {
    expect(isFeedCoverageStale(null, now)).toBe(true);
  }

  test('is stale when never synced', isStaleWhenNeverSynced);

  function isStaleWhenTheLastSyncFailed() {
    const coverage = createCoverage({ lastError: 'boom' });
    expect(isFeedCoverageStale(coverage, now)).toBe(true);
  }

  test('is stale when the last sync failed', isStaleWhenTheLastSyncFailed);

  function isStaleWhenOld() {
    const coverage = createCoverage({ lastSyncedAt: '2026-10-20T00:00:00.000Z' });
    expect(isFeedCoverageStale(coverage, now)).toBe(true);
  }

  test('is stale when old', isStaleWhenOld);

  function isFreshWhenRecentAndWithoutError() {
    const coverage = createCoverage({});
    expect(isFeedCoverageStale(coverage, now)).toBe(false);
  }

  test('is fresh when recent and without error', isFreshWhenRecentAndWithoutError);
}

describe('isFeedCoverageStale', describeIsFeedCoverageStale);

function describeCreateNotesMessage() {
  function isNullWhenThereAreNoNotes() {
    const notesMessage = createNotesMessage([]);
    expect(notesMessage).toBeNull();
  }

  test('is null when there are no notes', isNullWhenThereAreNoNotes);

  function joinsTheNotesWithASemicolon() {
    const notesMessage = createNotesMessage(['first', 'second']);
    expect(notesMessage).toBe('first; second');
  }

  test('joins the notes with a semicolon', joinsTheNotesWithASemicolon);
}

describe('createNotesMessage', describeCreateNotesMessage);
