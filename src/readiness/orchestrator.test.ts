import { describe, expect, it } from 'vitest';
import type {
  ProbeReport,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../types/readiness.ts';
import { READINESS_EXIT, readinessExitCode, runProbes, tallyProbeReports } from './orchestrator.ts';

/** A context whose resolvers are never reached - the fake probes below don't call them. */
const readinessContext: ReadinessContext = {
  config: {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  },
  apps: [],
  resolveAscApi() {
    return Promise.resolve(null);
  },
  resolvePlayApi() {
    return Promise.resolve(null);
  },
};

function isThrowingProbe(probeCheck: ProbeResult | (() => never)): probeCheck is () => never {
  return typeof probeCheck == 'function';
}

/** Build a fake probe that returns a fixed result (or throws), so the orchestrator is tested with no network. */
function probe(id: string, fixedProbeResult: ProbeResult | (() => never)): ReadinessProbe {
  return {
    id,
    title: id,
    store: 'appstore',
    categories: ['account'],
    async check(): Promise<ProbeResult> {
      if (isThrowingProbe(fixedProbeResult)) {
        return fixedProbeResult();
      }

      return fixedProbeResult;
    },
  };
}

/** Run probe aggregation with the platform services available to production probes. */
function runProbeSet(readinessProbes: readonly ReadinessProbe[]) {
  return runProbes(readinessContext, readinessProbes);
}
function describeReadinessExitCode() {
  function returnsOk0WithNoErrorsOrBlockers() {
    expect(readinessExitCode({ errorCount: 0, blockerCount: 0 })).toBe(READINESS_EXIT.ok);
  }

  it('returns ok (0) with no errors or blockers', returnsOk0WithNoErrorsOrBlockers);
  function returnsBlocker2WhenABlockerIsPresent() {
    expect(readinessExitCode({ errorCount: 0, blockerCount: 3 })).toBe(READINESS_EXIT.blocker);
  }

  it('returns blocker (2) when a blocker is present', returnsBlocker2WhenABlockerIsPresent);
  function letsAnError1WinOverABlockerADoctorThatCouldnTReadCanTCertify() {
    expect(readinessExitCode({ errorCount: 1, blockerCount: 3 })).toBe(READINESS_EXIT.error);
  }

  it(
    "lets an error (1) win over a blocker - a doctor that couldn't read can't certify",
    letsAnError1WinOverABlockerADoctorThatCouldnTReadCanTCertify,
  );
}

describe('readinessExitCode', describeReadinessExitCode);
function describeTallyProbeReports() {
  function countsPerAppFindingsAndProbeLevelSkipErrorStates() {
    const probeReports: ProbeReport[] = [
      {
        id: 'a',
        title: 'a',
        store: 'appstore',
        outcome: {
          state: 'checked',
          apps: [
            { app: 'x', identifier: 'com.x', status: 'ok', detail: '' },
            { app: 'y', identifier: 'com.y', status: 'warn', detail: '' },
          ],
        },
      },
      {
        id: 'b',
        title: 'b',
        store: 'appstore',
        outcome: {
          state: 'checked',
          apps: [{ app: 'z', identifier: 'com.z', status: 'blocker', detail: '' }],
        },
      },
      {
        id: 'c',
        title: 'c',
        store: 'appstore',
        outcome: { state: 'skipped', reason: 'no account' },
      },
      {
        id: 'd',
        title: 'd',
        store: 'play',
        outcome: { state: 'errored', error: 'network' },
      },
    ];
    expect(tallyProbeReports(probeReports)).toEqual({
      okCount: 1,
      warnCount: 1,
      blockerCount: 1,
      errorCount: 1,
      skippedCount: 1,
    });
  }

  it(
    'counts per-app findings and probe-level skip/error states',
    countsPerAppFindingsAndProbeLevelSkipErrorStates,
  );
}

describe('tallyProbeReports', describeTallyProbeReports);

describe('runProbes', () => {
  async function talliesPerAppFindingsAndExits2OnABlocker() {
    const outcome = await runProbeSet([
      probe('a', {
        state: 'checked',
        apps: [{ app: 'x', identifier: 'com.x', status: 'ok', detail: '' }],
      }),
      probe('b', {
        state: 'checked',
        apps: [
          { app: 'y', identifier: 'com.y', status: 'warn', detail: '' },
          { app: 'z', identifier: 'com.z', status: 'blocker', detail: '' },
        ],
      }),
    ]);
    expect(outcome.okCount).toBe(1);
    expect(outcome.warnCount).toBe(1);
    expect(outcome.blockerCount).toBe(1);
    expect(outcome.exitCode).toBe(READINESS_EXIT.blocker);
  }

  it('tallies per-app findings and exits 2 on a blocker', talliesPerAppFindingsAndExits2OnABlocker);
  it('drops omitted probes from the report and counts skipped ones', async () => {
    const outcome = await runProbeSet([
      probe('omitted', { state: 'omitted' }),
      probe('skipped', { state: 'skipped', reason: 'no account' }),
    ]);
    expect(outcome.reports.map((report) => report.id)).toEqual(['skipped']);
    expect(outcome.skippedCount).toBe(1);
    expect(outcome.exitCode).toBe(READINESS_EXIT.ok);
  });
  it('isolates a thrown probe as errored (exit 1) without sinking its siblings', async () => {
    function probePiece(): never {
      throw new Error('network down');
    }

    const outcome = await runProbeSet([
      probe('ok', {
        state: 'checked',
        apps: [{ app: 'x', identifier: 'com.x', status: 'ok', detail: '' }],
      }),
      probe('boom', probePiece),
    ]);
    expect(outcome.okCount).toBe(1);
    expect(outcome.errorCount).toBe(1);
    expect(outcome.exitCode).toBe(READINESS_EXIT.error);
    const errored = outcome.reports.find((report) => report.id == 'boom');
    expect(errored?.outcome).toEqual({ state: 'errored', error: 'network down' });
  });
  async function formatsNonErrorProbeFailuresViaErrorMessage() {
    const outcome = await runProbeSet([
      {
        id: 'tagged',
        title: 'tagged',
        store: 'appstore',
        categories: ['account'],
        check() {
          return Promise.reject({ message: 'asc rate limited' });
        },
      },
    ]);
    expect(outcome.errorCount).toBe(1);
    expect(outcome.reports[0]?.outcome).toEqual({
      state: 'errored',
      error: 'asc rate limited',
    });
  }

  it(
    'formats non-Error probe failures via errorMessage',
    formatsNonErrorProbeFailuresViaErrorMessage,
  );
});
