import { describe, expect, it, vi } from 'vitest';
import { customPagesPlanner } from './custom-pages.ts';
import { makeAscApiFake } from '../../testkit/app-store-connect-surfaces.ts';
import type { CustomProductPagesConfig } from '../../apple/custom-product-pages.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type { AscSurfacesApi, PlanContext } from '../../types/plan.ts';
import type { ActionStatus } from '../../types/reconcile.ts';

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
  customPagesSection: CustomProductPagesConfig | null,
): PlanContext {
  const fallbackLaunch: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };

  const isOmitted = customPagesSection == null;

  if (isOmitted) {
    return contextFor(api, fallbackLaunch);
  }

  const declaredLaunch: LaunchConfig = {
    ...fallbackLaunch,
    customPages: { 'com.acme.alpha': customPagesSection },
  };

  return contextFor(api, declaredLaunch);
}

const DECLARED: CustomProductPagesConfig = { pages: [{ name: 'page1' }] };

function describeCustomPagesPlanner() {
  async function omitsItselfWhenNoCustomPagesSidecarIsPresent() {
    const ascApiFake = makeAscApiFake();
    const plan = await customPagesPlanner.plan(makeCtx(ascApiFake, null));

    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no custom-pages sidecar is present',
    omitsItselfWhenNoCustomPagesSidecarIsPresent,
  );

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await customPagesPlanner.plan(makeCtx(null, DECLARED));

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );

  async function reportsThePageAFreshPieceWouldCreateTwoWay() {
    const ascApiFake = makeAscApiFake();
    const plan = await customPagesPlanner.plan(makeCtx(ascApiFake, DECLARED));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.direction).toBe('two-way');

    function isCustomProductPage(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return plannedAction.description.includes('custom product page');
    }

    expect(plan.apps[0]?.actions.some(isCustomProductPage)).toBe(true);
  }

  it(
    'reports the page a fresh config would create (two-way)',
    reportsThePageAFreshPieceWouldCreateTwoWay,
  );

  async function rendersInSyncWhenTheLivePageAlreadyExists() {
    const api = makeAscApiFake({
      listCustomProductPages: vi.fn().mockResolvedValue([{ id: 'pg1', name: 'page1' }]),
    });
    const plan = await customPagesPlanner.plan(makeCtx(api, DECLARED));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.apps[0]?.actions).toHaveLength(0);
  }

  it(
    'renders in sync when the live page already exists',
    rendersInSyncWhenTheLivePageAlreadyExists,
  );

  async function capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan() {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await customPagesPlanner.plan(makeCtx(api, DECLARED));

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
    await customPagesPlanner.plan(makeCtx(api, DECLARED));
    expect(api.createCustomProductPage).toHaveBeenCalledTimes(0);
    expect(api.createCustomProductPageLocalization).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('customPagesPlanner', describeCustomPagesPlanner);
