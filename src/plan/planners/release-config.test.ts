import { describe, expect, it, vi } from 'vitest';
import { releaseConfigPlanner } from './release-config.ts';
import { makeAscApiFake } from '../../testkit/app-store-connect-surfaces.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type { AscSurfacesApi, PlanContext } from '../../types/plan.ts';
import type { ReleaseAttributesConfig } from '../../types/store-surface.ts';
import type { ActionStatus } from '../../types/reconcile.ts';

const alpha: AppDescriptor = {
  name: 'alpha',
  dir: '/no/such/dir/alpha',
  configPath: '/no/such/dir/alpha/app.json',
  bundleId: 'com.acme.alpha',
};
/** A config declaring a base price - with the fake's "no current price" default, this plans one change. */
const PRICED: Record<string, ReleaseAttributesConfig> = {
  'com.acme.alpha': { pricing: { customerPrice: 9.99 } },
};

function makeCtx(
  api: AscSurfacesApi | null,
  releaseAttributes?: Record<string, ReleaseAttributesConfig>,
): PlanContext {
  const baseConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };
  let config = baseConfig;

  if (releaseAttributes) config = { ...baseConfig, releaseAttributes };

  return {
    config,
    apps: [alpha],
    readAscApi() {
      return Promise.resolve(api);
    },
    readPlayApi() {
      return Promise.resolve(null);
    },
  };
}

function describeReleasePiecePlanner() {
  async function omitsItselfWhenNoAppDeclaresReleaseAttributes() {
    const ascApiFake = makeAscApiFake();
    const plan = await releaseConfigPlanner.plan(makeCtx(ascApiFake));
    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no app declares release attributes',
    omitsItselfWhenNoAppDeclaresReleaseAttributes,
  );

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await releaseConfigPlanner.plan(makeCtx(null, PRICED));

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );

  async function reportsThePerAppPriceChangeAFreshPieceWouldApplyTwoWay() {
    const ascApiFake = makeAscApiFake();
    const plan = await releaseConfigPlanner.plan(makeCtx(ascApiFake, PRICED));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.direction).toBe('two-way');
    expect(plan.apps[0]?.identifier).toBe('com.acme.alpha');

    function isSetAppPrice(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return plannedAction.description.includes('set app price');
    }

    expect(plan.apps[0]?.actions.some(isSetAppPrice)).toBe(true);
  }

  it(
    'reports the per-app price change a fresh config would apply (two-way)',
    reportsThePerAppPriceChangeAFreshPieceWouldApplyTwoWay,
  );

  async function rendersInSyncWhenTheLivePriceAlreadyMatches() {
    const api = makeAscApiFake({ getCurrentAppPrice: vi.fn().mockResolvedValue('9.99') });
    const plan = await releaseConfigPlanner.plan(makeCtx(api, PRICED));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.apps[0]?.actions).toHaveLength(0);
  }

  it(
    'renders in sync when the live price already matches',
    rendersInSyncWhenTheLivePriceAlreadyMatches,
  );

  async function capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan() {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await releaseConfigPlanner.plan(makeCtx(api, PRICED));

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
    await releaseConfigPlanner.plan(makeCtx(api, PRICED));
    expect(api.createAppPriceSchedule).toHaveBeenCalledTimes(0);
    expect(api.updateAppInfoCategories).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('releaseConfigPlanner', describeReleasePiecePlanner);
