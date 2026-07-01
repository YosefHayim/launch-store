import { describe, expect, it, vi } from 'vitest';
import { gameCenterPlanner } from './gameCenter.js';
import { makeAscApiFake } from './ascApiFake.testkit.js';
import type {
  AscSurfacesApi,
  PlanContext,
  AppDescriptor,
  GameCenterConfig,
  LaunchConfig,
} from '../../types.js';

const ALPHA: AppDescriptor = {
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
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    ...(gameCenter ? { gameCenter } : {}),
  };
  return {
    config,
    apps: [ALPHA],
    resolveAscApi: () => Promise.resolve(api),
    resolvePlayApi: () => Promise.resolve(null),
  };
}

describe('gameCenterPlanner', () => {
  it('omits itself when no app declares Game Center', async () => {
    const plan = await gameCenterPlanner.plan(makeCtx(makeAscApiFake()));
    expect(plan.state).toBe('omitted');
  });

  it('skips with a creds hint when no Apple account is active', async () => {
    const plan = await gameCenterPlanner.plan(makeCtx(null, DECLARED));
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  });

  it("reports an additive plan when Game Center isn't enabled yet", async () => {
    const plan = await gameCenterPlanner.plan(makeCtx(makeAscApiFake(), DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.direction).toBe('additive');
    expect(plan.apps[0]?.identifier).toBe('com.acme.alpha');
    expect(plan.apps[0]?.actions.some((a) => /Game Center/i.test(a.description))).toBe(true);
  });

  it('renders in sync when Game Center is already enabled and nothing is declared under it', async () => {
    const api = makeAscApiFake({
      getGameCenterDetail: vi.fn().mockResolvedValue({ id: 'detail1' }),
    });
    const plan = await gameCenterPlanner.plan(makeCtx(api, DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.apps[0]?.actions).toHaveLength(0);
  });

  it('captures a missing app record as a per-app error, not a thrown plan', async () => {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await gameCenterPlanner.plan(makeCtx(api, DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.apps[0]?.error).toMatch(/No App Store Connect app record/);
  });

  it('is strictly read-only: never invokes a write endpoint', async () => {
    const api = makeAscApiFake();
    await gameCenterPlanner.plan(makeCtx(api, DECLARED));
    expect(api.createGameCenterDetail).toHaveBeenCalledTimes(0);
    expect(api.createGameCenterAchievement).toHaveBeenCalledTimes(0);
  });
});
