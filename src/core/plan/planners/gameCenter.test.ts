import { Effect } from 'effect';
import { runPlanner } from './planner.testkit.js';
import { describe, expect, it, vi } from 'vitest';
import { gameCenterPlanner } from './gameCenter.js';
import { makeAscApiFake } from '@testkit/ascApiFake.testkit.js';
import type { AppDescriptor } from '@core/types/app.js';
import type { LaunchConfig } from '@core/types/config.js';
import type { AscSurfacesApi, PlanContext } from '@core/types/plan.js';
import type { GameCenterConfig } from '@core/types/storeSurface.js';
const ALPHA: AppDescriptor = {
  name: 'alpha',
  dir: '/no/such/dir/alpha',
  configPath: '/no/such/dir/alpha/app.json',
  bundleId: 'com.acme.alpha',
};
/** Declaring Game Center at all is enough: the fake reports it not yet enabled, so a plan results. */
const DECLARED: Record<string, GameCenterConfig> = { 'com.acme.alpha': {} };
const makeCtx = (
  api: AscSurfacesApi | null,
  gameCenter?: Record<string, GameCenterConfig>,
): PlanContext => {
  const baseConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
  };
  let config = baseConfig;
  if (gameCenter) config = { ...baseConfig, gameCenter };
  return {
    config,
    apps: [ALPHA],
    resolveAscApi: () => Effect.succeed(api),
    resolvePlayApi: () => Effect.succeed(null),
  };
};
describe('gameCenterPlanner', () => {
  it('omits itself when no app declares Game Center', async () => {
    const plan = await runPlanner(gameCenterPlanner, makeCtx(makeAscApiFake()));
    expect(plan.state).toBe('omitted');
  });
  it('skips with a creds hint when no Apple account is active', async () => {
    const plan = await runPlanner(gameCenterPlanner, makeCtx(null, DECLARED));
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  });
  it("reports an additive plan when Game Center isn't enabled yet", async () => {
    const plan = await runPlanner(gameCenterPlanner, makeCtx(makeAscApiFake(), DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') return;
    if (plan.scope !== 'app') return;
    expect(plan.direction).toBe('additive');
    expect(plan.apps[0]?.identifier).toBe('com.acme.alpha');
    expect(plan.apps[0]?.actions.some((a) => /Game Center/i.test(a.description))).toBe(true);
  });
  it('renders in sync when Game Center is already enabled and nothing is declared under it', async () => {
    const api = makeAscApiFake({
      getGameCenterDetail: vi.fn().mockResolvedValue({ id: 'detail1' }),
    });
    const plan = await runPlanner(gameCenterPlanner, makeCtx(api, DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') return;
    if (plan.scope !== 'app') return;
    expect(plan.apps[0]?.actions).toHaveLength(0);
  });
  it('captures a missing app record as a per-app error, not a thrown plan', async () => {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await runPlanner(gameCenterPlanner, makeCtx(api, DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') return;
    if (plan.scope !== 'app') return;
    expect(plan.apps[0]?.error).toMatch(/No App Store Connect app record/);
  });
  it('is strictly read-only: never invokes a write endpoint', async () => {
    const api = makeAscApiFake();
    await runPlanner(gameCenterPlanner, makeCtx(api, DECLARED));
    expect(api.createGameCenterDetail).toHaveBeenCalledTimes(0);
    expect(api.createGameCenterAchievement).toHaveBeenCalledTimes(0);
  });
});
