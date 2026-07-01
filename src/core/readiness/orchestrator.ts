/**
 * The readiness engine: run every selected {@link ReadinessProbe}, stamp each probe's identity onto its
 * outcome, tally the findings, and map the result to a process exit code. UI-free, like
 * `core/plan/orchestrator.ts` — the command renders the outcome and resolves credentials; this module
 * only orchestrates and tallies, so the exit-code contract is unit-testable against fake probes with no
 * network. Probes are read-only and self-isolating (each classifies its own "not ready" conditions), so a
 * probe that throws is recorded as `errored` here rather than aborting the run.
 */

import type { ProbeReport, ReadinessContext, ReadinessOutcome, ReadinessProbe } from '../types.js';

/**
 * Exit codes, mirroring the `launch plan` / `launch status` convention (worst-wins, error first):
 * - `ok` (0) — every probe ran and found no blockers (warnings don't fail; a missing-creds skip is benign).
 * - `blocker` (2) — at least one probe found a shippability blocker.
 * - `error` (1) — at least one probe threw while reading; takes precedence over blockers, because a
 *   doctor that couldn't complete a check can't honestly certify the rest.
 */
export const READINESS_EXIT = { ok: 0, error: 1, blocker: 2 } as const;

/** What goes into the exit code — extracted as a pure function so the contract is tested directly. */
export interface ReadinessExitInputs {
  /** Probes that threw while reading. */
  errorCount: number;
  /** Per-app blocker findings. */
  blockerCount: number;
}

/** Resolve the exit code: an unreadable probe (1) wins over a found blocker (2), else in-the-clear (0). */
export function readinessExitCode({ errorCount, blockerCount }: ReadinessExitInputs): number {
  if (errorCount > 0) return READINESS_EXIT.error;
  if (blockerCount > 0) return READINESS_EXIT.blocker;
  return READINESS_EXIT.ok;
}

/**
 * Run every selected probe concurrently, aggregate the findings, and compute the exit code. Each probe
 * owns its expected "not ready" conditions (mapped to `warn`/`blocker` findings); only an unexpected
 * throw lands here, caught and recorded as an `errored` report so one flaky read never sinks the rest.
 * Omitted probes are dropped before tallying so an unconfigured store adds no noise and no exit pressure.
 */
export async function runProbes(
  ctx: ReadinessContext,
  probes: ReadinessProbe[],
): Promise<ReadinessOutcome> {
  const reports = await Promise.all(probes.map((probe) => runProbe(ctx, probe)));
  const visible = reports.filter((report) => report.outcome.state !== 'omitted');

  let okCount = 0;
  let warnCount = 0;
  let blockerCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  for (const { outcome } of visible) {
    if (outcome.state === 'skipped') skippedCount++;
    else if (outcome.state === 'errored') errorCount++;
    else if (outcome.state === 'checked') {
      for (const app of outcome.apps) {
        if (app.status === 'blocker') blockerCount++;
        else if (app.status === 'warn') warnCount++;
        else okCount++;
      }
    }
  }

  return {
    reports: visible,
    okCount,
    warnCount,
    blockerCount,
    errorCount,
    skippedCount,
    exitCode: readinessExitCode({ errorCount, blockerCount }),
  };
}

/** Run one probe, stamping its identity onto the outcome and converting an unexpected throw to `errored`. */
async function runProbe(ctx: ReadinessContext, probe: ReadinessProbe): Promise<ProbeReport> {
  const identity = { id: probe.id, title: probe.title, store: probe.store };
  try {
    return { ...identity, outcome: await probe.check(ctx) };
  } catch (error) {
    return {
      ...identity,
      outcome: { state: 'errored', error: error instanceof Error ? error.message : String(error) },
    };
  }
}
