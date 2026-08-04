import { Effect } from 'effect';
import type {
  ProbeCheckResult,
  ProbeOutcome,
  ProbeReport,
  ReadinessContext,
  ReadinessOutcome,
  ReadinessProbe,
  ReadinessProbeRequirements,
} from '../types/readiness.js';

/** Readiness exit codes, with unreadable state taking precedence over blockers. */
export const READINESS_EXIT = { ok: 0, error: 1, blocker: 2 } as const;

/** Counts that determine a readiness process exit code. */
export type ReadinessExitInputs = {
  errorCount: number;
  blockerCount: number;
};

export const readinessExitCode = ({ errorCount, blockerCount }: ReadinessExitInputs): number => {
  if (errorCount > 0) return READINESS_EXIT.error;
  if (blockerCount > 0) return READINESS_EXIT.blocker;
  return READINESS_EXIT.ok;
};

export const runProbes = (
  readinessContext: ReadinessContext,
  probes: readonly ReadinessProbe[],
): Effect.Effect<ReadinessOutcome, never, ReadinessProbeRequirements> =>
  Effect.gen(function* () {
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
          skippedCount += 1;
          break;
        case 'errored':
          errorCount += 1;
          break;
        case 'checked':
          for (const appReadiness of outcome.apps) {
            switch (appReadiness.status) {
              case 'blocker':
                blockerCount += 1;
                break;
              case 'warn':
                warnCount += 1;
                break;
              case 'ok':
                okCount += 1;
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

const formatProbeFailure = (probeFailure: unknown): string => {
  if (probeFailure instanceof Error) return probeFailure.message;
  return String(probeFailure);
};

const runProbeCheck = (
  readinessContext: ReadinessContext,
  probe: ReadinessProbe,
): ProbeCheckResult =>
  Effect.try({
    try: () => probe.check(readinessContext),
    catch: (probeFailure) => probeFailure,
  }).pipe(Effect.flatten);

const runProbe = (
  readinessContext: ReadinessContext,
  probe: ReadinessProbe,
): Effect.Effect<ProbeReport, never, ReadinessProbeRequirements> => {
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
