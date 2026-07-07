/**
 * The readiness engine: run every selected {@link ReadinessProbe}, stamp each probe's identity onto its
 * outcome, tally the findings, and map the result to a process exit code. UI-free, like
 * `core/plan/orchestrator.ts` — the command renders the outcome and resolves credentials; this module
 * only orchestrates and tallies, so the exit-code contract is unit-testable against fake probes with no
 * network. Probes are read-only and self-isolating (each classifies its own "not ready" conditions), so a
 * probe that throws is recorded as `errored` here rather than aborting the run.
 */

import { Effect } from 'effect';
import type {
  ProbeCheckResult,
  ProbeOutcome,
  ProbeReport,
  ProbeResult,
  ReadinessContext,
  ReadinessOutcome,
  ReadinessProbe,
} from '../types/index.js';

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

/**
 * Resolve the exit code for aggregate readiness counts.
 *
 * @param inputs - Error and blocker counts from a readiness run.
 * @returns The process exit code: unreadable probe (1), blocker (2), or ok (0).
 */
export function readinessExitCode({ errorCount, blockerCount }: ReadinessExitInputs): number {
  if (errorCount > 0) return READINESS_EXIT.error;
  if (blockerCount > 0) return READINESS_EXIT.blocker;
  return READINESS_EXIT.ok;
}

/**
 * Run every selected probe concurrently, aggregate findings, and compute the exit code.
 *
 * Each probe owns its expected "not ready" conditions (mapped to `warn`/`blocker` findings); only an
 * unexpected read failure lands here, recorded as an `errored` report so one flaky read never sinks the rest.
 * Omitted probes are dropped before tallying so an unconfigured store adds no noise and no exit pressure.
 *
 * @param readinessContext - Loaded config, selected apps, and lazy store-client resolvers.
 * @param probes - Probe implementations selected by the calling command or tool.
 * @returns An Effect that succeeds with the aggregate readiness outcome.
 */
export function runProbes(
  readinessContext: ReadinessContext,
  probes: ReadinessProbe[],
): Effect.Effect<ReadinessOutcome> {
  return Effect.gen(function* () {
    const reports = yield* Effect.forEach(probes, (probe) => runProbe(readinessContext, probe), {
      concurrency: 'unbounded',
    });
    const visibleReports = reports.filter((report) => report.outcome.state !== 'omitted');

    let okCount = 0;
    let warnCount = 0;
    let blockerCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    for (const { outcome } of visibleReports) {
      switch (outcome.state) {
        case 'skipped':
          skippedCount++;
          break;
        case 'errored':
          errorCount++;
          break;
        case 'checked':
          for (const appReadiness of outcome.apps) {
            switch (appReadiness.status) {
              case 'blocker':
                blockerCount++;
                break;
              case 'warn':
                warnCount++;
                break;
              case 'ok':
                okCount++;
                break;
            }
          }
          break;
        case 'omitted':
          break;
      }
    }

    return {
      reports: visibleReports,
      okCount,
      warnCount,
      blockerCount,
      errorCount,
      skippedCount,
      exitCode: readinessExitCode({ errorCount, blockerCount }),
    };
  });
}

/**
 * Render an unknown probe failure as one reportable error string.
 *
 * @param probeFailure - Unknown failure value from a probe check.
 * @returns The Error message when available, otherwise the stringified failure.
 */
const formatProbeFailure = (probeFailure: unknown): string => {
  if (probeFailure instanceof Error) return probeFailure.message;
  return String(probeFailure);
};

/**
 * Normalize a probe check return value into an Effect.
 *
 * @param checkResult - Result returned by a readiness probe's `check` method.
 * @returns An Effect that succeeds with the probe result or fails with the probe failure.
 */
const normalizeProbeCheck = (
  checkResult: ProbeCheckResult,
): Effect.Effect<ProbeResult, unknown> => {
  if (Effect.isEffect(checkResult)) return checkResult;
  if (checkResult instanceof Promise) {
    return Effect.tryPromise({
      try: () => checkResult,
      catch: (probeFailure) => probeFailure,
    });
  }
  return Effect.succeed(checkResult);
};

/**
 * Invoke a probe check and capture synchronous failures before normalization.
 *
 * @param readinessContext - Loaded config, selected apps, and lazy store-client resolvers.
 * @param probe - Probe implementation to invoke.
 * @returns An Effect that represents the probe's own check result.
 */
const runProbeCheck = (
  readinessContext: ReadinessContext,
  probe: ReadinessProbe,
): Effect.Effect<ProbeResult, unknown> =>
  Effect.try({
    try: () => probe.check(readinessContext),
    catch: (probeFailure) => probeFailure,
  }).pipe(Effect.flatMap(normalizeProbeCheck));

/**
 * Run one probe and stamp its identity onto the outcome.
 *
 * @param readinessContext - Loaded config, selected apps, and lazy store-client resolvers.
 * @param probe - Probe implementation to execute.
 * @returns An Effect that always succeeds with a probe report; unexpected probe failures become `errored`.
 */
const runProbe = (
  readinessContext: ReadinessContext,
  probe: ReadinessProbe,
): Effect.Effect<ProbeReport> => {
  const identity = { id: probe.id, title: probe.title, store: probe.store };
  return runProbeCheck(readinessContext, probe).pipe(
    Effect.map((outcome): ProbeReport => ({ ...identity, outcome })),
    Effect.catchAll((probeFailure) =>
      Effect.succeed({
        ...identity,
        outcome: {
          state: 'errored',
          error: formatProbeFailure(probeFailure),
        } satisfies ProbeOutcome,
      }),
    ),
  );
};
