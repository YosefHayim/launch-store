import { Effect } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import type {
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
export type ReadinessExitInputs = Readonly<{
  errorCount: number;
  blockerCount: number;
}>;

/** Per-status tallies over visible probe reports (omitted probes already dropped). */
export type ProbeReportTallies = Readonly<{
  okCount: number;
  warnCount: number;
  blockerCount: number;
  errorCount: number;
  skippedCount: number;
}>;

export const readinessExitCode = ({ errorCount, blockerCount }: ReadinessExitInputs): number => {
  if (errorCount > 0) return READINESS_EXIT.error;
  if (blockerCount > 0) return READINESS_EXIT.blocker;
  return READINESS_EXIT.ok;
};

/** Count findings across visible probe reports for the summary line and exit code. */
export const tallyProbeReports = (probeReports: readonly ProbeReport[]): ProbeReportTallies => {
  let okCount = 0;
  let warnCount = 0;
  let blockerCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  for (const { outcome } of probeReports) {
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
  return { okCount, warnCount, blockerCount, errorCount, skippedCount };
};

/** Run probes concurrently, drop omitted reports, and compute the readiness outcome. */
export const runProbes = (
  readinessContext: ReadinessContext,
  probes: readonly ReadinessProbe[],
): Effect.Effect<ReadinessOutcome, never, ReadinessProbeRequirements> =>
  Effect.gen(function* () {
    const reports = yield* Effect.forEach(probes, (probe) => runProbe(readinessContext, probe), {
      concurrency: 'unbounded',
    });
    const visibleReports = reports.filter((report) => report.outcome.state !== 'omitted');
    const tallies = tallyProbeReports(visibleReports);
    return {
      reports: visibleReports,
      ...tallies,
      exitCode: readinessExitCode({
        errorCount: tallies.errorCount,
        blockerCount: tallies.blockerCount,
      }),
    };
  });

/** Run one probe, stamp identity onto the outcome, and convert unexpected failure to `errored`. */
const runProbe = (
  readinessContext: ReadinessContext,
  probe: ReadinessProbe,
): Effect.Effect<ProbeReport, never, ReadinessProbeRequirements> => {
  const identity = { id: probe.id, title: probe.title, store: probe.store };
  return Effect.try({
    try: () => probe.check(readinessContext),
    catch: (probeFailure) => probeFailure,
  }).pipe(
    Effect.flatten,
    Effect.match({
      onSuccess: (outcome): ProbeReport => ({ ...identity, outcome }),
      onFailure: (probeFailure): ProbeReport => ({
        ...identity,
        outcome: {
          state: 'errored',
          error: errorMessage(probeFailure),
        } satisfies ProbeOutcome,
      }),
    }),
  );
};
