import { describe, expect, test } from 'vitest';
import type { FeedCoverage } from '../types/stats.js';
import {
  isFeedCoverageStale,
  markFeedCoverageFailed,
  mergeFeedCoverage,
  subtractCoverage,
} from './coverageLogic.js';

const SYNCED_AT = '2026-10-29T08:00:00.000Z';
const COVERED = { coveredFrom: '2026-10-01', coveredThrough: '2026-10-20' };

const createCoverage = (overrides: Partial<FeedCoverage>): FeedCoverage => ({
  lastSyncedAt: SYNCED_AT,
  ...COVERED,
  lastError: null,
  ...overrides,
});

describe('subtractCoverage', () => {
  test('asks for the whole range when there is no coverage', () => {
    const requested = { from: '2026-10-01', to: '2026-10-10' };

    expect(subtractCoverage(requested, null)).toEqual(requested);
  });

  test('asks for the whole range when coverage holds no days', () => {
    const requested = { from: '2026-10-01', to: '2026-10-10' };

    expect(subtractCoverage(requested, { coveredFrom: null, coveredThrough: null })).toEqual(
      requested,
    );
  });

  test('asks for nothing when the range is covered and older than the refresh tail', () => {
    expect(subtractCoverage({ from: '2026-10-02', to: '2026-10-10' }, COVERED)).toBeNull();
  });

  test('re-pulls the last three covered days and the new days', () => {
    const missing = subtractCoverage({ from: '2026-10-05', to: '2026-10-25' }, COVERED);

    expect(missing).toEqual({ from: '2026-10-18', to: '2026-10-25' });
  });

  test('pulls only the tail when the range ends inside it', () => {
    const missing = subtractCoverage({ from: '2026-10-05', to: '2026-10-19' }, COVERED);

    expect(missing).toEqual({ from: '2026-10-18', to: '2026-10-19' });
  });

  test('starts at the range start when it is inside the tail', () => {
    const missing = subtractCoverage({ from: '2026-10-19', to: '2026-10-25' }, COVERED);

    expect(missing).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  });

  test('starts after the covered days when the range starts later', () => {
    const missing = subtractCoverage({ from: '2026-10-23', to: '2026-10-25' }, COVERED);

    expect(missing).toEqual({ from: '2026-10-21', to: '2026-10-25' });
  });

  test('asks for the whole range when it starts before coverage and reaches the tail', () => {
    const requested = { from: '2026-09-20', to: '2026-10-25' };

    expect(subtractCoverage(requested, COVERED)).toEqual(requested);
  });

  test('asks for the older days when the range starts before coverage and ends inside it', () => {
    const missing = subtractCoverage({ from: '2026-09-20', to: '2026-10-05' }, COVERED);

    expect(missing).toEqual({ from: '2026-09-20', to: '2026-10-05' });
  });

  test('stops at the day before coverage when the range ends before coverage', () => {
    const missing = subtractCoverage({ from: '2026-09-20', to: '2026-09-25' }, COVERED);

    expect(missing).toEqual({ from: '2026-09-20', to: '2026-09-30' });
  });
});

describe('mergeFeedCoverage', () => {
  test('starts coverage from the first pull', () => {
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
    });
  });

  test('records no covered days when the first pull reached nothing', () => {
    const merged = mergeFeedCoverage(
      null,
      { from: '2026-10-05', to: '2026-10-10' },
      '2026-10-04',
      SYNCED_AT,
    );

    expect(merged).toMatchObject({ coveredFrom: null, coveredThrough: null });
  });

  test('widens both ends and clears the error', () => {
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
    });
  });

  test('keeps the wider old coverage when the new pull is smaller', () => {
    const merged = mergeFeedCoverage(
      createCoverage({}),
      { from: '2026-10-05', to: '2026-10-10' },
      '2026-10-10',
      SYNCED_AT,
    );

    expect(merged).toMatchObject(COVERED);
  });

  test('keeps the old days when the new pull reached nothing', () => {
    const merged = mergeFeedCoverage(
      createCoverage({ lastError: 'boom' }),
      { from: '2026-10-25', to: '2026-10-26' },
      '2026-10-24',
      SYNCED_AT,
    );

    expect(merged).toEqual({ lastSyncedAt: SYNCED_AT, ...COVERED, lastError: null });
  });
});

describe('markFeedCoverageFailed', () => {
  test('creates an empty coverage with the error when nothing was synced before', () => {
    const failed = markFeedCoverageFailed(null, 'boom');

    expect(failed).toMatchObject({ coveredFrom: null, coveredThrough: null, lastError: 'boom' });
  });

  test('keeps the covered days and the sync time', () => {
    const failed = markFeedCoverageFailed(createCoverage({}), 'boom');

    expect(failed).toEqual(createCoverage({ lastError: 'boom' }));
  });
});

describe('isFeedCoverageStale', () => {
  const now = Date.parse('2026-10-29T12:00:00.000Z');

  test('is stale when never synced', () => {
    expect(isFeedCoverageStale(null, now)).toBe(true);
  });

  test('is stale when the last sync failed', () => {
    expect(isFeedCoverageStale(createCoverage({ lastError: 'boom' }), now)).toBe(true);
  });

  test('is stale when old', () => {
    expect(
      isFeedCoverageStale(createCoverage({ lastSyncedAt: '2026-10-20T00:00:00.000Z' }), now),
    ).toBe(true);
  });

  test('is fresh when recent and without error', () => {
    expect(isFeedCoverageStale(createCoverage({}), now)).toBe(false);
  });
});
