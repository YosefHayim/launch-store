import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../path-exists.ts';
import { resolveSnapshotFilePath, resolveSnapshotsDirectory } from '../services/platform/paths.ts';
import type {
  AppEntities,
  CaptureOutcome,
  CaptureReport,
  JsonValue,
  Snapshot,
  SnapshotEntity,
} from '../types/snapshot.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

function isJsonValue(candidate: unknown): candidate is JsonValue {
  if (candidate == null) {
    return true;
  }

  if (typeof candidate == 'string') {
    return true;
  }

  if (typeof candidate == 'number') {
    return Number.isFinite(candidate);
  }

  if (typeof candidate == 'boolean') {
    return true;
  }

  if (Array.isArray(candidate)) {
    for (const member of candidate) {
      if (isJsonValue(member) == false) {
        return false;
      }
    }

    return true;
  }

  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return false;
  }

  for (const member of Object.values(candidateObject)) {
    if (isJsonValue(member) == false) {
      return false;
    }
  }

  return true;
}

function isSnapshotEntity(candidate: unknown): candidate is SnapshotEntity {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return false;
  }

  if (typeof candidateObject['key'] != 'string') {
    return false;
  }

  if (typeof candidateObject['summary'] != 'string') {
    return false;
  }

  return isJsonValue(candidateObject['data']);
}

function isAppEntities(candidate: unknown): candidate is AppEntities {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return false;
  }

  if (typeof candidateObject['app'] != 'string') {
    return false;
  }

  if (typeof candidateObject['identifier'] != 'string') {
    return false;
  }

  if (Array.isArray(candidateObject['entities']) == false) {
    return false;
  }

  for (const entity of candidateObject['entities']) {
    if (isSnapshotEntity(entity) == false) {
      return false;
    }
  }

  return true;
}

function optionalStringIsValid(record: Record<string, unknown>, key: string): boolean {
  if (Object.hasOwn(record, key) == false) {
    return true;
  }

  return typeof record[key] == 'string';
}

function isSkippedOutcome(candidate: Record<string, unknown>): boolean {
  if (typeof candidate['reason'] != 'string') {
    return false;
  }

  return optionalStringIsValid(candidate, 'hint');
}

function isCapturedOutcome(candidate: Record<string, unknown>): boolean {
  if (Array.isArray(candidate['apps']) == false) {
    return false;
  }

  for (const app of candidate['apps']) {
    if (isAppEntities(app) == false) {
      return false;
    }
  }

  if (Object.hasOwn(candidate, 'skippedApps') == false) {
    return true;
  }

  if (Array.isArray(candidate['skippedApps']) == false) {
    return false;
  }

  for (const skippedApp of candidate['skippedApps']) {
    const skippedAppObject = readPlainObject(skippedApp);

    if (skippedAppObject == null) {
      return false;
    }

    if (typeof skippedAppObject['app'] != 'string') {
      return false;
    }

    if (typeof skippedAppObject['identifier'] != 'string') {
      return false;
    }

    if (typeof skippedAppObject['reason'] != 'string') {
      return false;
    }
  }

  return true;
}

function isCaptureOutcome(candidate: unknown): candidate is CaptureOutcome {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return false;
  }

  if (candidateObject['state'] == 'omitted') {
    return true;
  }

  if (candidateObject['state'] == 'skipped') {
    return isSkippedOutcome(candidateObject);
  }

  if (candidateObject['state'] == 'errored') {
    return typeof candidateObject['error'] == 'string';
  }

  if (candidateObject['state'] == 'captured') {
    return isCapturedOutcome(candidateObject);
  }

  return false;
}

function isSnapshotStore(store: unknown): boolean {
  if (store == 'appstore') {
    return true;
  }

  return store == 'play';
}

function isCaptureReport(candidate: unknown): candidate is CaptureReport {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return false;
  }

  if (typeof candidateObject['id'] != 'string') {
    return false;
  }

  if (typeof candidateObject['title'] != 'string') {
    return false;
  }

  if (isSnapshotStore(candidateObject['store']) == false) {
    return false;
  }

  return isCaptureOutcome(candidateObject['outcome']);
}

function isSnapshot(candidate: unknown): candidate is Snapshot {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return false;
  }

  if (typeof candidateObject['version'] != 'number') {
    return false;
  }

  if (typeof candidateObject['name'] != 'string') {
    return false;
  }

  if (typeof candidateObject['capturedAt'] != 'string') {
    return false;
  }

  if (Array.isArray(candidateObject['reports']) == false) {
    return false;
  }

  for (const report of candidateObject['reports']) {
    if (isCaptureReport(report) == false) {
      return false;
    }
  }

  return true;
}

function snapshotDirectory(directoryOverride: string | undefined): string {
  if (directoryOverride != null) {
    return directoryOverride;
  }

  return resolveSnapshotsDirectory();
}

function snapshotFilePath(snapshotName: string, directoryOverride: string | undefined): string {
  if (directoryOverride == null) {
    return resolveSnapshotFilePath(snapshotName);
  }

  // Keeps letters, digits, underscores, and hyphens; drops the rest of the name.
  const sanitizedName = snapshotName.replace(/[^A-Za-z0-9_-]/g, '');
  let fileName = 'snapshot';

  if (sanitizedName.length > 0) {
    fileName = sanitizedName;
  }

  return join(directoryOverride, `${fileName}.json`);
}

function decodeSnapshot(snapshotText: string): Snapshot | null {
  try {
    const parsed: unknown = JSON.parse(snapshotText);

    if (isSnapshot(parsed) == false) {
      return null;
    }

    return parsed;
  } catch (cause) {
    const isUnreadable = cause != null;

    if (isUnreadable) {
      return null;
    }

    return null;
  }
}

/** Persist one snapshot and return its file path. */
export async function saveSnapshot(
  snapshot: Snapshot,
  directoryOverride?: string,
): Promise<string> {
  const directoryPath = snapshotDirectory(directoryOverride);
  const filePath = snapshotFilePath(snapshot.name, directoryOverride);

  await mkdir(directoryPath, { recursive: true });
  await writeFile(filePath, JSON.stringify(snapshot, null, 2));

  return filePath;
}

/** Load one snapshot, returning null for absent, unreadable, or malformed files. */
export async function loadSnapshot(
  snapshotName: string,
  directoryOverride?: string,
): Promise<Snapshot | null> {
  const filePath = snapshotFilePath(snapshotName, directoryOverride);
  const fileIsPresent = await pathExists(filePath);

  if (fileIsPresent == false) {
    return null;
  }

  try {
    const snapshotText = await readFile(filePath, 'utf8');

    return decodeSnapshot(snapshotText);
  } catch (cause) {
    const isUnreadable = cause != null;

    if (isUnreadable) {
      return null;
    }

    return null;
  }
}

/** List valid snapshots newest first. */
export async function listSnapshots(directoryOverride?: string): Promise<readonly Snapshot[]> {
  const directoryPath = snapshotDirectory(directoryOverride);
  const directoryIsPresent = await pathExists(directoryPath);

  if (directoryIsPresent == false) {
    return [];
  }

  let entryNames: string[] = [];

  try {
    entryNames = await readdir(directoryPath);
  } catch (cause) {
    const isUnreadable = cause != null;

    if (isUnreadable) {
      return [];
    }

    return [];
  }

  const jsonNames = entryNames.filter(function isJsonFile(entryName) {
    return entryName.endsWith('.json');
  });

  const snapshotCandidates = await Promise.all(
    jsonNames.map(function readSnapshotFile(entryName) {
      return readStoredSnapshot(join(directoryPath, entryName));
    }),
  );

  return snapshotCandidates
    .filter(function isStoredSnapshot(snapshot): snapshot is Snapshot {
      return snapshot != null;
    })
    .sort(function newestFirst(firstSnapshot, secondSnapshot) {
      return secondSnapshot.capturedAt.localeCompare(firstSnapshot.capturedAt);
    });
}

async function readStoredSnapshot(filePath: string): Promise<Snapshot | null> {
  try {
    const snapshotText = await readFile(filePath, 'utf8');

    return decodeSnapshot(snapshotText);
  } catch (cause) {
    const isUnreadable = cause != null;

    if (isUnreadable) {
      return null;
    }

    return null;
  }
}

/** Prune old snapshots with a matching reserved prefix. */
export async function pruneSnapshots(
  namePrefix: string,
  keepCount: number,
  directoryOverride?: string,
): Promise<readonly string[]> {
  const storedSnapshots = await listSnapshots(directoryOverride);
  const staleSnapshots = storedSnapshots
    .filter(function hasPrefix(snapshot) {
      return snapshot.name.startsWith(namePrefix);
    })
    .slice(Math.max(0, keepCount));
  const removedNames: string[] = [];

  for (const snapshot of staleSnapshots) {
    const filePath = snapshotFilePath(snapshot.name, directoryOverride);
    const removed = await removeSnapshotFile(filePath);

    if (removed) {
      removedNames.push(snapshot.name);
    }
  }

  return removedNames;
}

async function removeSnapshotFile(filePath: string): Promise<boolean> {
  try {
    await rm(filePath, { force: true });

    return true;
  } catch (cause) {
    const failed = cause != null;

    if (failed) {
      return false;
    }

    return false;
  }
}

/** Delete one snapshot and report whether its file existed. */
export async function deleteSnapshot(
  snapshotName: string,
  directoryOverride?: string,
): Promise<boolean> {
  const filePath = snapshotFilePath(snapshotName, directoryOverride);
  const fileIsPresent = await pathExists(filePath);

  if (fileIsPresent == false) {
    return false;
  }

  return removeSnapshotFile(filePath);
}

export type PruneCriteria = {
  keep?: number;
  olderThanDays?: number;
};

function ageInDays(capturedAt: string, now: Date): number {
  const dayMilliseconds = 86_400_000;

  return (now.getTime() - new Date(capturedAt).getTime()) / dayMilliseconds;
}

/** Select snapshots matching either configured prune rule. */
export function planPrune(snapshots: Snapshot[], criteria: PruneCriteria, now: Date): Snapshot[] {
  const newestFirst = [...snapshots].sort(function newestFirst(firstSnapshot, secondSnapshot) {
    return secondSnapshot.capturedAt.localeCompare(firstSnapshot.capturedAt);
  });

  return newestFirst.filter(function shouldPrune(snapshot, snapshotIndex) {
    return matchesPruneRule(snapshot, snapshotIndex, criteria, now);
  });
}

function matchesPruneRule(
  snapshot: Snapshot,
  snapshotIndex: number,
  criteria: PruneCriteria,
  now: Date,
): boolean {
  const isOlderThanLimit = olderThanLimit(snapshot.capturedAt, criteria.olderThanDays, now);

  if (isOlderThanLimit) {
    return true;
  }

  return beyondKeepCount(snapshotIndex, criteria.keep);
}

function olderThanLimit(capturedAt: string, olderThanDays: number | undefined, now: Date): boolean {
  if (olderThanDays == null) {
    return false;
  }

  return ageInDays(capturedAt, now) > olderThanDays;
}

function beyondKeepCount(snapshotIndex: number, keep: number | undefined): boolean {
  if (keep == null) {
    return false;
  }

  return snapshotIndex >= keep;
}
