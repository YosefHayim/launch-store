import { runPlanner } from './planner-testkit.ts';
import { describe, expect, it, vi } from 'vitest';
import { gameCenterPlanner } from './game-center.ts';
import { makeAscApiFake } from '../../testkit/asc-api-fake-testkit.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type { AscSurfacesApi, PlanContext } from '../../types/plan.ts';
import type { GameCenterConfig } from '../../types/store-surface.ts';
import type { ActionStatus } from '../../types/reconcile.ts';

const alpha: AppDescriptor = {
  name: 'alpha',
  dir: '/no/such/dir/alpha',
  configPath: '/no/such/dir/alpha/app.json',
  bundleId: 'com.acme.alpha',
};
/** Declaring Game Center at all is enough: the fake reports it not yet enabled, so a plan results. */
const DECLARED: Record<string, GameCenterConfig> = { 'com.acme.alpha': {} };
function makeCtx(
  api: AscSurfacesApi | null,
  gameCenter?: Record<string, GameCenterConfig>,
): PlanContext {
  const baseConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };
  let config = baseConfig;
  if (gameCenter) config = { ...baseConfig, gameCenter };
  return {
    config,
    apps: [alpha],
    resolveAscApi() {
      return Promise.resolve(api);
    },
    resolvePlayApi() {
      return Promise.resolve(null);
    },
  };
}
function describeGameCenterPlanner() {
  async function omitsItselfWhenNoAppDeclaresGameCenter() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(gameCenterPlanner, makeCtx(ascApiFake));
    expect(plan.state).toBe('omitted');
  }

  it('omits itself when no app declares Game Center', omitsItselfWhenNoAppDeclaresGameCenter);
  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(gameCenterPlanner, makeCtx(null, DECLARED));
    expect(plan.state).toBe('skipped');
    if (plan.state != 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );
  async function reportsAnAdditivePlanWhenGameCenterIsnTEnabledYet() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(gameCenterPlanner, makeCtx(ascApiFake, DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state != 'planned') return;
    if (plan.scope != 'app') return;
    expect(plan.direction).toBe('additive');
    expect(plan.apps[0]?.identifier).toBe('com.acme.alpha');
    function someA(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return /Game Center/i.test(a.description);
    }

    expect(plan.apps[0]?.actions.some(someA)).toBe(true);
  }

  it(
    "reports an additive plan when Game Center isn't enabled yet",
    reportsAnAdditivePlanWhenGameCenterIsnTEnabledYet,
  );
  async function rendersInSyncWhenGameCenterIsAlreadyEnabledAndNothingIsDeclaredUnderIt() {
    const api = makeAscApiFake({
      getGameCenterDetail: vi.fn().mockResolvedValue({ id: 'detail1' }),
    });
    const plan = await runPlanner(gameCenterPlanner, makeCtx(api, DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state != 'planned') return;
    if (plan.scope != 'app') return;
    expect(plan.apps[0]?.actions).toHaveLength(0);
  }

  it(
    'renders in sync when Game Center is already enabled and nothing is declared under it',
    rendersInSyncWhenGameCenterIsAlreadyEnabledAndNothingIsDeclaredUnderIt,
  );
  async function capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan() {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await runPlanner(gameCenterPlanner, makeCtx(api, DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state != 'planned') return;
    if (plan.scope != 'app') return;
    expect(plan.apps[0]?.error).toMatch(/No App Store Connect app record/);
  }

  it(
    'captures a missing app record as a per-app error, not a thrown plan',
    capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan,
  );
  async function isStrictlyReadOnlyNeverInvokesAWriteEndpoint() {
    const api = makeAscApiFake();
    await runPlanner(gameCenterPlanner, makeCtx(api, DECLARED));
    expect(api.createGameCenterDetail).toHaveBeenCalledTimes(0);
    expect(api.createGameCenterAchievement).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('gameCenterPlanner', describeGameCenterPlanner);
