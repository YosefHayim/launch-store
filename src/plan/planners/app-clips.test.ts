import { runPlanner } from './planner-testkit.ts';
import { describe, expect, it, vi } from 'vitest';
import { appClipsPlanner } from './app-clips.ts';
import { makeAscApiFake } from '../../testkit/asc-api-fake-testkit.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type { AscSurfacesApi, PlanContext } from '../../types/plan.ts';
import type { AppClipsConfig } from '../../types/store-surface.ts';
const alpha: AppDescriptor = {
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
  const baseConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };
  let config = baseConfig;

  if (appClips) config = { ...baseConfig, appClips };

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
function describeAppClipsPlanner() {
  async function omitsItselfWhenNoAppDeclaresAppClips() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(appClipsPlanner, makeCtx(ascApiFake));
    expect(plan.state).toBe('omitted');
  }

  it('omits itself when no app declares App Clips', omitsItselfWhenNoAppDeclaresAppClips);

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(appClipsPlanner, makeCtx(null, DECLARED));

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );

  async function reportsAnAdditivePlanForTheDeclaredClip() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(appClipsPlanner, makeCtx(ascApiFake, DECLARED));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.direction).toBe('additive');
    expect(plan.apps[0]?.identifier).toBe('com.acme.alpha');
    expect(plan.apps[0]?.actions.length).toBeGreaterThan(0);
  }

  it('reports an additive plan for the declared clip', reportsAnAdditivePlanForTheDeclaredClip);

  async function capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan() {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await runPlanner(appClipsPlanner, makeCtx(api, DECLARED));

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
    await runPlanner(appClipsPlanner, makeCtx(api, DECLARED));
    expect(api.createAppClipDefaultExperience).toHaveBeenCalledTimes(0);
    expect(api.createAppClipDefaultExperienceLocalization).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('appClipsPlanner', describeAppClipsPlanner);
