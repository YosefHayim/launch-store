import { runPlanner } from './planner-testkit.ts';
import { describe, expect, it, vi } from 'vitest';
import { walletPlanner } from './wallet.ts';
import { makeAscApiFake } from '@/testkit/asc-api-fake-testkit.js';
import type { LaunchConfig } from '@/types/config.js';
import type { AscSurfacesApi, PlanContext } from '@/types/plan.js';
import type { WalletConfig } from '@/types/store-surface.js';
import type { ActionStatus } from '@/types/reconcile.js';

const DECLARED: WalletConfig = {
  merchantIds: [{ identifier: 'merchant.com.acme.app', name: 'Acme Pay' }],
};
function makeCtx(api: AscSurfacesApi | null, wallet?: WalletConfig): PlanContext {
  const baseConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };
  let config = baseConfig;

  if (wallet) config = { ...baseConfig, wallet };

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
function describeWalletPlanner() {
  async function omitsItselfWhenNoWalletIdsAreDeclared() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(walletPlanner, makeCtx(ascApiFake));
    expect(plan.state).toBe('omitted');
  }

  it('omits itself when no wallet ids are declared', omitsItselfWhenNoWalletIdsAreDeclared);

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(walletPlanner, makeCtx(null, DECLARED));

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );

  async function reportsATeamScopedAdditivePlanForAFreshMerchantId() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(walletPlanner, makeCtx(ascApiFake, DECLARED));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'team') return;

    expect(plan.direction).toBe('additive');

    function someA(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.description.includes('merchant id');
    }

    expect(plan.actions.some(someA)).toBe(true);
  }

  it(
    'reports a team-scoped additive plan for a fresh merchant id',
    reportsATeamScopedAdditivePlanForAFreshMerchantId,
  );

  async function rendersInSyncWhenTheMerchantIdAlreadyExists() {
    const api = makeAscApiFake({
      listMerchantIds: vi
        .fn()
        .mockResolvedValue([{ id: 'm1', identifier: 'merchant.com.acme.app' }]),
    });
    const plan = await runPlanner(walletPlanner, makeCtx(api, DECLARED));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'team') return;

    expect(plan.actions).toHaveLength(0);
  }

  it(
    'renders in sync when the merchant id already exists',
    rendersInSyncWhenTheMerchantIdAlreadyExists,
  );

  async function isStrictlyReadOnlyNeverInvokesAWriteEndpoint() {
    const api = makeAscApiFake();
    await runPlanner(walletPlanner, makeCtx(api, DECLARED));
    expect(api.createMerchantId).toHaveBeenCalledTimes(0);
    expect(api.createPassTypeId).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('walletPlanner', describeWalletPlanner);
