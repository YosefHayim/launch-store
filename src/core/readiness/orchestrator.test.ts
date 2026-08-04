import { NodeContext, NodeHttpClient } from '@effect/platform-node';
import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { READINESS_EXIT, readinessExitCode, runProbes } from './orchestrator.js';
import type { ProbeResult, ReadinessContext, ReadinessProbe } from '../types/readiness.js';
/** A context whose resolvers are never reached - the fake probes below don't call them. */
const readinessContext: ReadinessContext = {
  config: {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
  },
  apps: [],
  resolveAscApi: () => Effect.succeed(null),
  resolvePlayApi: () => Effect.succeed(null),
};
/** Build a fake probe that returns a fixed result (or throws), so the orchestrator is tested with no network. */
const probe = (id: string, fixedProbeResult: ProbeResult | (() => never)): ReadinessProbe => {
  return {
    id,
    title: id,
    store: 'appstore',
    categories: ['account'],
    check: () =>
      Effect.try({
        try: () => {
          if (typeof fixedProbeResult === 'function') return fixedProbeResult();
          return fixedProbeResult;
        },
        catch: (probeFailure) => probeFailure,
      }),
  };
};

/** Run probe aggregation with the platform services available to production probes. */
const runProbeSet = (readinessProbes: ReadinessProbe[]) =>
  Effect.runPromise(
    runProbes(readinessContext, readinessProbes).pipe(
      Effect.provide(NodeHttpClient.layer),
      Effect.provide(NodeContext.layer),
    ),
  );

describe('readinessExitCode', () => {
  it('returns ok (0) with no errors or blockers', () => {
    expect(readinessExitCode({ errorCount: 0, blockerCount: 0 })).toBe(READINESS_EXIT.ok);
  });
  it('returns blocker (2) when a blocker is present', () => {
    expect(readinessExitCode({ errorCount: 0, blockerCount: 3 })).toBe(READINESS_EXIT.blocker);
  });
  it("lets an error (1) win over a blocker - a doctor that couldn't read can't certify", () => {
    expect(readinessExitCode({ errorCount: 1, blockerCount: 3 })).toBe(READINESS_EXIT.error);
  });
});
describe('runProbes', () => {
  it('tallies per-app findings and exits 2 on a blocker', async () => {
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
  });
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
    const outcome = await runProbeSet([
      probe('ok', {
        state: 'checked',
        apps: [{ app: 'x', identifier: 'com.x', status: 'ok', detail: '' }],
      }),
      probe('boom', () => {
        throw new Error('network down');
      }),
    ]);
    expect(outcome.okCount).toBe(1);
    expect(outcome.errorCount).toBe(1);
    expect(outcome.exitCode).toBe(READINESS_EXIT.error);
    const errored = outcome.reports.find((report) => report.id === 'boom');
    expect(errored?.outcome).toEqual({ state: 'errored', error: 'network down' });
  });
});
