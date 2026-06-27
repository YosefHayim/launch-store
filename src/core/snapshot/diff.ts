/**
 * The `launch snapshot diff` engine: compare two {@link Snapshot} records and report what was added,
 * removed, or changed. Pure and UI-free, like `core/plan/orchestrator.ts` — the command renders the result;
 * this module only computes it, so the contract is unit-testable directly.
 *
 * The comparison is source-agnostic: it flattens each snapshot to its captured entities keyed by
 * `(store, source, app, entity key)`, then set-diffs the two key spaces. A key present only in `b` is an
 * addition; only in `a`, a removal; in both with differing normalized `data`, a change. Equality uses a
 * canonical (sorted-key) serialization so two captures of the same state compare equal regardless of field
 * order — important when the snapshots were written by different Launch versions.
 */

import type { JsonValue, Snapshot, SnapshotEntity, SnapshotStore } from './types.js';

/** How one entity differs between the two snapshots. */
export type DiffChange = 'added' | 'removed' | 'changed';

/** One entity-level difference, carrying enough identity to render it grouped by store → app → surface. */
export interface EntityDiff {
  store: SnapshotStore;
  /** Source id (e.g. `apple-products`). */
  sourceId: string;
  /** Source title for display. */
  sourceTitle: string;
  /** App handle the entity belongs to. */
  app: string;
  /** The entity's natural key (product id / SKU). */
  key: string;
  change: DiffChange;
  /** The entity's one-line summary — from `b` for added/changed, from `a` for removed. */
  summary: string;
}

/** The full result of comparing two snapshots. */
export interface SnapshotDiff {
  /** Every difference, in a stable store → source → app → key order. */
  entries: EntityDiff[];
  addedCount: number;
  removedCount: number;
  changedCount: number;
}

/** A flattened entity plus the identity needed to pair and render it. */
interface FlatEntity {
  store: SnapshotStore;
  sourceId: string;
  sourceTitle: string;
  app: string;
  entity: SnapshotEntity;
}

/**
 * The composite key that pairs one entity across two snapshots. Serializing the identity tuple as JSON
 * gives a collision-free key (quoting escapes any character a part might contain) without picking a
 * separator that could appear in an app handle or product id.
 */
function compositeKey(
  store: SnapshotStore,
  sourceId: string,
  app: string,
  entityKey: string,
): string {
  return JSON.stringify([store, sourceId, app, entityKey]);
}

/** Flatten a snapshot's captured surfaces to entities keyed for pairing; skipped/errored surfaces hold none. */
function flatten(snapshot: Snapshot): Map<string, FlatEntity> {
  const flat = new Map<string, FlatEntity>();
  for (const report of snapshot.reports) {
    if (report.outcome.state !== 'captured') continue;
    for (const app of report.outcome.apps) {
      for (const entity of app.entities) {
        flat.set(compositeKey(report.store, report.id, app.app, entity.key), {
          store: report.store,
          sourceId: report.id,
          sourceTitle: report.title,
          app: app.app,
          entity,
        });
      }
    }
  }
  return flat;
}

/** Canonical JSON with recursively sorted object keys, so field order never registers as a change. */
export function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const body = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] as JsonValue)}`)
    .join(',');
  return `{${body}}`;
}

/**
 * Compare snapshot `a` (the baseline) against `b` (the newer / `live`). Entries are emitted in the
 * deterministic order the combined key space sorts to, so the rendered diff is stable run to run.
 */
export function diffSnapshots(a: Snapshot, b: Snapshot): SnapshotDiff {
  const before = flatten(a);
  const after = flatten(b);
  const entries: EntityDiff[] = [];

  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const prev = before.get(key);
    const next = after.get(key);
    if (prev && !next) {
      entries.push(toEntry(prev, 'removed'));
    } else if (!prev && next) {
      entries.push(toEntry(next, 'added'));
    } else if (
      prev &&
      next &&
      stableStringify(prev.entity.data) !== stableStringify(next.entity.data)
    ) {
      entries.push(toEntry(next, 'changed'));
    }
  }

  return {
    entries,
    addedCount: entries.filter((entry) => entry.change === 'added').length,
    removedCount: entries.filter((entry) => entry.change === 'removed').length,
    changedCount: entries.filter((entry) => entry.change === 'changed').length,
  };
}

/** Project a flattened entity to a diff entry under the given change kind. */
function toEntry(flat: FlatEntity, change: DiffChange): EntityDiff {
  return {
    store: flat.store,
    sourceId: flat.sourceId,
    sourceTitle: flat.sourceTitle,
    app: flat.app,
    key: flat.entity.key,
    change,
    summary: flat.entity.summary,
  };
}
