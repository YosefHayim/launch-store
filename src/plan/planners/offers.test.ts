import { runPlanner } from './planner-testkit.ts';
import { describe, expect, it, vi } from 'vitest';
import { offersPlanner } from './offers.ts';
import { makeAscApiFake } from '@/testkit/asc-api-fake-testkit.js';
import type { AppDescriptor } from '@/types/app.js';
import type { AppProducts } from '@/types/catalog.js';
import type { LaunchConfig } from '@/types/config.js';
import type { AscSurfacesApi, PlanContext } from '@/types/plan.js';
import type { ActionStatus } from '@/types/reconcile.js';

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
function apiWithLiveSubscription(overrides: Partial<AscSurfacesApi> = {}): AscSurfacesApi {
  return makeAscApiFake({
    listSubscriptionGroups: vi.fn().mockResolvedValue([{ id: 'grp1', referenceName: 'Default' }]),
    listSubscriptions: vi.fn().mockResolvedValue([{ id: 'sub1', productId: 'com.acme.pro' }]),
    ...overrides,
  });
}

function makeCtx(
  api: AscSurfacesApi | null,
  products: Record<string, AppProducts> = {},
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
    apps: [alpha],
    resolveAscApi() {
      return Promise.resolve(api);
    },
    resolvePlayApi() {
      return Promise.resolve(null);
    },
  };
}

function describeOffersPlanner() {
  async function omitsItselfWhenNoAppDeclaresOffersOrPromotedPurchases() {
    const plan = await runPlanner(
      offersPlanner,
      makeCtx(apiWithLiveSubscription(), { 'com.acme.alpha': noOffers }),
    );

    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no app declares offers or promoted purchases',
    omitsItselfWhenNoAppDeclaresOffersOrPromotedPurchases,
  );

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(offersPlanner, makeCtx(null, { 'com.acme.alpha': WITH_OFFER }));

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );

  async function reportsAnAdditivePlanToCreateADeclaredOfferCodeThatDoesnTExistYet() {
    const plan = await runPlanner(
      offersPlanner,
      makeCtx(apiWithLiveSubscription(), { 'com.acme.alpha': WITH_OFFER }),
    );

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.direction).toBe('additive');

    function isCreateLaunchOfferCode(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return plannedAction.description.includes('create offer code "Launch" on com.acme.pro');
    }

    expect(plan.apps[0]?.actions.some(isCreateLaunchOfferCode)).toBe(true);
  }

  it(
    "reports an additive plan to create a declared offer code that doesn't exist yet",
    reportsAnAdditivePlanToCreateADeclaredOfferCodeThatDoesnTExistYet,
  );

  async function capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan() {
    const api = apiWithLiveSubscription({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await runPlanner(offersPlanner, makeCtx(api, { 'com.acme.alpha': WITH_OFFER }));

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
    const api = apiWithLiveSubscription();

    await runPlanner(offersPlanner, makeCtx(api, { 'com.acme.alpha': WITH_OFFER }));
    expect(api.createSubscriptionOfferCode).toHaveBeenCalledTimes(0);
    expect(api.createPromotionalOffer).toHaveBeenCalledTimes(0);
    expect(api.createPromotedPurchase).toHaveBeenCalledTimes(0);
    expect(api.reorderPromotedPurchases).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('offersPlanner', describeOffersPlanner);
