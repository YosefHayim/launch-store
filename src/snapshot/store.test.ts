import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Snapshot } from '../types/snapshot.ts';
import {
  deleteSnapshot,
  listSnapshots,
  loadSnapshot,
  planPrune,
  pruneSnapshots,
  saveSnapshot,
} from './store.ts';
import type { CaptureReport } from '../types/snapshot.ts';

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    version: 1,
    name: 'before-sync',
    capturedAt: '2026-06-16T00:00:00.000Z',
    reports: [
      {
        id: 'apple-products',
        title: 'App Store in-app purchases',
        store: 'appstore',
        outcome: {
          state: 'captured',
          apps: [{ app: 'alpha', identifier: 'com.acme.alpha', entities: [] }],
        },
      },
    ],
    ...over,
  };
}
function describeSnapshotStore() {
  let dir: string;

  function prepareSnapshotStore() {
    const systemTemporaryDirectory = tmpdir();
    const launchSnapshotsPath = join(systemTemporaryDirectory, 'launch-snapshots-');
    dir = mkdtempSync(launchSnapshotsPath);
  }

  beforeEach(prepareSnapshotStore);

  function cleanupSnapshotStore() {
    rmSync(dir, { recursive: true, force: true });
  }

  afterEach(cleanupSnapshotStore);

  async function roundTripsASnapshotThroughSaveLoadUnchanged() {
    const snapshot = snap();
    await saveSnapshot(snapshot, dir);
    expect(await loadSnapshot(snapshot.name, dir)).toEqual(snapshot);
  }

  it(
    'round-trips a snapshot through save -> load unchanged',
    roundTripsASnapshotThroughSaveLoadUnchanged,
  );

  async function preservesPerAppSkipReasonsWhenSavingAPartialCapture() {
    const snapshot = snap({
      reports: [
        {
          id: 'play-products',
          title: 'Products',
          store: 'play',
          outcome: {
            state: 'captured',
            apps: [],
            skippedApps: [
              { app: 'beta', identifier: 'com.beta', reason: 'no Play service account' },
            ],
          },
        },
      ],
    });

    await saveSnapshot(snapshot, dir);
    expect(await loadSnapshot(snapshot.name, dir)).toEqual(snapshot);
  }

  it(
    'preserves per-app skip reasons when saving a partial capture',
    preservesPerAppSkipReasonsWhenSavingAPartialCapture,
  );

  async function overwritesASnapshotReSavedUnderTheSameName() {
    await saveSnapshot(snap({ capturedAt: '2026-06-16T00:00:00.000Z' }), dir);
    await saveSnapshot(snap({ capturedAt: '2026-06-16T12:00:00.000Z' }), dir);

    const snapshot = await loadSnapshot('before-sync', dir);

    expect(snapshot?.capturedAt).toBe('2026-06-16T12:00:00.000Z');

    const snapshots = await listSnapshots(dir);

    expect(snapshots).toHaveLength(1);
  }

  it(
    'overwrites a snapshot re-saved under the same name',
    overwritesASnapshotReSavedUnderTheSameName,
  );

  async function returnsNullForAnUnknownName() {
    const snapshot = await loadSnapshot('nope', dir);
    expect(snapshot).toBeNull();
  }

  it('returns null for an unknown name', returnsNullForAnUnknownName);

  async function toleratesACorruptPieceReadsAsNullSkipsItInLists() {
    const brokenPath = join(dir, 'broken.json');

    writeFileSync(brokenPath, '{ not json');
    await saveSnapshot(snap(), dir);

    const snapshot = await loadSnapshot('broken', dir);

    expect(snapshot).toBeNull();

    const snapshots = await listSnapshots(dir);

    expect(snapshots).toHaveLength(1);
  }

  it(
    'tolerates a corrupt record (reads as null, skips it in lists)',
    toleratesACorruptPieceReadsAsNullSkipsItInLists,
  );

  async function listsSnapshotsNewestFirstByCapturedAt() {
    await saveSnapshot(snap({ name: 'old', capturedAt: '2026-06-10T00:00:00.000Z' }), dir);
    await saveSnapshot(snap({ name: 'new', capturedAt: '2026-06-15T00:00:00.000Z' }), dir);

    function readName(snapshot: {
      readonly version: number;
      readonly name: string;
      readonly capturedAt: string;
      readonly reports: readonly CaptureReport[];
    }) {
      return snapshot.name;
    }

    expect((await listSnapshots(dir)).map(readName)).toEqual(['new', 'old']);
  }

  it('lists snapshots newest-first by capturedAt', listsSnapshotsNewestFirstByCapturedAt);

  async function returnsAnEmptyListWhenNoSnapshotsDirectoryExists() {
    const missingPath = join(dir, 'missing');
    const snapshots = await listSnapshots(missingPath);
    expect(snapshots).toEqual([]);
  }

  it(
    'returns an empty list when no snapshots directory exists',
    returnsAnEmptyListWhenNoSnapshotsDirectoryExists,
  );

  async function prunesTheOldestPrefixedSnapshotsBeyondTheRetentionWindow() {
    await saveSnapshot(snap({ name: 'pre-sync-1', capturedAt: '2026-06-10T00:00:00.000Z' }), dir);
    await saveSnapshot(snap({ name: 'pre-sync-2', capturedAt: '2026-06-11T00:00:00.000Z' }), dir);
    await saveSnapshot(snap({ name: 'pre-sync-3', capturedAt: '2026-06-12T00:00:00.000Z' }), dir);
    expect(await pruneSnapshots('pre-sync-', 2, dir)).toEqual(['pre-sync-1']);

    function readName2(snapshot: {
      readonly version: number;
      readonly name: string;
      readonly capturedAt: string;
      readonly reports: readonly CaptureReport[];
    }) {
      return snapshot.name;
    }

    expect((await listSnapshots(dir)).map(readName2)).toEqual(['pre-sync-3', 'pre-sync-2']);
  }

  it(
    'prunes the oldest prefixed snapshots beyond the retention window',
    prunesTheOldestPrefixedSnapshotsBeyondTheRetentionWindow,
  );

  async function neverPrunesASnapshotWhoseNameDoesNotPieceThePrefix() {
    await saveSnapshot(snap({ name: 'manual', capturedAt: '2026-06-09T00:00:00.000Z' }), dir);
    await saveSnapshot(snap({ name: 'pre-sync-1', capturedAt: '2026-06-10T00:00:00.000Z' }), dir);
    await saveSnapshot(snap({ name: 'pre-sync-2', capturedAt: '2026-06-11T00:00:00.000Z' }), dir);
    expect(await pruneSnapshots('pre-sync-', 1, dir)).toEqual(['pre-sync-1']);

    function readName3(snapshot: {
      readonly version: number;
      readonly name: string;
      readonly capturedAt: string;
      readonly reports: readonly CaptureReport[];
    }) {
      return snapshot.name;
    }

    expect((await listSnapshots(dir)).map(readName3).sort()).toEqual(['manual', 'pre-sync-2']);
  }

  it(
    'never prunes a snapshot whose name does not match the prefix',
    neverPrunesASnapshotWhoseNameDoesNotPieceThePrefix,
  );

  async function deletesASnapshotByNameReportingWhetherAFileWasRemoved() {
    await saveSnapshot(snap({ name: 'scratch' }), dir);
    expect(await deleteSnapshot('scratch', dir)).toBe(true);

    const snapshot = await loadSnapshot('scratch', dir);

    expect(snapshot).toBeNull();
    expect(await deleteSnapshot('scratch', dir)).toBe(false);
  }

  it(
    'deletes a snapshot by name, reporting whether a file was removed',
    deletesASnapshotByNameReportingWhetherAFileWasRemoved,
  );
}

describe('snapshot store', describeSnapshotStore);
function describePlanPrune() {
  const now = new Date('2026-06-21T00:00:00.000Z');
  const snaps: Snapshot[] = [
    snap({ name: 'd1', capturedAt: '2026-06-20T00:00:00.000Z' }),
    snap({ name: 'd10', capturedAt: '2026-06-11T00:00:00.000Z' }),
    snap({ name: 'd30', capturedAt: '2026-05-22T00:00:00.000Z' }),
  ];

  function keepsTheNNewestMarkingTheRestForDeletion() {
    function readName4(saved: {
      readonly version: number;
      readonly name: string;
      readonly capturedAt: string;
      readonly reports: readonly CaptureReport[];
    }) {
      return saved.name;
    }

    expect(planPrune(snaps, { keep: 1 }, now).map(readName4)).toEqual(['d10', 'd30']);
  }

  it('keeps the N newest, marking the rest for deletion', keepsTheNNewestMarkingTheRestForDeletion);

  function deletesSnapshotsOlderThanTheDayThreshold() {
    function readName5(saved: {
      readonly version: number;
      readonly name: string;
      readonly capturedAt: string;
      readonly reports: readonly CaptureReport[];
    }) {
      return saved.name;
    }

    expect(planPrune(snaps, { olderThanDays: 5 }, now).map(readName5)).toEqual(['d10', 'd30']);
  }

  it('deletes snapshots older than the day threshold', deletesSnapshotsOlderThanTheDayThreshold);

  function unionsTheTwoRulesASnapshotMatchingEitherIsDeleted() {
    function readName6(saved: {
      readonly version: number;
      readonly name: string;
      readonly capturedAt: string;
      readonly reports: readonly CaptureReport[];
    }) {
      return saved.name;
    }

    expect(planPrune(snaps, { keep: 2, olderThanDays: 5 }, now).map(readName6).sort()).toEqual([
      'd10',
      'd30',
    ]);
  }

  it(
    'unions the two rules - a snapshot matching either is deleted',
    unionsTheTwoRulesASnapshotMatchingEitherIsDeleted,
  );

  function sortsByCapturedAtBeforeApplyingKeepRegardlessOfPieceOrder() {
    function isSnapshotDefined(
      saved:
        | Readonly<{
            version: number;
            name: string;
            capturedAt: string;
            reports: readonly CaptureReport[];
          }>
        | undefined,
    ): saved is Snapshot {
      return saved != null;
    }

    const shuffled = [snaps[1], snaps[2], snaps[0]].filter(isSnapshotDefined);

    function readName7(saved: {
      readonly version: number;
      readonly name: string;
      readonly capturedAt: string;
      readonly reports: readonly CaptureReport[];
    }) {
      return saved.name;
    }

    expect(planPrune(shuffled, { keep: 1 }, now).map(readName7)).toEqual(['d10', 'd30']);
  }

  it(
    'sorts by capturedAt before applying keep, regardless of input order',
    sortsByCapturedAtBeforeApplyingKeepRegardlessOfPieceOrder,
  );
}

describe('planPrune', describePlanPrune);
