import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { SubscriptionOfferResource, SubscriptionResource } from '../types/googlePlay.js';
import type { SubscriptionConfig } from '../types/catalog.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
import {
  type PlaySubscriptionsApi,
  buildOffer,
  microsToMoney,
  reconcilePlaySubscriptions,
  summarizePlaySubscriptions,
} from './playSubscriptions.js';
/** Records every write the reconciler makes, so a test can assert exactly what was sent to Play. */
type Calls = {
  created: SubscriptionResource[];
  patched: {
    subscription: SubscriptionResource;
    updateMask: string;
  }[];
  activatedBasePlans: {
    productId: string;
    basePlanId: string;
  }[];
  createdOffers: SubscriptionOfferResource[];
  activatedOffers: {
    productId: string;
    basePlanId: string;
    offerId: string;
  }[];
};
/** A hand-rolled {@link PlaySubscriptionsApi} - no network - serving `existing` and recording the writes. */
const makeApi = (
  existing: SubscriptionResource[],
  options: {
    reachable?: boolean;
    offersByBasePlan?: Record<string, SubscriptionOfferResource[]>;
  } = {},
): {
  api: PlaySubscriptionsApi;
  calls: Calls;
} => {
  const calls: Calls = {
    created: [],
    patched: [],
    activatedBasePlans: [],
    createdOffers: [],
    activatedOffers: [],
  };
  const api: PlaySubscriptionsApi = {
    assertAppExists: () => {
      if (options.reachable === false) return Effect.fail(new Error('No reachable Play app'));
      return Effect.void;
    },
    listSubscriptions: () => Effect.succeed(existing),
    createSubscription: (_pkg, subscription) => {
      calls.created.push(subscription);
      return Effect.void;
    },
    patchSubscription: (_pkg, subscription, updateMask) => {
      calls.patched.push({ subscription, updateMask });
      return Effect.void;
    },
    activateBasePlan: (_pkg, productId, basePlanId) => {
      calls.activatedBasePlans.push({ productId, basePlanId });
      return Effect.void;
    },
    listSubscriptionOffers: (_pkg, productId, basePlanId) => {
      let offers: SubscriptionOfferResource[] = [];
      const configuredOffers = options.offersByBasePlan?.[`${productId}/${basePlanId}`];
      if (configuredOffers !== undefined) offers = configuredOffers;
      return Effect.succeed(offers);
    },
    createSubscriptionOffer: (_pkg, offer) => {
      calls.createdOffers.push(offer);
      return Effect.void;
    },
    activateSubscriptionOffer: (_pkg, productId, basePlanId, offerId) => {
      calls.activatedOffers.push({ productId, basePlanId, offerId });
      return Effect.void;
    },
  };
  return { api, calls };
};
/** Execute the offer builder at the test boundary. */
const runOffer = (...offerInput: Parameters<typeof buildOffer>): SubscriptionOfferResource =>
  Effect.runSync(buildOffer(...offerInput));
/** Execute the subscriptions reconciler at the test boundary. */
const runReconcile = (
  api: PlaySubscriptionsApi,
  input: Parameters<typeof reconcilePlaySubscriptions>[1],
) => Effect.runPromise(reconcilePlaySubscriptions(api, input));
/** A minimal shared subscription config with a Play override. */
const sub = (overrides: Partial<SubscriptionConfig> = {}): SubscriptionConfig => {
  return {
    productId: 'com.acme.pro.monthly',
    referenceName: 'Pro Monthly',
    subscriptionPeriod: 'ONE_MONTH',
    localizations: [{ locale: 'en-US', name: 'Pro Monthly', description: 'All features' }],
    play: { prices: { US: { priceMicros: '9990000', currency: 'USD' } } },
    ...overrides,
  };
};
describe('microsToMoney', () => {
  it('splits micro-units into whole units and billionths', () => {
    expect(microsToMoney({ priceMicros: '9990000', currency: 'USD' })).toEqual({
      currencyCode: 'USD',
      units: '9',
      nanos: 990000000,
    });
    expect(microsToMoney({ priceMicros: '1990000', currency: 'EUR' })).toEqual({
      currencyCode: 'EUR',
      units: '1',
      nanos: 990000000,
    });
  });
});
describe('buildOffer', () => {
  it("builds a free-trial offer covering the base plan's regions", () => {
    const offer = runOffer('com.acme.pro', 'p1m', ['US', 'GB'], {
      offerId: 'trial',
      freeTrialDuration: 'P1W',
    });
    expect(offer.phases).toEqual([
      {
        recurrenceCount: 1,
        duration: 'P1W',
        regionalConfigs: [
          { regionCode: 'US', free: {} },
          { regionCode: 'GB', free: {} },
        ],
      },
    ]);
    expect(offer.regionalConfigs).toEqual([
      { regionCode: 'US', newSubscriberAvailability: true },
      { regionCode: 'GB', newSubscriberAvailability: true },
    ]);
  });
  it('builds an introductory-price offer over the priced regions', () => {
    const offer = runOffer('com.acme.pro', 'p1m', ['US'], {
      offerId: 'intro',
      introPrices: { US: { priceMicros: '4990000', currency: 'USD' } },
      introRecurrenceCount: 3,
    });
    expect(offer.phases).toEqual([
      {
        recurrenceCount: 3,
        regionalConfigs: [
          { regionCode: 'US', price: { currencyCode: 'USD', units: '4', nanos: 990000000 } },
        ],
      },
    ]);
  });
  it('intersects regions when an offer has both a trial and an intro phase', () => {
    const offer = runOffer('com.acme.pro', 'p1m', ['US', 'GB'], {
      offerId: 'combo',
      freeTrialDuration: 'P3D',
      introPrices: { US: { priceMicros: '4990000', currency: 'USD' } },
    });
    expect(offer.regionalConfigs).toEqual([{ regionCode: 'US', newSubscriberAvailability: true }]);
    expect(offer.phases[0]?.regionalConfigs).toEqual([{ regionCode: 'US', free: {} }]);
  });
  it('rejects an offer that discounts nothing and one whose phases share no region', () => {
    const emptyOfferFailure = Effect.runSync(
      Effect.flip(buildOffer('p', 'bp', ['US'], { offerId: 'empty' })),
    );
    expect(emptyOfferFailure.message).toMatch(/neither a free trial nor intro/);
    const splitRegionFailure = Effect.runSync(
      Effect.flip(
        buildOffer('p', 'bp', ['GB'], {
          offerId: 'split',
          freeTrialDuration: 'P1W',
          introPrices: { US: { priceMicros: '1', currency: 'USD' } },
        }),
      ),
    );
    expect(splitRegionFailure.message).toMatch(/no region common/);
  });
});
describe('reconcilePlaySubscriptions', () => {
  it('throws when the Play app record is unreachable', async () => {
    const { api } = makeApi([], { reachable: false });
    await expect(
      runReconcile(api, {
        packageName: 'com.acme.app',
        subscriptions: [sub()],
        dryRun: true,
      }),
    ).rejects.toThrow(/No reachable Play app/);
  });
  it('creates a subscription + base plan, activates the plan, then creates + activates its offers', async () => {
    const { api, calls } = makeApi([]);
    const subscriptionsOutcome = await runReconcile(api, {
      packageName: 'com.acme.app',
      subscriptions: [
        sub({
          play: {
            prices: { US: { priceMicros: '9990000', currency: 'USD' } },
            offers: [{ offerId: 'trial', freeTrialDuration: 'P1W' }],
          },
        }),
      ],
      dryRun: false,
    });
    expect(calls.created).toHaveLength(1);
    const created = expectArrayElement(calls.created, 0, 'calls.created');
    expect(created.productId).toBe('com.acme.pro.monthly');
    expect(created.basePlans?.[0]).toEqual({
      basePlanId: 'p1m',
      autoRenewingBasePlanType: { billingPeriodDuration: 'P1M' },
      regionalConfigs: [
        {
          regionCode: 'US',
          newSubscriberAvailability: true,
          price: { currencyCode: 'USD', units: '9', nanos: 990000000 },
        },
      ],
    });
    expect(created.listings).toEqual([
      { languageCode: 'en-US', title: 'Pro Monthly', description: 'All features' },
    ]);
    expect(calls.activatedBasePlans).toEqual([
      { productId: 'com.acme.pro.monthly', basePlanId: 'p1m' },
    ]);
    expect(calls.createdOffers[0]?.offerId).toBe('trial');
    expect(calls.activatedOffers).toEqual([
      { productId: 'com.acme.pro.monthly', basePlanId: 'p1m', offerId: 'trial' },
    ]);
    expect(summarizePlaySubscriptions(subscriptionsOutcome.actions).failed).toBe(0);
  });
  it('does nothing when the subscription, base plan, and listings already match', async () => {
    const existing: SubscriptionResource = {
      productId: 'com.acme.pro.monthly',
      listings: [{ languageCode: 'en-US', title: 'Pro Monthly', description: 'All features' }],
      basePlans: [{ basePlanId: 'p1m', state: 'ACTIVE' }],
    };
    const { api, calls } = makeApi([existing]);
    const subscriptionsOutcome = await runReconcile(api, {
      packageName: 'com.acme.app',
      subscriptions: [sub()],
      dryRun: false,
    });
    expect(subscriptionsOutcome.actions).toEqual([]);
    expect(calls.created).toHaveLength(0);
    expect(calls.patched).toHaveLength(0);
    expect(calls.activatedBasePlans).toHaveLength(0);
  });
  it("patches listings (mask 'listings') when a title drifts, preserving locales it doesn't manage", async () => {
    const existing: SubscriptionResource = {
      productId: 'com.acme.pro.monthly',
      listings: [
        { languageCode: 'en-US', title: 'Old name', description: 'All features' },
        { languageCode: 'de-DE', title: 'Pro Monatlich', description: 'Alle Funktionen' },
      ],
      basePlans: [{ basePlanId: 'p1m', state: 'ACTIVE' }],
    };
    const { api, calls } = makeApi([existing]);
    await runReconcile(api, {
      packageName: 'com.acme.app',
      subscriptions: [sub()],
      dryRun: false,
    });
    expect(calls.patched).toHaveLength(1);
    expect(calls.patched[0]?.updateMask).toBe('listings');
    const patchedSubscription = expectArrayElement(calls.patched, 0, 'calls.patched');
    let patchedListings = patchedSubscription.subscription.listings;
    if (patchedListings === undefined) patchedListings = [];
    const languages = patchedListings.map((listing) => listing.languageCode).sort();
    expect(languages).toEqual(['de-DE', 'en-US']);
  });
  it('adds + activates a base plan missing from an existing subscription, re-sending live plans without their state', async () => {
    const existing: SubscriptionResource = {
      productId: 'com.acme.pro.monthly',
      listings: [{ languageCode: 'en-US', title: 'Pro Monthly', description: 'All features' }],
      basePlans: [
        {
          basePlanId: 'p1y',
          state: 'ACTIVE',
          autoRenewingBasePlanType: { billingPeriodDuration: 'P1Y' },
        },
      ],
    };
    const { api, calls } = makeApi([existing]);
    await runReconcile(api, {
      packageName: 'com.acme.app',
      subscriptions: [sub()],
      dryRun: false,
    });
    expect(calls.patched[0]?.updateMask).toBe('basePlans');
    const basePlanPatch = expectArrayElement(calls.patched, 0, 'calls.patched');
    let sentPlans = basePlanPatch.subscription.basePlans;
    if (sentPlans === undefined) sentPlans = [];
    expect(sentPlans.map((plan) => plan.basePlanId)).toEqual(['p1y', 'p1m']);
    expect(sentPlans.find((plan) => plan.basePlanId === 'p1y')?.state).toBeUndefined();
    expect(calls.activatedBasePlans).toEqual([
      { productId: 'com.acme.pro.monthly', basePlanId: 'p1m' },
    ]);
  });
  it('activates a base plan that exists but is still DRAFT', async () => {
    const existing: SubscriptionResource = {
      productId: 'com.acme.pro.monthly',
      listings: [{ languageCode: 'en-US', title: 'Pro Monthly', description: 'All features' }],
      basePlans: [{ basePlanId: 'p1m', state: 'DRAFT' }],
    };
    const { api, calls } = makeApi([existing]);
    await runReconcile(api, {
      packageName: 'com.acme.app',
      subscriptions: [sub()],
      dryRun: false,
    });
    expect(calls.patched).toHaveLength(0);
    expect(calls.activatedBasePlans).toEqual([
      { productId: 'com.acme.pro.monthly', basePlanId: 'p1m' },
    ]);
  });
  it('creates a missing offer but skips one that already exists', async () => {
    const existing: SubscriptionResource = {
      productId: 'com.acme.pro.monthly',
      listings: [{ languageCode: 'en-US', title: 'Pro Monthly', description: 'All features' }],
      basePlans: [{ basePlanId: 'p1m', state: 'ACTIVE' }],
    };
    const { api, calls } = makeApi([existing], {
      offersByBasePlan: {
        'com.acme.pro.monthly/p1m': [{ offerId: 'trial', phases: [], regionalConfigs: [] }],
      },
    });
    await runReconcile(api, {
      packageName: 'com.acme.app',
      subscriptions: [
        sub({
          play: {
            prices: { US: { priceMicros: '9990000', currency: 'USD' } },
            offers: [
              { offerId: 'trial', freeTrialDuration: 'P1W' },
              {
                offerId: 'intro',
                introPrices: { US: { priceMicros: '4990000', currency: 'USD' } },
              },
            ],
          },
        }),
      ],
      dryRun: false,
    });
    expect(calls.createdOffers.map((offer) => offer.offerId)).toEqual(['intro']);
  });
  it('plans without writing on a dry run', async () => {
    const { api, calls } = makeApi([]);
    const subscriptionsOutcome = await runReconcile(api, {
      packageName: 'com.acme.app',
      subscriptions: [sub()],
      dryRun: true,
    });
    expect(subscriptionsOutcome.actions.every((action) => action.status === 'planned')).toBe(true);
    expect(calls.created).toHaveLength(0);
  });
  it('records a failed action for an offer config that discounts nothing, without aborting', async () => {
    const { api, calls } = makeApi([]);
    const subscriptionsOutcome = await runReconcile(api, {
      packageName: 'com.acme.app',
      subscriptions: [
        sub({
          play: {
            prices: { US: { priceMicros: '9990000', currency: 'USD' } },
            offers: [{ offerId: 'broken' }],
          },
        }),
      ],
      dryRun: false,
    });
    const failedAction = subscriptionsOutcome.actions.find((action) => action.status === 'failed');
    expect(failedAction?.error).toMatch(/neither a free trial nor intro/);
    expect(calls.created).toHaveLength(1); // the subscription itself still got created
  });
});
