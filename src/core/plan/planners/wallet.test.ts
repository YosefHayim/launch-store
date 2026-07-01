import { describe, expect, it, vi } from 'vitest';
import { walletPlanner } from './wallet.js';
import { makeAscApiFake } from '../../../testkit/ascApiFake.testkit.js';
import type { AscSurfacesApi, PlanContext } from '../types.js';
import type { LaunchConfig, WalletConfig } from '../../types.js';

const DECLARED: WalletConfig = {
  merchantIds: [{ identifier: 'merchant.com.acme.app', name: 'Acme Pay' }],
};

function makeCtx(api: AscSurfacesApi | null, wallet?: WalletConfig): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    ...(wallet ? { wallet } : {}),
  };
  return {
    config,
    apps: [],
    resolveAscApi: () => Promise.resolve(api),
    resolvePlayApi: () => Promise.resolve(null),
  };
}

describe('walletPlanner', () => {
  it('omits itself when no wallet ids are declared', async () => {
    const plan = await walletPlanner.plan(makeCtx(makeAscApiFake()));
    expect(plan.state).toBe('omitted');
  });

  it('skips with a creds hint when no Apple account is active', async () => {
    const plan = await walletPlanner.plan(makeCtx(null, DECLARED));
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  });

  it('reports a team-scoped additive plan for a fresh merchant id', async () => {
    const plan = await walletPlanner.plan(makeCtx(makeAscApiFake(), DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'team') return;
    expect(plan.direction).toBe('additive');
    expect(plan.actions.some((a) => a.description.includes('merchant id'))).toBe(true);
  });

  it('renders in sync when the merchant id already exists', async () => {
    const api = makeAscApiFake({
      listMerchantIds: vi
        .fn()
        .mockResolvedValue([{ id: 'm1', identifier: 'merchant.com.acme.app' }]),
    });
    const plan = await walletPlanner.plan(makeCtx(api, DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'team') return;
    expect(plan.actions).toHaveLength(0);
  });

  it('is strictly read-only: never invokes a write endpoint', async () => {
    const api = makeAscApiFake();
    await walletPlanner.plan(makeCtx(api, DECLARED));
    expect(api.createMerchantId).toHaveBeenCalledTimes(0);
    expect(api.createPassTypeId).toHaveBeenCalledTimes(0);
  });
});
