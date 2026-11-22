import { createLogger } from '../services/platform/logger.ts';
import type { Snapshot } from '../types/snapshot.ts';
import { AUTO_SNAPSHOT_PREFIX } from './auto-snapshot.ts';
import { snapshotFailure } from './snapshot-failure.ts';
import { deleteSnapshot, listSnapshots, planPrune, type PruneCriteria } from './store.ts';

export type PruneOptions = {
  keep?: string;
  olderThan?: string;
  yes?: boolean;
  json?: boolean;
};

export function parsePruneCount(countText: string, flagName: string): number {
  const count = Number(countText);
  const isWholeCount = Number.isInteger(count);

  if (isWholeCount == false) {
    throw snapshotFailure(
      'parse snapshot prune option',
      countText,
      `${flagName} must be a non-negative integer.`,
    );
  }

  const isNegative = count < 0;

  if (isNegative) {
    throw snapshotFailure(
      'parse snapshot prune option',
      countText,
      `${flagName} must be a non-negative integer.`,
    );
  }

  return count;
}

function hasPruneBound(pruneOptions: PruneOptions): boolean {
  if (pruneOptions.keep != null) {
    return true;
  }

  return pruneOptions.olderThan != null;
}

function isUserSnapshot(savedSnapshot: Snapshot): boolean {
  return savedSnapshot.name.startsWith(AUTO_SNAPSHOT_PREFIX) == false;
}

export async function pruneUserSnapshots(pruneOptions: PruneOptions): Promise<void> {
  const logger = createLogger(false);
  if (hasPruneBound(pruneOptions) == false) {
    throw snapshotFailure(
      'prune snapshots',
      pruneOptions,
      'Specify at least one of --keep or --older-than.',
    );
  }

  const pruneCriteria = readPruneCriteria(pruneOptions);
  const savedSnapshots = await listSnapshots();
  const userSnapshots = savedSnapshots.filter(isUserSnapshot);
  const snapshotsToPrune = planPrune(userSnapshots, pruneCriteria, new Date(Date.now()));
  const dryRun = pruneOptions.yes != true;

  if (dryRun == false) {
    for (const savedSnapshot of snapshotsToPrune) {
      await deleteSnapshot(savedSnapshot.name);
    }
  }

  if (pruneOptions.json == true) {
    const serialized = JSON.stringify(
      {
        pruned: snapshotsToPrune.map(function snapshotName(savedSnapshot) {
          return savedSnapshot.name;
        }),
        dryRun,
      },
      null,
      2,
    );
    logger.line(serialized);

    return;
  }

  if (snapshotsToPrune.length == 0) {
    logger.note('Nothing to prune.');

    return;
  }

  for (const savedSnapshot of snapshotsToPrune) {
    let operationLabel = 'deleted';

    if (dryRun) {
      operationLabel = 'would delete';
    }

    logger.step(operationLabel, `${savedSnapshot.name} - ${savedSnapshot.capturedAt}`);
  }

  logger.gap();

  if (dryRun) {
    logger.note(
      `${snapshotsToPrune.length} snapshot(s) would be deleted (dry-run - re-run with --yes to delete)`,
    );

    return;
  }

  logger.note(`Pruned ${snapshotsToPrune.length} snapshot(s).`);
}

function readPruneCriteria(pruneOptions: PruneOptions): PruneCriteria {
  const pruneCriteria: PruneCriteria = {};

  if (pruneOptions.keep != null) {
    pruneCriteria.keep = parsePruneCount(pruneOptions.keep, '--keep');
  }

  if (pruneOptions.olderThan != null) {
    pruneCriteria.olderThanDays = parsePruneCount(pruneOptions.olderThan, '--older-than');
  }

  return pruneCriteria;
}
