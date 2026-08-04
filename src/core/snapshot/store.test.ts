import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileSystem, Path } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteSnapshot,
  listSnapshots,
  loadSnapshot,
  planPrune,
  pruneSnapshots,
  saveSnapshot,
} from './store.js';
import type { Snapshot } from '../types/snapshot.js';
import { makeLaunchPathsTest, type LaunchPathsService } from '../services/paths.js';

/** Run snapshot persistence with deterministic platform and home-directory services. */
const runStoreEffect = <Value, Failure>(
  storeEffect: Effect.Effect<
    Value,
    Failure,
    FileSystem.FileSystem | LaunchPathsService | Path.Path
  >,
) =>
  Effect.runPromise(
    storeEffect.pipe(
      Effect.provide(NodeContext.layer),
      Effect.provide(makeLaunchPathsTest('/test-home', '/workspace')),
    ),
  );
/** A minimal valid snapshot, overridable per field. */
const snap = (over: Partial<Snapshot> = {}): Snapshot => {
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
};
describe('snapshot store', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launch-snapshots-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  it('round-trips a snapshot through save -> load unchanged', async () => {
    const snapshot = snap();
    await runStoreEffect(saveSnapshot(snapshot, dir));
    expect(await runStoreEffect(loadSnapshot(snapshot.name, dir))).toEqual(snapshot);
  });
  it('overwrites a snapshot re-saved under the same name', async () => {
    await runStoreEffect(saveSnapshot(snap({ capturedAt: '2026-06-16T00:00:00.000Z' }), dir));
    await runStoreEffect(saveSnapshot(snap({ capturedAt: '2026-06-16T12:00:00.000Z' }), dir));
    expect((await runStoreEffect(loadSnapshot('before-sync', dir)))?.capturedAt).toBe(
      '2026-06-16T12:00:00.000Z',
    );
    expect(await runStoreEffect(listSnapshots(dir))).toHaveLength(1);
  });
  it('returns null for an unknown name', async () => {
    expect(await runStoreEffect(loadSnapshot('nope', dir))).toBeNull();
  });
  it('tolerates a corrupt record (reads as null, skips it in lists)', async () => {
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    await runStoreEffect(saveSnapshot(snap(), dir));
    expect(await runStoreEffect(loadSnapshot('broken', dir))).toBeNull();
    expect(await runStoreEffect(listSnapshots(dir))).toHaveLength(1);
  });
  it('lists snapshots newest-first by capturedAt', async () => {
    await runStoreEffect(
      saveSnapshot(snap({ name: 'old', capturedAt: '2026-06-10T00:00:00.000Z' }), dir),
    );
    await runStoreEffect(
      saveSnapshot(snap({ name: 'new', capturedAt: '2026-06-15T00:00:00.000Z' }), dir),
    );
    expect((await runStoreEffect(listSnapshots(dir))).map((snapshot) => snapshot.name)).toEqual([
      'new',
      'old',
    ]);
  });
  it('returns an empty list when no snapshots directory exists', async () => {
    expect(await runStoreEffect(listSnapshots(join(dir, 'missing')))).toEqual([]);
  });
  it('prunes the oldest prefixed snapshots beyond the retention window', async () => {
    await runStoreEffect(
      saveSnapshot(snap({ name: 'pre-sync-1', capturedAt: '2026-06-10T00:00:00.000Z' }), dir),
    );
    await runStoreEffect(
      saveSnapshot(snap({ name: 'pre-sync-2', capturedAt: '2026-06-11T00:00:00.000Z' }), dir),
    );
    await runStoreEffect(
      saveSnapshot(snap({ name: 'pre-sync-3', capturedAt: '2026-06-12T00:00:00.000Z' }), dir),
    );
    expect(await runStoreEffect(pruneSnapshots('pre-sync-', 2, dir))).toEqual(['pre-sync-1']);
    expect((await runStoreEffect(listSnapshots(dir))).map((snapshot) => snapshot.name)).toEqual([
      'pre-sync-3',
      'pre-sync-2',
    ]);
  });
  it('never prunes a snapshot whose name does not match the prefix', async () => {
    await runStoreEffect(
      saveSnapshot(snap({ name: 'manual', capturedAt: '2026-06-09T00:00:00.000Z' }), dir),
    );
    await runStoreEffect(
      saveSnapshot(snap({ name: 'pre-sync-1', capturedAt: '2026-06-10T00:00:00.000Z' }), dir),
    );
    await runStoreEffect(
      saveSnapshot(snap({ name: 'pre-sync-2', capturedAt: '2026-06-11T00:00:00.000Z' }), dir),
    );
    expect(await runStoreEffect(pruneSnapshots('pre-sync-', 1, dir))).toEqual(['pre-sync-1']);
    expect(
      (await runStoreEffect(listSnapshots(dir))).map((snapshot) => snapshot.name).sort(),
    ).toEqual(['manual', 'pre-sync-2']);
  });
  it('deletes a snapshot by name, reporting whether a file was removed', async () => {
    await runStoreEffect(saveSnapshot(snap({ name: 'scratch' }), dir));
    expect(await runStoreEffect(deleteSnapshot('scratch', dir))).toBe(true);
    expect(await runStoreEffect(loadSnapshot('scratch', dir))).toBeNull();
    expect(await runStoreEffect(deleteSnapshot('scratch', dir))).toBe(false);
  });
});
describe('planPrune', () => {
  const now = new Date('2026-06-21T00:00:00.000Z');
  /** Three user snapshots: 1 day, 10 days, and 30 days old (newest first). */
  const snaps: Snapshot[] = [
    snap({ name: 'd1', capturedAt: '2026-06-20T00:00:00.000Z' }),
    snap({ name: 'd10', capturedAt: '2026-06-11T00:00:00.000Z' }),
    snap({ name: 'd30', capturedAt: '2026-05-22T00:00:00.000Z' }),
  ];
  it('keeps the N newest, marking the rest for deletion', () => {
    expect(planPrune(snaps, { keep: 1 }, now).map((s) => s.name)).toEqual(['d10', 'd30']);
  });
  it('deletes snapshots older than the day threshold', () => {
    expect(planPrune(snaps, { olderThanDays: 5 }, now).map((s) => s.name)).toEqual(['d10', 'd30']);
  });
  it('unions the two rules - a snapshot matching either is deleted', () => {
    // keep:2 marks only d30; olderThan:5 marks d10 and d30 - the union is {d10, d30}.
    expect(
      planPrune(snaps, { keep: 2, olderThanDays: 5 }, now)
        .map((s) => s.name)
        .sort(),
    ).toEqual(['d10', 'd30']);
  });
  it('sorts by capturedAt before applying keep, regardless of input order', () => {
    const shuffled = [snaps[1], snaps[2], snaps[0]].filter((s): s is Snapshot => s !== undefined);
    expect(planPrune(shuffled, { keep: 1 }, now).map((s) => s.name)).toEqual(['d10', 'd30']);
  });
});
