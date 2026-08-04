import { Effect } from 'effect';
import { runPlanner } from './planner.testkit.js';
import { describe, expect, it, vi } from 'vitest';
import { walletPlanner } from './wallet.js';
import { makeAscApiFake } from '@testkit/ascApiFake.testkit.js';
import type { LaunchConfig } from '@core/types/config.js';
import type { AscSurfacesApi, PlanContext } from '@core/types/plan.js';
import type { WalletConfig } from '@core/types/storeSurface.js';
const DECLARED: WalletConfig = {
  merchantIds: [{ identifier: 'merchant.com.acme.app', name: 'Acme Pay' }],
};
const makeCtx = (api: AscSurfacesApi | null, wallet?: WalletConfig): PlanContext => {
  const baseConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
  };
  let config = baseConfig;
  if (wallet) config = { ...baseConfig, wallet };
  return {
    config,
    apps: [],
    resolveAscApi: () => Effect.succeed(api),
    resolvePlayApi: () => Effect.succeed(null),
  };
};
describe('walletPlanner', () => {
  it('omits itself when no wallet ids are declared', async () => {
    const plan = await runPlanner(walletPlanner, makeCtx(makeAscApiFake()));
    expect(plan.state).toBe('omitted');
  });
  it('skips with a creds hint when no Apple account is active', async () => {
    const plan = await runPlanner(walletPlanner, makeCtx(null, DECLARED));
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  });
  it('reports a team-scoped additive plan for a fresh merchant id', async () => {
    const plan = await runPlanner(walletPlanner, makeCtx(makeAscApiFake(), DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') return;
    if (plan.scope !== 'team') return;
    expect(plan.direction).toBe('additive');
    expect(plan.actions.some((a) => a.description.includes('merchant id'))).toBe(true);
  });
  it('renders in sync when the merchant id already exists', async () => {
    const api = makeAscApiFake({
      listMerchantIds: vi
        .fn()
        .mockResolvedValue([{ id: 'm1', identifier: 'merchant.com.acme.app' }]),
    });
    const plan = await runPlanner(walletPlanner, makeCtx(api, DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') return;
    if (plan.scope !== 'team') return;
    expect(plan.actions).toHaveLength(0);
  });
  it('is strictly read-only: never invokes a write endpoint', async () => {
    const api = makeAscApiFake();
    await runPlanner(walletPlanner, makeCtx(api, DECLARED));
    expect(api.createMerchantId).toHaveBeenCalledTimes(0);
    expect(api.createPassTypeId).toHaveBeenCalledTimes(0);
  });
});
