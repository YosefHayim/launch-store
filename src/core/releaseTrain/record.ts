/**
 * Read/write the persisted `launch release-train` records under `~/.launch/release-trains/` — the
 * on-disk source of truth a train is advanced through across many `status` invocations (ADR 0004 D3).
 * Mirrors `core/lastRun.ts`: tolerant reads (a missing/corrupt record reads as "no such train", never a
 * crash) and a plain read-modify-write persist.
 *
 * Pure I/O only — no state-machine logic. The orchestrator (`releaseTrain/orchestrator.ts`) owns
 * advancing a record; this module just stores and retrieves it.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RELEASE_TRAINS_DIR, releaseTrainFile } from '../paths.js';
import type { TrainRecord } from './types.js';

/** Persist a train record, creating the release-trains directory on first write. */
export function writeTrainRecord(record: TrainRecord, dir: string = RELEASE_TRAINS_DIR): void {
  const file = trainFileIn(dir, record.id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(record, null, 2));
}

/** Read one train by id, or `null` when it doesn't exist or the file is unreadable/corrupt. */
export function readTrainRecord(id: string, dir: string = RELEASE_TRAINS_DIR): TrainRecord | null {
  const file = trainFileIn(dir, id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as TrainRecord;
  } catch {
    return null;
  }
}

/** Every persisted train, newest first by `createdAt`. Skips any unreadable/corrupt record. */
export function listTrainRecords(dir: string = RELEASE_TRAINS_DIR): TrainRecord[] {
  if (!existsSync(dir)) return [];
  const records: TrainRecord[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    try {
      records.push(JSON.parse(readFileSync(join(dir, entry), 'utf8')) as TrainRecord);
    } catch {
      // A corrupt record is skipped, not fatal — one bad file never hides the rest.
    }
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Resolve the train to act on when the command got no explicit id: the most recent train that is still
 * live (`running` or `blocked`), else the most recent train of any state, else `null`. Lets
 * `status` / `release` / `abort` default to "the train you're in the middle of" (ADR D6).
 */
export function latestTrainRecord(dir: string = RELEASE_TRAINS_DIR): TrainRecord | null {
  const all = listTrainRecords(dir);
  return all.find((t) => t.state === 'running' || t.state === 'blocked') ?? all[0] ?? null;
}

/** Delete a train record. Used by maintenance/tests; `abort` marks a record terminated rather than deleting. */
export function removeTrainRecord(id: string, dir: string = RELEASE_TRAINS_DIR): void {
  rmSync(trainFileIn(dir, id), { force: true });
}

/** Resolve a train's record path inside `dir` — honoring an overridden dir (tests) while sanitizing the id. */
function trainFileIn(dir: string, id: string): string {
  if (dir === RELEASE_TRAINS_DIR) return releaseTrainFile(id);
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '');
  return join(dir, `${safe || 'train'}.json`);
}
