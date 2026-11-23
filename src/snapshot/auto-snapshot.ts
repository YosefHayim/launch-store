// Saves a copy of the stores before Launch syncs, and drops old automatic copies.

import type { SnapshotContext } from '../types/snapshot.ts';
import { captureSnapshot } from './orchestrator.ts';
import { listSnapshotSources, registerBuiltinSources } from './registry.ts';
import { pruneSnapshots, saveSnapshot } from './store.ts';

export const AUTO_SNAPSHOT_PREFIX = 'pre-sync-';

/** Build a filesystem-safe auto-snapshot name from an ISO timestamp. */
export function autoSnapshotName(capturedAt: string): string {
  // Replaces colons and dots so the timestamp can be a file name.
  return `${AUTO_SNAPSHOT_PREFIX}${capturedAt.replace(/[:.]/g, '-')}`;
}

type AutoSnapshotResult = Readonly<{
  readonly name: string;
  readonly file: string;
  readonly entityCount: number;
  readonly skippedCount: number;
  readonly pruned: readonly string[];
}>;

type CaptureAutoSnapshotOptions = Readonly<{
  readonly capturedAt: string;
  readonly keep?: number;
  readonly dir?: string;
}>;

/** Capture, persist, and bound automatic pre-sync baselines. */
export async function captureAutoSnapshot(
  snapshotContext: SnapshotContext,
  options: CaptureAutoSnapshotOptions,
): Promise<AutoSnapshotResult> {
  registerBuiltinSources();

  const snapshotName = autoSnapshotName(options.capturedAt);
  const snapshotSources = listSnapshotSources();
  const capturedSnapshot = await captureSnapshot(snapshotContext, snapshotSources, {
    name: snapshotName,
    capturedAt: options.capturedAt,
  });
  const snapshotFilePath = await saveSnapshot(capturedSnapshot.snapshot, options.dir);
  const autoSnapshotKeep = 10;
  let keepCount = autoSnapshotKeep;

  if (options.keep != null) {
    keepCount = options.keep;
  }

  const prunedSnapshots = await pruneSnapshots(AUTO_SNAPSHOT_PREFIX, keepCount, options.dir);

  return {
    name: snapshotName,
    file: snapshotFilePath,
    entityCount: capturedSnapshot.entityCount,
    skippedCount: capturedSnapshot.skippedCount,
    pruned: prunedSnapshots,
  };
}
