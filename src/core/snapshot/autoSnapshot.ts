import type { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import type { LaunchPathsService } from '../services/paths.js';
import type { SnapshotContext } from '../types/snapshot.js';
import { captureSnapshot } from './orchestrator.js';
import { listSnapshotSources, registerBuiltinSources } from './registry.js';
import { pruneSnapshots, saveSnapshot } from './store.js';

export const AUTO_SNAPSHOT_PREFIX = 'pre-sync-';
export const AUTO_SNAPSHOT_KEEP = 10;

/** Build a filesystem-safe auto-snapshot name from an ISO timestamp. */
export const autoSnapshotName = (capturedAt: string): string =>
  `${AUTO_SNAPSHOT_PREFIX}${capturedAt.replace(/[:.]/g, '-')}`;

export type AutoSnapshotResult = Readonly<{
  readonly name: string;
  readonly file: string;
  readonly entityCount: number;
  readonly skippedCount: number;
  readonly pruned: readonly string[];
}>;

export type CaptureAutoSnapshotOptions = Readonly<{
  readonly capturedAt: string;
  readonly keep?: number;
  readonly dir?: string;
}>;

/** Capture, persist, and bound automatic pre-sync baselines. */
export const captureAutoSnapshot = (
  snapshotContext: SnapshotContext,
  options: CaptureAutoSnapshotOptions,
): Effect.Effect<
  AutoSnapshotResult,
  unknown,
  FileSystem.FileSystem | LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    registerBuiltinSources();
    const snapshotName = autoSnapshotName(options.capturedAt);
    const capturedSnapshot = yield* captureSnapshot(snapshotContext, listSnapshotSources(), {
      name: snapshotName,
      capturedAt: options.capturedAt,
    });
    const snapshotFilePath = yield* saveSnapshot(capturedSnapshot.snapshot, options.dir);
    let keepCount = AUTO_SNAPSHOT_KEEP;
    if (options.keep !== undefined) keepCount = options.keep;
    const prunedSnapshots = yield* pruneSnapshots(AUTO_SNAPSHOT_PREFIX, keepCount, options.dir);
    return {
      name: snapshotName,
      file: snapshotFilePath,
      entityCount: capturedSnapshot.entityCount,
      skippedCount: capturedSnapshot.skippedCount,
      pruned: prunedSnapshots,
    };
  });
