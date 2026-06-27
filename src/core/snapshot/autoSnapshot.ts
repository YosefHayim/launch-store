/**
 * Capture an automatic "before" snapshot ahead of a destructive store run (`launch sync`) so the change is
 * reversible against a known baseline, and prune older auto-snapshots to a fixed retention window.
 *
 * This is the write-path counterpart to the read-only `snapshot create` command: same capture engine and
 * sources, but the record is named with a reserved prefix and self-pruning, so unattended `sync` runs don't
 * accumulate unbounded baselines. It takes an already-built {@link SnapshotContext} (the caller passes its
 * resolved clients) rather than constructing clients itself — keeping it unit-testable with fake/null
 * resolvers and letting `sync` reuse the App Store Connect client it already created.
 */

import { captureSnapshot } from './orchestrator.js';
import { listSnapshotSources, registerBuiltinSources } from './registry.js';
import { pruneSnapshots, saveSnapshot } from './store.js';
import type { SnapshotContext } from './types.js';

/** Name prefix marking a snapshot as an automatic pre-sync baseline — also the scope pruning retains. */
export const AUTO_SNAPSHOT_PREFIX = 'pre-sync-';

/** How many automatic pre-sync baselines to keep; older ones are pruned after each capture. */
export const AUTO_SNAPSHOT_KEEP = 10;

/** A filesystem-safe auto-snapshot name from an ISO capture time (`pre-sync-2026-06-17T08-00-00-000Z`). */
export function autoSnapshotName(capturedAt: string): string {
  return `${AUTO_SNAPSHOT_PREFIX}${capturedAt.replace(/[:.]/g, '-')}`;
}

/** What {@link captureAutoSnapshot} hands back for the caller's one-line "saved baseline" log. */
export interface AutoSnapshotResult {
  /** The saved baseline's name (also its file basename). */
  name: string;
  /** Absolute path the baseline was written to. */
  file: string;
  /** Total captured items across every surface — the headline count. */
  entityCount: number;
  /** Surfaces skipped because a store's credentials aren't configured. */
  skippedCount: number;
  /** Names of older auto-snapshots removed by the retention window. */
  pruned: string[];
}

/**
 * Capture every registered source into a reserved-prefix baseline, persist it, and prune older
 * auto-snapshots beyond `keep` (default {@link AUTO_SNAPSHOT_KEEP}). Read-only against the stores — the only
 * local writes are the new record and the pruned files. Like `snapshot create`, a surface without
 * credentials is recorded as skipped rather than throwing, so a partial capture still yields a usable "before".
 */
export async function captureAutoSnapshot(
  ctx: SnapshotContext,
  opts: { capturedAt: string; keep?: number; dir?: string },
): Promise<AutoSnapshotResult> {
  registerBuiltinSources();
  const name = autoSnapshotName(opts.capturedAt);
  const result = await captureSnapshot(ctx, listSnapshotSources(), {
    name,
    capturedAt: opts.capturedAt,
  });
  const file = saveSnapshot(result.snapshot, opts.dir);
  const pruned = pruneSnapshots(AUTO_SNAPSHOT_PREFIX, opts.keep ?? AUTO_SNAPSHOT_KEEP, opts.dir);
  return { name, file, entityCount: result.entityCount, skippedCount: result.skippedCount, pruned };
}
