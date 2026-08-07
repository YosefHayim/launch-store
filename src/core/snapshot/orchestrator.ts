import type {
  CaptureReport,
  Snapshot,
  SnapshotContext,
  SnapshotSource,
} from '../types/snapshot.js';
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
export type CaptureMeta = {
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
export const captureSnapshot = (
  snapshotContext: SnapshotContext,
  sources: readonly SnapshotSource[],
  meta: CaptureMeta,
): Effect.Effect<CaptureResult> =>
  Effect.gen(function* () {
    const reports = yield* Effect.forEach(
      sources,
      (source) => captureSource(snapshotContext, source),
      {
        concurrency: 'unbounded',
      },
    );
    const visible = reports.filter((report) => report.outcome.state !== 'omitted');
    let entityCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    for (const { outcome } of visible) {
      if (outcome.state === 'skipped') skippedCount++;
      else if (outcome.state === 'errored') errorCount++;
      else if (outcome.state === 'captured') {
        for (const app of outcome.apps) entityCount += app.entities.length;
      }
    }
    let exitCode: number = SNAPSHOT_EXIT.ok;
    if (errorCount > 0) exitCode = SNAPSHOT_EXIT.error;
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
  });
/** Capture one source, stamping its identity onto the outcome and converting an unexpected throw to `errored`. */
const captureSource = (
  snapshotContext: SnapshotContext,
  source: SnapshotSource,
): Effect.Effect<CaptureReport> => {
  const identity = { id: source.id, title: source.title, store: source.store };
  return source.capture(snapshotContext).pipe(
    Effect.match({
      onSuccess: (captureOutcome) => ({ ...identity, outcome: captureOutcome }),
      onFailure: (captureFailure) => ({
        ...identity,
        outcome: {
          state: 'errored' as const,
          error: errorMessage(captureFailure),
        },
      }),
    }),
  );
};
import { Effect } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
