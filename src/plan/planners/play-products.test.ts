import { runPlanner } from './planner-testkit.ts';
import { describe, expect, it, vi } from 'vitest';
import { playProductsPlanner } from './play-products.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { AppProducts, InAppPurchaseConfig } from '../../types/catalog.ts';
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
/** A Play-published in-app product (carries a `play` override); SKU defaults to the shared product id. */
const PLAY_IAP: InAppPurchaseConfig = {
  productId: 'com.acme.coins',
  referenceName: 'Coins',
  type: 'CONSUMABLE',
  localizations: [{ locale: 'en-US', name: 'Coins' }],
  play: {},
};

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
    resolveAscApi() {
      return Promise.resolve(null);
    },
    resolvePlayApi() {
      return Promise.resolve(api);
    },
  };
}

function describePlayProductsPlanner() {
  async function omitsItselfWhenNoAppDeclaresAPlayOverriddenProduct() {
    const playApi = makePlayApi();
    const plan = await runPlanner(
      playProductsPlanner,
      makeCtx(playApi, {
        'com.acme.alpha': {
          inAppPurchases: [
            {
              productId: 'com.acme.gems',
              referenceName: 'Gems',
              type: 'CONSUMABLE',
              localizations: [{ locale: 'en-US', name: 'Gems' }],
            },
          ],
        },
      }),
    );

    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no app declares a Play-overridden product',
    omitsItselfWhenNoAppDeclaresAPlayOverriddenProduct,
  );

  async function omitsAnAppThatHasProductsButNoAndroidPackageName() {
    const noPackage: AppDescriptor = {
      name: 'alpha',
      dir: '/no/such/dir/alpha',
      configPath: '/no/such/dir/alpha/app.json',
      bundleId: 'com.acme.alpha',
    };
    const playApi = makePlayApi();
    const plan = await runPlanner(
      playProductsPlanner,
      makeCtx(playApi, { 'com.acme.alpha': { inAppPurchases: [PLAY_IAP] } }, [noPackage]),
    );

    expect(plan.state).toBe('omitted');
  }

  it(
    'omits an app that has products but no Android package name',
    omitsAnAppThatHasProductsButNoAndroidPackageName,
  );

  async function skipsWithAnActionableHintWhenNoPlayServiceAccountIsConfigured() {
    const plan = await runPlanner(
      playProductsPlanner,
      makeCtx(null, { 'com.acme.alpha': { inAppPurchases: [PLAY_IAP] } }),
    );

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.reason).toMatch(/Play service account/);
    expect(plan.hint).toMatch(/android/);
  }

  it(
    'skips with an actionable hint when no Play service account is configured',
    skipsWithAnActionableHintWhenNoPlayServiceAccountIsConfigured,
  );

  async function reportsThePerAppDiffAFreshPlayProductWouldCreate() {
    const playApi = makePlayApi();
    const plan = await runPlanner(
      playProductsPlanner,
      makeCtx(playApi, { 'com.acme.alpha': { inAppPurchases: [PLAY_IAP] } }),
    );

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.apps).toHaveLength(1);
    expect(plan.apps[0]?.identifier).toBe('com.acme.alpha');

    function isCreateCoinsProduct(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return plannedAction.description == 'create Play product com.acme.coins';
    }

    expect(plan.apps[0]?.actions.some(isCreateCoinsProduct)).toBe(true);
  }

  it(
    'reports the per-app diff a fresh Play product would create',
    reportsThePerAppDiffAFreshPlayProductWouldCreate,
  );

  async function capturesAnUnreachableAppAsAPerAppErrorNotAThrownPlan() {
    function mockCall12() {
      return Promise.reject(new Error('app not found on Play'));
    }

    const api = makePlayApi({
      assertAppExists: vi.fn(mockCall12),
    });
    const plan = await runPlanner(
      playProductsPlanner,
      makeCtx(api, { 'com.acme.alpha': { inAppPurchases: [PLAY_IAP] } }),
    );

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

    await runPlanner(
      playProductsPlanner,
      makeCtx(api, { 'com.acme.alpha': { inAppPurchases: [PLAY_IAP] } }),
    );
    expect(api.listInAppProducts).toHaveBeenCalled();
    expect(api.insertInAppProduct).toHaveBeenCalledTimes(0);
    expect(api.updateInAppProduct).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a Play write endpoint',
    isStrictlyReadOnlyNeverInvokesAPlayWriteEndpoint,
  );
}

describe('playProductsPlanner', describePlayProductsPlanner);
