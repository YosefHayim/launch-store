/**
 * The `launch snapshot create` engine: run every registered {@link SnapshotSource} against the live
 * read-only clients, stamp each source's identity onto its outcome, and assemble the persisted
 * {@link Snapshot} record. UI-free, like `core/plan/orchestrator.ts` — the command renders the result,
 * resolves credentials, and persists; this module only orchestrates and tallies, so the contract is
 * unit-testable against fake sources with no network. Sources are read-only and self-isolating, so one that
 * throws is recorded as `errored` here rather than aborting the capture.
 */

import type { CaptureReport, Snapshot, SnapshotContext, SnapshotSource } from './types.js';

/**
 * Exit codes for `snapshot create`, mirroring the `launch plan` convention (error-or-clean):
 * - `ok` (0) — every source captured or was benignly skipped (no credentials).
 * - `error` (1) — at least one source threw while reading, so the saved snapshot is incomplete.
 */
export const SNAPSHOT_EXIT = { ok: 0, error: 1 } as const;

/**
 * The result of a capture run: the {@link Snapshot} to persist plus the tallies that drive the summary line
 * and the exit code. `entityCount` is the headline "N item(s) captured"; `skippedCount` / `errorCount`
 * surface partial captures.
 */
export interface CaptureResult {
  /** The record to save (and to serialize under `--json`). */
  snapshot: Snapshot;
  /** Total captured items across every source — the headline count. */
  entityCount: number;
  /** Sources skipped because their store's credentials aren't configured. */
  skippedCount: number;
  /** Sources that threw while reading (the snapshot is incomplete by that many surfaces). */
  errorCount: number;
  /** The resolved process exit code per the {@link SNAPSHOT_EXIT} contract. */
  exitCode: number;
}

/** Metadata the command supplies for the record being built (the label and capture time). */
export interface CaptureMeta {
  /** The snapshot's name / file basename. */
  name: string;
  /** ISO-8601 capture timestamp (the command stamps it so this stays deterministic in tests). */
  capturedAt: string;
}

/** On-disk schema version for a {@link Snapshot} — bump when the record shape changes incompatibly. */
export const SNAPSHOT_VERSION = 1;

/**
 * Capture every source concurrently and assemble the record. Each source owns its expected empty/skip
 * conditions; only an unexpected throw lands here, caught and recorded as an `errored` report so one flaky
 * read never sinks the rest. Omitted sources are dropped before persisting so an unconfigured store adds no
 * noise to the record.
 */
export async function captureSnapshot(
  ctx: SnapshotContext,
  sources: SnapshotSource[],
  meta: CaptureMeta,
): Promise<CaptureResult> {
  const reports = await Promise.all(sources.map((source) => captureSource(ctx, source)));
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
    exitCode: errorCount > 0 ? SNAPSHOT_EXIT.error : SNAPSHOT_EXIT.ok,
  };
}

/** Capture one source, stamping its identity onto the outcome and converting an unexpected throw to `errored`. */
async function captureSource(ctx: SnapshotContext, source: SnapshotSource): Promise<CaptureReport> {
  const identity = { id: source.id, title: source.title, store: source.store };
  try {
    return { ...identity, outcome: await source.capture(ctx) };
  } catch (error) {
    return {
      ...identity,
      outcome: { state: 'errored', error: error instanceof Error ? error.message : String(error) },
    };
  }
}
