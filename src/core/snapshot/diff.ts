import type { JsonValue, Snapshot, SnapshotEntity, SnapshotStore } from '../types/snapshot.js';
/** How one entity differs between the two snapshots. */
export type DiffChange = 'added' | 'removed' | 'changed';
/** One entity-level difference, carrying enough identity to render it grouped by store -> app -> surface. */
export type EntityDiff = {
  store: SnapshotStore;
  sourceId: string;
  sourceTitle: string;
  app: string;
  key: string;
  change: DiffChange;
  summary: string;
};
/** The full result of comparing two snapshots. */
export type SnapshotDiff = {
  entries: EntityDiff[];
  addedCount: number;
  removedCount: number;
  changedCount: number;
};
/** A flattened entity plus the identity needed to pair and render it. */
type FlatEntity = {
  store: SnapshotStore;
  sourceId: string;
  sourceTitle: string;
  app: string;
  entity: SnapshotEntity;
};
/**
 * The composite key that pairs one entity across two snapshots. Serializing the identity tuple as JSON
 * gives a collision-free key (quoting escapes any character a part might contain) without picking a
 * separator that could appear in an app handle or product id.
 */
const compositeKey = (
  store: SnapshotStore,
  sourceId: string,
  app: string,
  entityKey: string,
): string => {
  return JSON.stringify([store, sourceId, app, entityKey]);
};
/** Flatten a snapshot's captured surfaces to entities keyed for pairing; skipped/errored surfaces hold none. */
const flatten = (snapshot: Snapshot): Map<string, FlatEntity> => {
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
};
/** Canonical JSON with recursively sorted object keys, so field order never registers as a change. */
export const stableStringify = (jsonNode: JsonValue): string => {
  if (jsonNode === null) return JSON.stringify(jsonNode);
  if (typeof jsonNode !== 'object') return JSON.stringify(jsonNode);
  if (Array.isArray(jsonNode)) return `[${jsonNode.map(stableStringify).join(',')}]`;
  const serializedFields = Object.entries(jsonNode)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, fieldValue]) => `${JSON.stringify(key)}:${stableStringify(fieldValue)}`)
    .join(',');
  return `{${serializedFields}}`;
};
/**
 * Compare snapshot `a` (the baseline) against `b` (the newer / `live`). Entries are emitted in the
 * deterministic order the combined key space sorts to, so the rendered diff is stable run to run.
 */
export const diffSnapshots = (a: Snapshot, b: Snapshot): SnapshotDiff => {
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
};
/** Project a flattened entity to a diff entry under the given change kind. */
const toEntry = (flat: FlatEntity, change: DiffChange): EntityDiff => {
  return {
    store: flat.store,
    sourceId: flat.sourceId,
    sourceTitle: flat.sourceTitle,
    app: flat.app,
    key: flat.entity.key,
    change,
    summary: flat.entity.summary,
  };
};
