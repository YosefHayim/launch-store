import { createLogger, type Logger } from '../services/platform/logger.ts';
import type { Snapshot } from '../types/snapshot.ts';
import { diffSnapshots, type DiffChange, type SnapshotDiff } from './diff.ts';
import { captureSnapshot } from './orchestrator.ts';
import { listSnapshotSources, registerBuiltinSources } from './registry.ts';
import { SNAPSHOT_STORES, reportMissingSnapshot, storeLabel } from './snapshot-report.ts';
import {
  LIVE_SNAPSHOT,
  captureContextFromSession,
  currentIsoTime,
  loadSnapshotStoreSession,
} from './snapshot-store-session.ts';
import { loadSnapshot } from './store.ts';

const diffMarker: Readonly<Record<DiffChange, string>> = {
  added: '+',
  removed: '-',
  changed: '~',
};

export type DiffCommand = {
  operation: 'diff';
  baseline: string;
  against: string;
  app?: string;
  json?: boolean;
};

function renderDiff(
  logger: Logger,
  snapshotDiff: SnapshotDiff,
  baselineName: string,
  againstName: string,
): void {
  logger.note(`${baselineName} -> ${againstName}`);

  if (snapshotDiff.entries.length == 0) {
    logger.note('In sync - no differences.');

    return;
  }

  for (const snapshotStore of SNAPSHOT_STORES) {
    const storeEntries = snapshotDiff.entries.filter(function sameStore(diffEntry) {
      return diffEntry.store == snapshotStore;
    });

    if (storeEntries.length == 0) {
      continue;
    }

    logger.note(storeLabel(snapshotStore));

    for (const diffEntry of storeEntries) {
      logger.note(
        `  ${diffMarker[diffEntry.change]} ${diffEntry.app} ${diffEntry.key} - ${diffEntry.summary}`,
      );
    }
  }

  logger.gap();
  logger.note(
    `Diff: ${snapshotDiff.addedCount} added, ${snapshotDiff.changedCount} changed, ${snapshotDiff.removedCount} removed`,
  );
}

async function readComparisonSnapshot(
  command: DiffCommand,
  logger: Logger,
): Promise<Snapshot | null> {
  if (command.against == LIVE_SNAPSHOT) {
    registerBuiltinSources();
    const storeSession = await loadSnapshotStoreSession(command.app);
    const captureFromSession = captureContextFromSession(storeSession);
    const snapshotSources = listSnapshotSources();
    const liveCapture = await captureSnapshot(captureFromSession, snapshotSources, {
      name: LIVE_SNAPSHOT,
      capturedAt: currentIsoTime(),
    });

    return liveCapture.snapshot;
  }

  const savedComparison = await loadSnapshot(command.against);

  if (savedComparison == null) {
    reportMissingSnapshot(logger, command.against);

    return null;
  }

  return savedComparison;
}

export async function diffSnapshot(command: DiffCommand): Promise<void> {
  const logger = createLogger(false);
  const baselineSnapshot = await loadSnapshot(command.baseline);

  if (baselineSnapshot == null) {
    reportMissingSnapshot(logger, command.baseline);

    return;
  }

  const againstSnapshot = await readComparisonSnapshot(command, logger);

  if (againstSnapshot == null) {
    return;
  }

  const snapshotDiff = diffSnapshots(baselineSnapshot, againstSnapshot);

  if (command.json == true) {
    const serialized = JSON.stringify(snapshotDiff, null, 2);
    logger.line(serialized);

    return;
  }

  renderDiff(logger, snapshotDiff, command.baseline, command.against);
}
