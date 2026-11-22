import { runPlanner } from './planner.testkit.ts';
import { describe, expect, it, vi } from 'vitest';
import { offersPlanner } from './offers.ts';
import { makeAscApiFake } from '../../testkit/asc-api-fake.testkit.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { AppProducts } from '../../types/catalog.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type { AscSurfacesApi, PlanContext } from '../../types/plan.ts';
const alpha: AppDescriptor = {
  name: 'alpha',
  dir: '/no/such/dir/alpha',
  configPath: '/no/such/dir/alpha/app.json',
  bundleId: 'com.acme.alpha',
};
/** A catalog whose subscription declares one FREE_TRIAL offer code (the reconciler's natural key is `name`). */
const WITH_OFFER: AppProducts = {
  subscriptionGroups: [
    {
      referenceName: 'Default',
      localizations: [{ locale: 'en-US', name: 'Default' }],
      subscriptions: [
        {
          productId: 'com.acme.pro',
          referenceName: 'Pro',
          subscriptionPeriod: 'ONE_MONTH',
          localizations: [{ locale: 'en-US', name: 'Pro' }],
          offerCodes: [
            {
              name: 'Launch',
              customerEligibilities: ['NEW'],
              offerEligibility: 'STACK_WITH_INTRO_OFFERS',
              duration: 'ONE_MONTH',
              offerMode: 'FREE_TRIAL',
              numberOfPeriods: 1,
            },
          ],
        },
      ],
    },
  ],
};
/** A plain catalog (one IAP, no offers and no promoted purchases) - the offers surface should omit it. */
const noOffers: AppProducts = {
  inAppPurchases: [
    {
      productId: 'com.acme.coins',
      referenceName: 'Coins',
      type: 'CONSUMABLE',
      localizations: [{ locale: 'en-US', name: 'Coins' }],
      price: { customerPrice: 4.99 },
    },
  ],
};
/** A fake whose live subscription `com.acme.pro` exists, so a declared offer code plans a create. */
const apiWithLiveSubscription = (overrides: Partial<AscSurfacesApi> = {}): AscSurfacesApi => {
  return makeAscApiFake({
    listSubscriptionGroups: vi.fn().mockResolvedValue([{ id: 'grp1', referenceName: 'Default' }]),
    listSubscriptions: vi.fn().mockResolvedValue([{ id: 'sub1', productId: 'com.acme.pro' }]),
    ...overrides,
  });
};
const makeCtx = (
  api: AscSurfacesApi | null,
  products: Record<string, AppProducts> = {},
): PlanContext => {
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
    apps: [alpha],
    resolveAscApi: () => Promise.resolve(api),
    resolvePlayApi: () => Promise.resolve(null),
  };
};
describe('offersPlanner', () => {
  it('omits itself when no app declares offers or promoted purchases', async () => {
    const plan = await runPlanner(
      offersPlanner,
      makeCtx(apiWithLiveSubscription(), { 'com.acme.alpha': noOffers }),
    );
    expect(plan.state).toBe('omitted');
  });
  it('skips with a creds hint when no Apple account is active', async () => {
    const plan = await runPlanner(offersPlanner, makeCtx(null, { 'com.acme.alpha': WITH_OFFER }));
    expect(plan.state).toBe('skipped');
    if (plan.state != 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  });
  it("reports an additive plan to create a declared offer code that doesn't exist yet", async () => {
    const plan = await runPlanner(
      offersPlanner,
      makeCtx(apiWithLiveSubscription(), { 'com.acme.alpha': WITH_OFFER }),
    );
    expect(plan.state).toBe('planned');
    if (plan.state != 'planned') return;
    if (plan.scope != 'app') return;
    expect(plan.direction).toBe('additive');
    expect(
      plan.apps[0]?.actions.some((a) =>
        a.description.includes('create offer code "Launch" on com.acme.pro'),
      ),
    ).toBe(true);
  });
  it('captures a missing app record as a per-app error, not a thrown plan', async () => {
    const api = apiWithLiveSubscription({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await runPlanner(offersPlanner, makeCtx(api, { 'com.acme.alpha': WITH_OFFER }));
    expect(plan.state).toBe('planned');
    if (plan.state != 'planned') return;
    if (plan.scope != 'app') return;
    expect(plan.apps[0]?.error).toMatch(/No App Store Connect app record/);
  });
  it('is strictly read-only: never invokes a write endpoint', async () => {
    const api = apiWithLiveSubscription();
    await runPlanner(offersPlanner, makeCtx(api, { 'com.acme.alpha': WITH_OFFER }));
    expect(api.createSubscriptionOfferCode).toHaveBeenCalledTimes(0);
    expect(api.createPromotionalOffer).toHaveBeenCalledTimes(0);
    expect(api.createPromotedPurchase).toHaveBeenCalledTimes(0);
    expect(api.reorderPromotedPurchases).toHaveBeenCalledTimes(0);
  });
});
