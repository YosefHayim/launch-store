import { describe, expect, it, vi } from 'vitest';
import { appClipsPlanner } from './appClips.js';
import { makeAscApiFake } from './ascApiFake.testkit.js';
import type { AscSurfacesApi, PlanContext } from '../types.js';
import type { AppClipsConfig, AppDescriptor, LaunchConfig } from '../../types.js';

const ALPHA: AppDescriptor = {
  name: 'alpha',
  dir: '/no/such/dir/alpha',
  configPath: '/no/such/dir/alpha/app.json',
  bundleId: 'com.acme.alpha',
};

/** Declares one App Clip card; with the fake reporting no live clips, the reconciler surfaces an action. */
const DECLARED: Record<string, AppClipsConfig> = {
  'com.acme.alpha': { clips: { 'com.acme.alpha.Clip': { action: 'OPEN' } } },
};

function makeCtx(
  api: AscSurfacesApi | null,
  appClips?: Record<string, AppClipsConfig>,
): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    ...(appClips ? { appClips } : {}),
  };
  return {
    config,
    apps: [ALPHA],
    resolveAscApi: () => Promise.resolve(api),
    resolvePlayApi: () => Promise.resolve(null),
  };
}

describe('appClipsPlanner', () => {
  it('omits itself when no app declares App Clips', async () => {
    const plan = await appClipsPlanner.plan(makeCtx(makeAscApiFake()));
    expect(plan.state).toBe('omitted');
  });

  it('skips with a creds hint when no Apple account is active', async () => {
    const plan = await appClipsPlanner.plan(makeCtx(null, DECLARED));
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  });

  it('reports an additive plan for the declared clip', async () => {
    const plan = await appClipsPlanner.plan(makeCtx(makeAscApiFake(), DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.direction).toBe('additive');
    expect(plan.apps[0]?.identifier).toBe('com.acme.alpha');
    expect(plan.apps[0]?.actions.length).toBeGreaterThan(0);
  });

  it('captures a missing app record as a per-app error, not a thrown plan', async () => {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await appClipsPlanner.plan(makeCtx(api, DECLARED));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.apps[0]?.error).toMatch(/No App Store Connect app record/);
  });

  it('is strictly read-only: never invokes a write endpoint', async () => {
    const api = makeAscApiFake();
    await appClipsPlanner.plan(makeCtx(api, DECLARED));
    expect(api.createAppClipDefaultExperience).toHaveBeenCalledTimes(0);
    expect(api.createAppClipDefaultExperienceLocalization).toHaveBeenCalledTimes(0);
  });
});
