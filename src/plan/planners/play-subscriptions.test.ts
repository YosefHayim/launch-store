import { describe, expect, it, vi } from 'vitest';
import { playSubscriptionsPlanner } from './play-subscriptions.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { AppProducts, SubscriptionConfig } from '../../types/catalog.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type { PlanContext, PlayCatalogApi } from '../../types/plan.ts';
import type { ActionStatus } from '../../types/reconcile.ts';

/** A fully-stubbed {@link PlayCatalogApi}: reads default to "nothing exists yet", writes resolve to void. */
function makePlayApi(overrides: Partial<PlayCatalogApi> = {}): PlayCatalogApi {
  function mockCall() {
    return Promise.resolve();
  }

  function mockCall2() {
    return Promise.resolve([]);
  }

  function mockCall3() {
    return Promise.resolve();
  }

  function mockCall4() {
    return Promise.resolve();
  }

  function mockCall5() {
    return Promise.resolve([]);
  }

  function mockCall6() {
    return Promise.resolve();
  }

  function mockCall7() {
    return Promise.resolve();
  }

  function mockCall8() {
    return Promise.resolve();
  }

  function mockCall9() {
    return Promise.resolve([]);
  }

  function mockCall10() {
    return Promise.resolve();
  }

  function mockCall11() {
    return Promise.resolve();
  }

  const base: PlayCatalogApi = {
    assertAppExists: vi.fn(mockCall),
    listInAppProducts: vi.fn(mockCall2),
    insertInAppProduct: vi.fn(mockCall3),
    updateInAppProduct: vi.fn(mockCall4),
    listSubscriptions: vi.fn(mockCall5),
    createSubscription: vi.fn(mockCall6),
    patchSubscription: vi.fn(mockCall7),
    activateBasePlan: vi.fn(mockCall8),
    listSubscriptionOffers: vi.fn(mockCall9),
    createSubscriptionOffer: vi.fn(mockCall10),
    activateSubscriptionOffer: vi.fn(mockCall11),
  };

  return { ...base, ...overrides };
}
/** A Play-published subscription (carries a `play` override with a base-plan price). */
const PLAY_SUB: SubscriptionConfig = {
  productId: 'com.acme.pro.monthly',
  referenceName: 'Pro Monthly',
  subscriptionPeriod: 'ONE_MONTH',
  localizations: [{ locale: 'en-US', name: 'Pro Monthly' }],
  play: { prices: { US: { priceMicros: '4990000', currency: 'USD' } } },
};

/** Wrap subscriptions in the one group `products[bundleId].subscriptionGroups` requires. */
function productsWith(subscriptions: readonly SubscriptionConfig[]): Record<string, AppProducts> {
  return {
    'com.acme.alpha': {
      subscriptionGroups: [
        { referenceName: 'Pro', localizations: [{ locale: 'en-US', name: 'Pro' }], subscriptions },
      ],
    },
  };
}

function makeCtx(
  api: PlayCatalogApi | null,
  products: Record<string, AppProducts> = {},
  apps: AppDescriptor[] = [
    {
      name: 'alpha',
      dir: '/no/such/dir/alpha',
      configPath: '/no/such/dir/alpha/app.json',
      bundleId: 'com.acme.alpha',
      packageName: 'com.acme.alpha',
    },
  ],
): PlanContext {
  const baseConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };
  let config = baseConfig;

  if (Object.keys(products).length > 0) config = { ...baseConfig, products };

  return {
    config,
    apps,
    readAscApi() {
      return Promise.resolve(null);
    },
    readPlayApi() {
      return Promise.resolve(api);
    },
  };
}

function describePlaySubscriptionsPlanner() {
  async function omitsItselfWhenNoAppDeclaresAPlayOverriddenSubscription() {
    const playApi = makePlayApi();
    const plan = await playSubscriptionsPlanner.plan(
      makeCtx(
        playApi,
        productsWith([
          {
            productId: 'com.acme.pro.yearly',
            referenceName: 'Pro Yearly',
            subscriptionPeriod: 'ONE_YEAR',
            localizations: [{ locale: 'en-US', name: 'Pro Yearly' }],
          },
        ]),
      ),
    );

    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no app declares a Play-overridden subscription',
    omitsItselfWhenNoAppDeclaresAPlayOverriddenSubscription,
  );

  async function omitsAnAppThatHasSubscriptionsButNoAndroidPackageName() {
    const noPackage: AppDescriptor = {
      name: 'alpha',
      dir: '/no/such/dir/alpha',
      configPath: '/no/such/dir/alpha/app.json',
      bundleId: 'com.acme.alpha',
    };
    const playApi = makePlayApi();
    const plan = await playSubscriptionsPlanner.plan(
      makeCtx(playApi, productsWith([PLAY_SUB]), [noPackage]),
    );

    expect(plan.state).toBe('omitted');
  }

  it(
    'omits an app that has subscriptions but no Android package name',
    omitsAnAppThatHasSubscriptionsButNoAndroidPackageName,
  );

  async function skipsWithAnActionableHintWhenNoPlayServiceAccountIsConfigured() {
    const plan = await playSubscriptionsPlanner.plan(makeCtx(null, productsWith([PLAY_SUB])));

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.reason).toMatch(/Play service account/);
    expect(plan.hint).toMatch(/android/);
  }

  it(
    'skips with an actionable hint when no Play service account is configured',
    skipsWithAnActionableHintWhenNoPlayServiceAccountIsConfigured,
  );

  async function reportsThePerAppDiffAFreshPlaySubscriptionWouldCreate() {
    const playApi = makePlayApi();
    const plan = await playSubscriptionsPlanner.plan(makeCtx(playApi, productsWith([PLAY_SUB])));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.apps).toHaveLength(1);
    expect(plan.apps[0]?.identifier).toBe('com.acme.alpha');

    function isCreateMonthlySubscription(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return plannedAction.description == 'create Play subscription com.acme.pro.monthly';
    }

    expect(plan.apps[0]?.actions.some(isCreateMonthlySubscription)).toBe(true);
  }

  it(
    'reports the per-app diff a fresh Play subscription would create',
    reportsThePerAppDiffAFreshPlaySubscriptionWouldCreate,
  );

  async function capturesAnUnreachableAppAsAPerAppErrorNotAThrownPlan() {
    function mockCall12() {
      return Promise.reject(new Error('app not found on Play'));
    }

    const api = makePlayApi({
      assertAppExists: vi.fn(mockCall12),
    });
    const plan = await playSubscriptionsPlanner.plan(makeCtx(api, productsWith([PLAY_SUB])));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.apps[0]?.error).toMatch(/app not found on Play/);
    expect(plan.apps[0]?.actions).toHaveLength(0);
  }

  it(
    'captures an unreachable app as a per-app error, not a thrown plan',
    capturesAnUnreachableAppAsAPerAppErrorNotAThrownPlan,
  );

  async function isStrictlyReadOnlyNeverInvokesAPlayWriteEndpoint() {
    const api = makePlayApi();

    await playSubscriptionsPlanner.plan(makeCtx(api, productsWith([PLAY_SUB])));
    expect(api.listSubscriptions).toHaveBeenCalled();
    expect(api.createSubscription).toHaveBeenCalledTimes(0);
    expect(api.patchSubscription).toHaveBeenCalledTimes(0);
    expect(api.activateBasePlan).toHaveBeenCalledTimes(0);
    expect(api.createSubscriptionOffer).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a Play write endpoint',
    isStrictlyReadOnlyNeverInvokesAPlayWriteEndpoint,
  );
}

describe('playSubscriptionsPlanner', describePlaySubscriptionsPlanner);
