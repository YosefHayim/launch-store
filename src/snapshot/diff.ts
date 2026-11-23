import type { JsonValue, Snapshot, SnapshotEntity, SnapshotStore } from '../types/snapshot.ts';
/** How one entity differs between the two snapshots. */
export type DiffChange = 'added' | 'removed' | 'changed';
/** One entity-level difference, carrying enough identity to render it grouped by store -> app -> surface. */
type EntityDiff = {
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
    if (report.outcome.state != 'captured') continue;
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
export function stableStringify(jsonNode: JsonValue): string {
  if (jsonNode == null) return JSON.stringify(jsonNode);
  if (typeof jsonNode != 'object') return JSON.stringify(jsonNode);
  if (Array.isArray(jsonNode)) return `[${jsonNode.map(stableStringify).join(',')}]`;
  function sortPiece([leftKey]: [string, JsonValue], [rightKey]: [string, JsonValue]) {
    return leftKey.localeCompare(rightKey);
  }

  function mapPiece([key, fieldValue]: [string, JsonValue]) {
    return `${JSON.stringify(key)}:${stableStringify(fieldValue)}`;
  }

  const serializedFields = Object.entries(jsonNode).sort(sortPiece).map(mapPiece).join(',');
  return `{${serializedFields}}`;
}
function unavailableScopes(snapshot: Snapshot) {
  const sources = new Set<string>();
  const apps = new Set<string>();
  for (const report of snapshot.reports) {
    if (report.outcome.state == 'skipped' || report.outcome.state == 'errored') {
      const serialized = JSON.stringify([report.store, report.id]);
      sources.add(serialized);
    }
    if (report.outcome.state == 'captured' && report.outcome.skippedApps != null) {
      for (const app of report.outcome.skippedApps) {
        const serialized = JSON.stringify([report.store, report.id, app.app]);
        apps.add(serialized);
      }
    }
  }
  return { sources, apps };
}

/**
 * Compare snapshot `a` (the baseline) against `b` (the newer / `live`). Entries are emitted in the
 * deterministic order the combined key space sorts to, so the rendered diff is stable run to run.
 */
export function diffSnapshots(a: Snapshot, b: Snapshot): SnapshotDiff {
  const before = flatten(a);
  const after = flatten(b);
  const unavailableBefore = unavailableScopes(a);
  const unavailableAfter = unavailableScopes(b);
  const entries: EntityDiff[] = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const prev = before.get(key);
    const next = after.get(key);
    const entry = prev ?? next;
    const isThereEntry = entry != null;
    if (isThereEntry) {
      const sourceKey = JSON.stringify([entry.store, entry.sourceId]);
      const appKey = JSON.stringify([entry.store, entry.sourceId, entry.app]);
      if (
        unavailableBefore.sources.has(sourceKey) ||
        unavailableAfter.sources.has(sourceKey) ||
        unavailableBefore.apps.has(appKey) ||
        unavailableAfter.apps.has(appKey)
      )
        continue;
    }
    if (prev && !next) {
      entries.push(toEntry(prev, 'removed'));
    } else if (!prev && next) {
      entries.push(toEntry(next, 'added'));
    } else if (
      prev &&
      next &&
      stableStringify(prev.entity.data) != stableStringify(next.entity.data)
    ) {
      entries.push(toEntry(next, 'changed'));
    }
  }
  function filterPiece(entry: {
    store: SnapshotStore;
    sourceId: string;
    sourceTitle: string;
    app: string;
    key: string;
    change: DiffChange;
    summary: string;
  }) {
    return entry.change == 'added';
  }

  function filterPiece2(entry: {
    store: SnapshotStore;
    sourceId: string;
    sourceTitle: string;
    app: string;
    key: string;
    change: DiffChange;
    summary: string;
  }) {
    return entry.change == 'removed';
  }

  function filterPiece3(entry: {
    store: SnapshotStore;
    sourceId: string;
    sourceTitle: string;
    app: string;
    key: string;
    change: DiffChange;
    summary: string;
  }) {
    return entry.change == 'changed';
  }

  return {
    entries,
    addedCount: entries.filter(filterPiece).length,
    removedCount: entries.filter(filterPiece2).length,
    changedCount: entries.filter(filterPiece3).length,
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
