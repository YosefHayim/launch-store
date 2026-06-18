/**
 * Read/write the persisted `launch snapshot` records under `~/.launch/snapshots/` — the on-disk source of
 * truth `diff` / `export` / `list` operate on. Mirrors `core/releaseTrain/record.ts`: tolerant reads (a
 * missing or corrupt record reads as "no such snapshot", never a crash) and a plain write that creates the
 * directory on first use. A snapshot is a named save slot — re-capturing under the same name overwrites it.
 *
 * Pure I/O only — no capture or diff logic. The orchestrator builds a {@link Snapshot}; this module just
 * stores and retrieves it.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SNAPSHOTS_DIR, snapshotFile } from "../paths.js";
import type { Snapshot } from "./types.js";

/** Persist a snapshot, creating the snapshots directory on first write. Returns the file path written. */
export function saveSnapshot(snapshot: Snapshot, dir: string = SNAPSHOTS_DIR): string {
  const file = snapshotFileIn(dir, snapshot.name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(snapshot, null, 2));
  return file;
}

/** Read one snapshot by name, or `null` when it doesn't exist or the file is unreadable/corrupt. */
export function loadSnapshot(name: string, dir: string = SNAPSHOTS_DIR): Snapshot | null {
  const file = snapshotFileIn(dir, name);
  if (!existsSync(file)) return null;
  return parseSnapshot(safeRead(file));
}

/** Every persisted snapshot, newest first by `capturedAt`. Skips any unreadable/corrupt record. */
export function listSnapshots(dir: string = SNAPSHOTS_DIR): Snapshot[] {
  if (!existsSync(dir)) return [];
  const snapshots: Snapshot[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const snapshot = parseSnapshot(safeRead(join(dir, entry)));
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

/**
 * Prune the oldest snapshots whose name starts with `prefix`, keeping the `keep` newest. Used by the
 * pre-sync auto-snapshot to bound its reserved-prefix baselines without ever touching a user's
 * manually-named snapshot. Tolerant: a file that vanishes mid-prune is ignored. Returns the names deleted.
 */
export function pruneSnapshots(prefix: string, keep: number, dir: string = SNAPSHOTS_DIR): string[] {
  const stale = listSnapshots(dir)
    .filter((snapshot) => snapshot.name.startsWith(prefix))
    .slice(Math.max(0, keep)); // listSnapshots is newest-first, so the tail is the oldest beyond the window
  const deleted: string[] = [];
  for (const snapshot of stale) {
    try {
      unlinkSync(snapshotFileIn(dir, snapshot.name));
      deleted.push(snapshot.name);
    } catch {
      // already gone or unreadable — nothing left to prune for this entry
    }
  }
  return deleted;
}

/** Read a file's text, or `null` when it can't be read (deleted between listing and reading, permissions). */
function safeRead(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Parse and shape-check a snapshot record; returns `null` for unparseable or structurally-wrong content. */
function parseSnapshot(raw: string | null): Snapshot | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "name" in parsed &&
      typeof parsed.name === "string" &&
      "reports" in parsed &&
      Array.isArray(parsed.reports)
    ) {
      return parsed as Snapshot;
    }
    return null;
  } catch {
    return null;
  }
}

/** Resolve a snapshot's path inside `dir` — honoring an overridden dir (tests) while sanitizing the name. */
function snapshotFileIn(dir: string, name: string): string {
  if (dir === SNAPSHOTS_DIR) return snapshotFile(name);
  const safe = name.replace(/[^A-Za-z0-9_-]/g, "");
  return join(dir, `${safe || "snapshot"}.json`);
}
