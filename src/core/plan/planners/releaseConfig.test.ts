import { describe, expect, it, vi } from 'vitest';
import { releaseConfigPlanner } from './releaseConfig.js';
import { makeAscApiFake } from '../../../testkit/ascApiFake.testkit.js';
import type { AscSurfacesApi, PlanContext } from '../types.js';
import type { AppDescriptor, LaunchConfig, ReleaseAttributesConfig } from '../../types.js';

const ALPHA: AppDescriptor = {
  name: 'alpha',
  dir: '/no/such/dir/alpha',
  configPath: '/no/such/dir/alpha/app.json',
  bundleId: 'com.acme.alpha',
};

/** A config declaring a base price — with the fake's "no current price" default, this plans one change. */
const PRICED: Record<string, ReleaseAttributesConfig> = {
  'com.acme.alpha': { pricing: { customerPrice: 9.99 } },
};

function makeCtx(
  api: AscSurfacesApi | null,
  releaseAttributes?: Record<string, ReleaseAttributesConfig>,
): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    ...(releaseAttributes ? { releaseAttributes } : {}),
  };
  return {
    config,
    apps: [ALPHA],
    resolveAscApi: () => Promise.resolve(api),
    resolvePlayApi: () => Promise.resolve(null),
  };
}

describe('releaseConfigPlanner', () => {
  it('omits itself when no app declares release attributes', async () => {
    const plan = await releaseConfigPlanner.plan(makeCtx(makeAscApiFake()));
    expect(plan.state).toBe('omitted');
  });

  it('skips with a creds hint when no Apple account is active', async () => {
    const plan = await releaseConfigPlanner.plan(makeCtx(null, PRICED));
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  });

  it('reports the per-app price change a fresh config would apply (two-way)', async () => {
    const plan = await releaseConfigPlanner.plan(makeCtx(makeAscApiFake(), PRICED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.direction).toBe('two-way');
    expect(plan.apps[0]?.identifier).toBe('com.acme.alpha');
    expect(plan.apps[0]?.actions.some((a) => a.description.includes('set app price'))).toBe(true);
  });

  it('renders in sync when the live price already matches', async () => {
    const api = makeAscApiFake({ getCurrentAppPrice: vi.fn().mockResolvedValue('9.99') });
    const plan = await releaseConfigPlanner.plan(makeCtx(api, PRICED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.apps[0]?.actions).toHaveLength(0);
  });

  it('captures a missing app record as a per-app error, not a thrown plan', async () => {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await releaseConfigPlanner.plan(makeCtx(api, PRICED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.apps[0]?.error).toMatch(/No App Store Connect app record/);
  });

  it('is strictly read-only: never invokes a write endpoint', async () => {
    const api = makeAscApiFake();
    await releaseConfigPlanner.plan(makeCtx(api, PRICED));
    expect(api.createAppPriceSchedule).toHaveBeenCalledTimes(0);
    expect(api.updateAppInfoCategories).toHaveBeenCalledTimes(0);
  });
});
