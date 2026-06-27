import { describe, expect, it, vi } from 'vitest';
import { playSubscriptionsPlanner } from './playSubscriptions.js';
import type { PlanContext, PlayCatalogApi } from '../types.js';
import type { AppDescriptor, AppProducts, LaunchConfig, SubscriptionConfig } from '../../types.js';

/** A fully-stubbed {@link PlayCatalogApi}: reads default to "nothing exists yet", writes resolve to void. */
function makePlayApi(overrides: Partial<PlayCatalogApi> = {}): PlayCatalogApi {
  const base: PlayCatalogApi = {
    assertAppExists: vi.fn().mockResolvedValue(undefined),
    listInAppProducts: vi.fn().mockResolvedValue([]),
    insertInAppProduct: vi.fn().mockResolvedValue(undefined),
    updateInAppProduct: vi.fn().mockResolvedValue(undefined),
    listSubscriptions: vi.fn().mockResolvedValue([]),
    createSubscription: vi.fn().mockResolvedValue(undefined),
    patchSubscription: vi.fn().mockResolvedValue(undefined),
    activateBasePlan: vi.fn().mockResolvedValue(undefined),
    listSubscriptionOffers: vi.fn().mockResolvedValue([]),
    createSubscriptionOffer: vi.fn().mockResolvedValue(undefined),
    activateSubscriptionOffer: vi.fn().mockResolvedValue(undefined),
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

/** An Apple-only subscription (no `play` override) — must never reach Play. */
const APPLE_ONLY_SUB: SubscriptionConfig = {
  productId: 'com.acme.pro.yearly',
  referenceName: 'Pro Yearly',
  subscriptionPeriod: 'ONE_YEAR',
  localizations: [{ locale: 'en-US', name: 'Pro Yearly' }],
};

/** Wrap subscriptions in the one group `products[bundleId].subscriptionGroups` requires. */
function productsWith(subscriptions: SubscriptionConfig[]): Record<string, AppProducts> {
  return {
    'com.acme.alpha': {
      subscriptionGroups: [
        { referenceName: 'Pro', localizations: [{ locale: 'en-US', name: 'Pro' }], subscriptions },
      ],
    },
  };
}

const ALPHA: AppDescriptor = {
  name: 'alpha',
  dir: '/no/such/dir/alpha',
  configPath: '/no/such/dir/alpha/app.json',
  bundleId: 'com.acme.alpha',
  packageName: 'com.acme.alpha',
};

function makeCtx(
  api: PlayCatalogApi | null,
  products: Record<string, AppProducts> = {},
  apps: AppDescriptor[] = [ALPHA],
): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    ...(Object.keys(products).length > 0 ? { products } : {}),
  };
  return {
    config,
    apps,
    resolveAscApi: () => Promise.resolve(null),
    resolvePlayApi: () => Promise.resolve(api),
  };
}

describe('playSubscriptionsPlanner', () => {
  it('omits itself when no app declares a Play-overridden subscription', async () => {
    const plan = await playSubscriptionsPlanner.plan(
      makeCtx(makePlayApi(), productsWith([APPLE_ONLY_SUB])),
    );
    expect(plan.state).toBe('omitted');
  });

  it('omits an app that has subscriptions but no Android package name', async () => {
    const noPackage: AppDescriptor = {
      name: 'alpha',
      dir: '/no/such/dir/alpha',
      configPath: '/no/such/dir/alpha/app.json',
      bundleId: 'com.acme.alpha',
    };
    const plan = await playSubscriptionsPlanner.plan(
      makeCtx(makePlayApi(), productsWith([PLAY_SUB]), [noPackage]),
    );
    expect(plan.state).toBe('omitted');
  });

  it('skips with an actionable hint when no Play service account is configured', async () => {
    const plan = await playSubscriptionsPlanner.plan(makeCtx(null, productsWith([PLAY_SUB])));
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.reason).toMatch(/Play service account/);
    expect(plan.hint).toMatch(/android/);
  });

  it('reports the per-app diff a fresh Play subscription would create', async () => {
    const plan = await playSubscriptionsPlanner.plan(
      makeCtx(makePlayApi(), productsWith([PLAY_SUB])),
    );
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.apps).toHaveLength(1);
    expect(plan.apps[0]?.identifier).toBe('com.acme.alpha');
    expect(
      plan.apps[0]?.actions.some(
        (a) => a.description === 'create Play subscription com.acme.pro.monthly',
      ),
    ).toBe(true);
  });

  it('captures an unreachable app as a per-app error, not a thrown plan', async () => {
    const api = makePlayApi({
      assertAppExists: vi.fn().mockRejectedValue(new Error('app not found on Play')),
    });
    const plan = await playSubscriptionsPlanner.plan(makeCtx(api, productsWith([PLAY_SUB])));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.apps[0]?.error).toMatch(/app not found on Play/);
    expect(plan.apps[0]?.actions).toHaveLength(0);
  });

  it('is strictly read-only: never invokes a Play write endpoint', async () => {
    const api = makePlayApi();
    await playSubscriptionsPlanner.plan(makeCtx(api, productsWith([PLAY_SUB])));
    expect(api.listSubscriptions).toHaveBeenCalled();
    expect(api.createSubscription).toHaveBeenCalledTimes(0);
    expect(api.patchSubscription).toHaveBeenCalledTimes(0);
    expect(api.activateBasePlan).toHaveBeenCalledTimes(0);
    expect(api.createSubscriptionOffer).toHaveBeenCalledTimes(0);
  });
});
