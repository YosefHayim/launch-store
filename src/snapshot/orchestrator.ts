import type {
  CaptureOutcome,
  CaptureReport,
  Snapshot,
  SnapshotContext,
  SnapshotSource,
} from '../types/snapshot.ts';
import { errorMessage } from '../services/platform/errorMessage.ts';

/**
 * Exit codes for `snapshot create`, mirroring the `launch plan` convention (error-or-clean):
 * - `ok` (0) - every source captured or was benignly skipped (no credentials).
 * - `error` (1) - at least one source threw while reading, so the saved snapshot is incomplete.
 */
export const SNAPSHOT_EXIT = { ok: 0, error: 1 } as const;

/**
 * The result of a capture run: the {@link Snapshot} to persist plus the tallies that drive the summary line
 * and the exit code. `entityCount` is the headline "N item(s) captured"; `skippedCount` / `errorCount`
 * surface partial captures.
 */
export type CaptureResult = {
  snapshot: Snapshot;
  entityCount: number;
  skippedCount: number;
  errorCount: number;
  exitCode: number;
};

/** Metadata the command supplies for the record being built (the label and capture time). */
type CaptureMeta = {
  name: string;
  capturedAt: string;
};

/** On-disk schema version for a {@link Snapshot} - bump when the record shape changes incompatibly. */
export const SNAPSHOT_VERSION = 1;

/**
 * Capture every source concurrently and assemble the record. Each source owns its expected empty/skip
 * conditions; only an unexpected throw lands here, caught and recorded as an `errored` report so one flaky
 * read never sinks the rest. Omitted sources are dropped before persisting so an unconfigured store adds no
 * noise to the record.
 */
export async function captureSnapshot(
  snapshotContext: SnapshotContext,
  sources: readonly SnapshotSource[],
  meta: CaptureMeta,
): Promise<CaptureResult> {
  const reports = await Promise.all(
    sources.map(function captureOne(source) {
      return captureSource(snapshotContext, source);
    }),
  );
  const visible = reports.filter(function isVisible(report) {
    return report.outcome.state != 'omitted';
  });
  let entityCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const report of visible) {
    const tallies = tallyOutcome(report.outcome);
    entityCount += tallies.entityCount;
    skippedCount += tallies.skippedCount;
    errorCount += tallies.errorCount;
  }

  let exitCode: number = SNAPSHOT_EXIT.ok;

  if (errorCount > 0) {
    exitCode = SNAPSHOT_EXIT.error;
  }

  return {
    snapshot: {
      version: SNAPSHOT_VERSION,
      name: meta.name,
      capturedAt: meta.capturedAt,
      reports: visible,
    },
    entityCount,
    skippedCount,
    errorCount,
    exitCode,
  };
}

function tallyOutcome(outcome: CaptureOutcome): {
  entityCount: number;
  skippedCount: number;
  errorCount: number;
} {
  if (outcome.state == 'skipped') {
    return { entityCount: 0, skippedCount: 1, errorCount: 0 };
  }

  if (outcome.state == 'errored') {
    return { entityCount: 0, skippedCount: 0, errorCount: 1 };
  }

  if (outcome.state != 'captured') {
    return { entityCount: 0, skippedCount: 0, errorCount: 0 };
  }

  return {
    entityCount: countEntities(outcome.apps),
    skippedCount: skippedAppCount(outcome.skippedApps),
    errorCount: 0,
  };
}

function countEntities(apps: readonly { entities: readonly unknown[] }[]): number {
  let entityCount = 0;

  for (const app of apps) {
    entityCount += app.entities.length;
  }

  return entityCount;
}

function skippedAppCount(skippedApps: readonly unknown[] | undefined): number {
  if (skippedApps == null) {
    return 0;
  }

  return skippedApps.length;
}

async function captureSource(
  snapshotContext: SnapshotContext,
  source: SnapshotSource,
): Promise<CaptureReport> {
  const identity = { id: source.id, title: source.title, store: source.store };

  try {
    const captureOutcome = await source.capture(snapshotContext);

    return { ...identity, outcome: captureOutcome };
  } catch (captureFailure) {
    return {
      ...identity,
      outcome: {
        state: 'errored',
        error: errorMessage(captureFailure),
      },
    };
  }
}
