import { runPlanner } from './planner-testkit.ts';
import { describe, expect, it, vi } from 'vitest';
import { availabilityPlanner } from './availability.ts';
import { makeAscApiFake } from '@/testkit/app-store-connect-api-fake-testkit.js';
import type { AvailabilityConfig } from '@/store/apple/availability.js';
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
  availabilitySection: AvailabilityConfig | null,
): PlanContext {
  const fallbackLaunch: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };

  const isOmitted = availabilitySection == null;

  if (isOmitted) {
    return contextFor(api, fallbackLaunch);
  }

  const declaredLaunch: LaunchConfig = {
    ...fallbackLaunch,
    availability: { 'com.acme.alpha': availabilitySection },
  };

  return contextFor(api, declaredLaunch);
}

function describeAvailabilityPlanner() {
  async function omitsItselfWhenNoAvailabilitySidecarIsPresent() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(availabilityPlanner, makeCtx(ascApiFake, null));

    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no availability sidecar is present',
    omitsItselfWhenNoAvailabilitySidecarIsPresent,
  );

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(availabilityPlanner, makeCtx(null, { territories: ['USA'] }));

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );

  async function reportsTheTerritoryChangeAFreshPieceWouldApplyTwoWay() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(
      availabilityPlanner,
      makeCtx(ascApiFake, { territories: ['USA'] }),
    );

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.direction).toBe('two-way');

    function isStoreAvailability(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return plannedAction.description.includes('store availability');
    }

    expect(plan.apps[0]?.actions.some(isStoreAvailability)).toBe(true);
  }

  it(
    'reports the territory change a fresh config would apply (two-way)',
    reportsTheTerritoryChangeAFreshPieceWouldApplyTwoWay,
  );

  async function rendersInSyncWhenLiveAvailabilityAlreadyMatches() {
    const api = makeAscApiFake({
      getAppAvailability: vi.fn().mockResolvedValue({
        id: 'avail1',
        availableInNewTerritories: false,
        availableTerritories: ['USA'],
      }),
    });
    const plan = await runPlanner(
      availabilityPlanner,
      makeCtx(api, { territories: ['USA'], availableInNewTerritories: false }),
    );

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.apps[0]?.actions).toHaveLength(0);
  }

  it(
    'renders in sync when live availability already matches',
    rendersInSyncWhenLiveAvailabilityAlreadyMatches,
  );

  async function capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan() {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await runPlanner(availabilityPlanner, makeCtx(api, { territories: ['USA'] }));

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
    await runPlanner(availabilityPlanner, makeCtx(api, { territories: ['USA'] }));
    expect(api.createAppAvailability).toHaveBeenCalledTimes(0);
    expect(api.updateAppAvailabilityTerritories).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('availabilityPlanner', describeAvailabilityPlanner);
