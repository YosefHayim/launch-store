import { runPlanner } from './planner-testkit.ts';
import { describe, expect, it, vi } from 'vitest';
import { experimentsPlanner } from './experiments.ts';
import { makeAscApiFake } from '@/testkit/app-store-connect-api-fake-testkit.js';
import type { VersionExperimentsConfig } from '@/release/version-experiments.js';
import type { AppDescriptor } from '@/types/app.js';
import type { LaunchConfig } from '@/types/config.js';
import type { AscSurfacesApi, PlanContext } from '@/types/plan.js';
import type { ActionStatus } from '@/types/reconcile.js';

const alpha: AppDescriptor = {
  name: 'alpha',
  dir: '/no/such/dir/alpha',
  configPath: '/no/such/dir/alpha/app.json',
  bundleId: 'com.acme.alpha',
};

function contextFor(api: AscSurfacesApi | null, launchFile: LaunchConfig): PlanContext {
  return {
    config: launchFile,
    apps: [alpha],
    resolveAscApi() {
      return Promise.resolve(api);
    },
    resolvePlayApi() {
      return Promise.resolve(null);
    },
  };
}

function makeCtx(
  api: AscSurfacesApi | null,
  experimentsSection: VersionExperimentsConfig | null,
): PlanContext {
  const fallbackLaunch: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };

  const isOmitted = experimentsSection == null;

  if (isOmitted) {
    return contextFor(api, fallbackLaunch);
  }

  const declaredLaunch: LaunchConfig = {
    ...fallbackLaunch,
    experiments: { 'com.acme.alpha': experimentsSection },
  };

  return contextFor(api, declaredLaunch);
}

const DECLARED: VersionExperimentsConfig = {
  experiments: [{ name: 'exp1', trafficProportion: 50 }],
};

function describeExperimentsPlanner() {
  async function omitsItselfWhenNoExperimentsSidecarIsPresent() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(experimentsPlanner, makeCtx(ascApiFake, null));

    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no experiments sidecar is present',
    omitsItselfWhenNoExperimentsSidecarIsPresent,
  );

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(experimentsPlanner, makeCtx(null, DECLARED));

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );

  async function reportsAnAdditivePlanWhenTheExperimentDoesnTExistYet() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(experimentsPlanner, makeCtx(ascApiFake, DECLARED));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.direction).toBe('additive');

    function isExperimentAction(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return plannedAction.description.includes('experiment');
    }

    expect(plan.apps[0]?.actions.some(isExperimentAction)).toBe(true);
  }

  it(
    "reports an additive plan when the experiment doesn't exist yet",
    reportsAnAdditivePlanWhenTheExperimentDoesnTExistYet,
  );

  async function rendersInSyncWhenTheLiveExperimentAlreadyMatches() {
    const api = makeAscApiFake({
      listVersionExperiments: vi
        .fn()
        .mockResolvedValue([{ id: 'ex1', name: 'exp1', state: 'DRAFT', trafficProportion: 50 }]),
    });
    const plan = await runPlanner(experimentsPlanner, makeCtx(api, DECLARED));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.apps[0]?.actions).toHaveLength(0);
  }

  it(
    'renders in sync when the live experiment already matches',
    rendersInSyncWhenTheLiveExperimentAlreadyMatches,
  );

  async function capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan() {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await runPlanner(experimentsPlanner, makeCtx(api, DECLARED));

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
    await runPlanner(experimentsPlanner, makeCtx(api, DECLARED));
    expect(api.createVersionExperiment).toHaveBeenCalledTimes(0);
    expect(api.createExperimentTreatment).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('experimentsPlanner', describeExperimentsPlanner);
