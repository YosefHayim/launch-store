import { Effect } from 'effect';
import { runPlanner } from './planner.testkit.js';
import { describe, expect, it, vi } from 'vitest';
import { euDistributionPlanner } from './euDistribution.js';
import { makeAscApiFake } from '@testkit/ascApiFake.testkit.js';
import type { LaunchConfig } from '@core/types/config.js';
import type { AscSurfacesApi, PlanContext } from '@core/types/plan.js';
import type { EuDistributionConfig } from '@core/types/storeSurface.js';
const DECLARED: EuDistributionConfig = {
  domains: [{ domain: 'downloads.acme.com', referenceName: 'Acme Downloads' }],
};
const makeCtx = (
  api: AscSurfacesApi | null,
  euDistribution?: EuDistributionConfig,
): PlanContext => {
  const baseConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
  };
  let config = baseConfig;
  if (euDistribution) config = { ...baseConfig, euDistribution };
  return {
    config,
    apps: [],
    resolveAscApi: () => Effect.succeed(api),
    resolvePlayApi: () => Effect.succeed(null),
  };
};
describe('euDistributionPlanner', () => {
  it('omits itself when no distribution domains are declared', async () => {
    const plan = await runPlanner(euDistributionPlanner, makeCtx(makeAscApiFake()));
    expect(plan.state).toBe('omitted');
  });
  it('skips with a creds hint when no Apple account is active', async () => {
    const plan = await runPlanner(euDistributionPlanner, makeCtx(null, DECLARED));
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  });
  it('reports a team-scoped additive plan for a fresh domain', async () => {
    const plan = await runPlanner(euDistributionPlanner, makeCtx(makeAscApiFake(), DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') return;
    if (plan.scope !== 'team') return;
    expect(plan.direction).toBe('additive');
    expect(plan.actions.some((a) => a.description.includes('distribution domain'))).toBe(true);
  });
  it('renders in sync when the domain is already authorized', async () => {
    const api = makeAscApiFake({
      listAlternativeDistributionDomains: vi
        .fn()
        .mockResolvedValue([{ id: 'd1', domain: 'downloads.acme.com' }]),
    });
    const plan = await runPlanner(euDistributionPlanner, makeCtx(api, DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') return;
    if (plan.scope !== 'team') return;
    expect(plan.actions).toHaveLength(0);
  });
  it('is strictly read-only: never invokes a write endpoint', async () => {
    const api = makeAscApiFake();
    await runPlanner(euDistributionPlanner, makeCtx(api, DECLARED));
    expect(api.createAlternativeDistributionDomain).toHaveBeenCalledTimes(0);
  });
});
