import { runPlanner } from './planner-testkit.ts';
import { describe, expect, it, vi } from 'vitest';
import { euDistributionPlanner } from './eu-distribution.ts';
import { makeAscApiFake } from '@/testkit/asc-api-fake-testkit.js';
import type { LaunchConfig } from '@/types/config.js';
import type { AscSurfacesApi, PlanContext } from '@/types/plan.js';
import type { EuDistributionConfig } from '@/types/store-surface.js';
import type { ActionStatus } from '@/types/reconcile.js';

const DECLARED: EuDistributionConfig = {
  domains: [{ domain: 'downloads.acme.com', referenceName: 'Acme Downloads' }],
};

function makeCtx(api: AscSurfacesApi | null, euDistribution?: EuDistributionConfig): PlanContext {
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
    resolveAscApi() {
      return Promise.resolve(api);
    },
    resolvePlayApi() {
      return Promise.resolve(null);
    },
  };
}

function describeEuDistributionPlanner() {
  async function omitsItselfWhenNoDistributionDomainsAreDeclared() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(euDistributionPlanner, makeCtx(ascApiFake));
    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no distribution domains are declared',
    omitsItselfWhenNoDistributionDomainsAreDeclared,
  );

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(euDistributionPlanner, makeCtx(null, DECLARED));

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );

  async function reportsATeamScopedAdditivePlanForAFreshDomain() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(euDistributionPlanner, makeCtx(ascApiFake, DECLARED));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'team') return;

    expect(plan.direction).toBe('additive');

    function isDistributionDomain(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return plannedAction.description.includes('distribution domain');
    }

    expect(plan.actions.some(isDistributionDomain)).toBe(true);
  }

  it(
    'reports a team-scoped additive plan for a fresh domain',
    reportsATeamScopedAdditivePlanForAFreshDomain,
  );

  async function rendersInSyncWhenTheDomainIsAlreadyAuthorized() {
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
  }

  it(
    'renders in sync when the domain is already authorized',
    rendersInSyncWhenTheDomainIsAlreadyAuthorized,
  );

  async function isStrictlyReadOnlyNeverInvokesAWriteEndpoint() {
    const api = makeAscApiFake();
    await runPlanner(euDistributionPlanner, makeCtx(api, DECLARED));
    expect(api.createAlternativeDistributionDomain).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('euDistributionPlanner', describeEuDistributionPlanner);
