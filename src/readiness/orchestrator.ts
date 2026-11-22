import { errorMessage } from '../services/platform/error-message.ts';
import type {
  ProbeOutcome,
  ProbeReport,
  ReadinessContext,
  ReadinessOutcome,
  ReadinessProbe,
} from '../types/readiness.ts';

/** Readiness exit codes, with unreadable state taking precedence over blockers. */
export const READINESS_EXIT = { ok: 0, error: 1, blocker: 2 } as const;

/** Counts that determine a readiness process exit code. */
type ReadinessExitInputs = Readonly<{
  errorCount: number;
  blockerCount: number;
}>;

/** Per-status tallies over visible probe reports (omitted probes already dropped). */
type ProbeReportTallies = Readonly<{
  okCount: number;
  warnCount: number;
  blockerCount: number;
  errorCount: number;
  skippedCount: number;
}>;

export function readinessExitCode({ errorCount, blockerCount }: ReadinessExitInputs): number {
  const hasUnreadableProbe = errorCount > 0;

  if (hasUnreadableProbe) {
    return READINESS_EXIT.error;
  }

  const hasBlocker = blockerCount > 0;

  if (hasBlocker) {
    return READINESS_EXIT.blocker;
  }

  return READINESS_EXIT.ok;
}

/** Count findings across visible probe reports for the summary line and exit code. */
export function tallyProbeReports(probeReports: readonly ProbeReport[]): ProbeReportTallies {
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
}

/** Run one probe, stamp identity onto the outcome, and convert unexpected failure to `errored`. */
async function runProbe(
  readinessContext: ReadinessContext,
  probe: ReadinessProbe,
): Promise<ProbeReport> {
  const identity = { id: probe.id, title: probe.title, store: probe.store };

  try {
    const outcome = await probe.check(readinessContext);

    return { ...identity, outcome };
  } catch (probeFailure) {
    const errored: ProbeOutcome = {
      state: 'errored',
      error: errorMessage(probeFailure),
    };

    return { ...identity, outcome: errored };
  }
}

function isVisibleReport(report: ProbeReport): boolean {
  return report.outcome.state != 'omitted';
}

/** Run probes concurrently, drop omitted reports, and compute the readiness outcome. */
export async function runProbes(
  readinessContext: ReadinessContext,
  probes: readonly ReadinessProbe[],
): Promise<ReadinessOutcome> {
  function startProbe(probe: ReadinessProbe): Promise<ProbeReport> {
    return runProbe(readinessContext, probe);
  }

  const probeRuns = probes.map(startProbe);
  const reports = await Promise.all(probeRuns);
  const visibleReports = reports.filter(isVisibleReport);
  const tallies = tallyProbeReports(visibleReports);

  return {
    reports: visibleReports,
    ...tallies,
    exitCode: readinessExitCode({
      errorCount: tallies.errorCount,
      blockerCount: tallies.blockerCount,
    }),
  };
}
