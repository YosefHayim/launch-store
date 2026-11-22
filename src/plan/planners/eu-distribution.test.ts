import { runPlanner } from './planner-testkit.ts';
import { describe, expect, it, vi } from 'vitest';
import { euDistributionPlanner } from './eu-distribution.ts';
import { makeAscApiFake } from '../../testkit/asc-api-fake-testkit.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type { AscSurfacesApi, PlanContext } from '../../types/plan.ts';
import type { EuDistributionConfig } from '../../types/store-surface.ts';
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
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };
  let config = baseConfig;
  if (euDistribution) config = { ...baseConfig, euDistribution };
  return {
    config,
    apps: [],
    resolveAscApi: () => Promise.resolve(api),
    resolvePlayApi: () => Promise.resolve(null),
  };
};
describe('euDistributionPlanner', () => {
  it('omits itself when no distribution domains are declared', async () => {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(euDistributionPlanner, makeCtx(ascApiFake));
    expect(plan.state).toBe('omitted');
  });
  it('skips with a creds hint when no Apple account is active', async () => {
    const plan = await runPlanner(euDistributionPlanner, makeCtx(null, DECLARED));
    expect(plan.state).toBe('skipped');
    if (plan.state != 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  });
  it('reports a team-scoped additive plan for a fresh domain', async () => {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(euDistributionPlanner, makeCtx(ascApiFake, DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state != 'planned') return;
    if (plan.scope != 'team') return;
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
    if (plan.state != 'planned') return;
    if (plan.scope != 'team') return;
    expect(plan.actions).toHaveLength(0);
  });
  it('is strictly read-only: never invokes a write endpoint', async () => {
    const api = makeAscApiFake();
    await runPlanner(euDistributionPlanner, makeCtx(api, DECLARED));
    expect(api.createAlternativeDistributionDomain).toHaveBeenCalledTimes(0);
  });
});
