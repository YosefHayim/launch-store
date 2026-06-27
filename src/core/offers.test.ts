import { describe, expect, it } from 'vitest';
import type {
  InAppPurchaseResource,
  IntroductoryOfferResource,
  OfferCodeCreate,
  OfferCodeResource,
  PricePointResource,
  PromotedPurchaseCreate,
  PromotedPurchaseResource,
  PromotionalOfferCreate,
  PromotionalOfferResource,
  SubscriptionGroupResource,
  SubscriptionResource,
  WinBackOfferCreate,
  WinBackOfferResource,
} from '../apple/ascClient.js';
import type { AppProducts, SubscriptionConfig } from './types.js';
import { reconcileOffers, type AscOffersApi } from './offers.js';

/**
 * Hand-rolled {@link AscOffersApi} fake — records every create/reorder and serves configurable existing
 * state, so the reconciler's diff/plan logic is testable with no network (mirrors the ascSync tests).
 * `findSubscriptionPricePoint` resolves any price except the sentinel `999` (which models "no match").
 */
class FakeOffersApi implements AscOffersApi {
  appId: string | null = 'app-1';
  groups: SubscriptionGroupResource[] = [{ id: 'grp-1', referenceName: 'Main' }];
  subsByGroup: Record<string, SubscriptionResource[]> = {
    'grp-1': [{ id: 'sub-1', productId: 'com.acme.pro', name: 'Pro' }],
  };
  iaps: InAppPurchaseResource[] = [];
  offerCodes: OfferCodeResource[] = [];
  promotionalOffers: PromotionalOfferResource[] = [];
  introductoryOffers: IntroductoryOfferResource[] = [];
  winBackOffers: WinBackOfferResource[] = [];
  promoted: PromotedPurchaseResource[] = [];

  readonly createdOfferCodes: OfferCodeCreate[] = [];
  readonly createdPromotional: PromotionalOfferCreate[] = [];
  readonly createdWinBack: WinBackOfferCreate[] = [];
  readonly createdPromoted: PromotedPurchaseCreate[] = [];
  introCreateCount = 0;
  reorderedTo: string[] | null = null;

  getAppId(): Promise<string | null> {
    return Promise.resolve(this.appId);
  }
  listSubscriptionGroups(): Promise<SubscriptionGroupResource[]> {
    return Promise.resolve(this.groups);
  }
  listSubscriptions(groupId: string): Promise<SubscriptionResource[]> {
    return Promise.resolve(this.subsByGroup[groupId] ?? []);
  }
  listInAppPurchases(): Promise<InAppPurchaseResource[]> {
    return Promise.resolve(this.iaps);
  }
  findSubscriptionPricePoint(
    _subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    if (customerPrice === 999) return Promise.resolve(null);
    return Promise.resolve({
      id: `pp-${territory}-${customerPrice}`,
      customerPrice: String(customerPrice),
      territory,
    });
  }
  listSubscriptionOfferCodes(): Promise<OfferCodeResource[]> {
    return Promise.resolve(this.offerCodes);
  }
  createSubscriptionOfferCode(input: OfferCodeCreate): Promise<OfferCodeResource> {
    this.createdOfferCodes.push(input);
    return Promise.resolve({ id: `oc-${input.name}`, name: input.name, active: true });
  }
  listPromotionalOffers(): Promise<PromotionalOfferResource[]> {
    return Promise.resolve(this.promotionalOffers);
  }
  createPromotionalOffer(input: PromotionalOfferCreate): Promise<PromotionalOfferResource> {
    this.createdPromotional.push(input);
    return Promise.resolve({
      id: `po-${input.offerCode}`,
      name: input.name,
      offerCode: input.offerCode,
    });
  }
  listIntroductoryOffers(): Promise<IntroductoryOfferResource[]> {
    return Promise.resolve(this.introductoryOffers);
  }
  createIntroductoryOffer(): Promise<void> {
    this.introCreateCount++;
    return Promise.resolve();
  }
  listWinBackOffers(): Promise<WinBackOfferResource[]> {
    return Promise.resolve(this.winBackOffers);
  }
  createWinBackOffer(input: WinBackOfferCreate): Promise<void> {
    this.createdWinBack.push(input);
    return Promise.resolve();
  }
  listPromotedPurchases(): Promise<PromotedPurchaseResource[]> {
    return Promise.resolve(this.promoted);
  }
  createPromotedPurchase(input: PromotedPurchaseCreate): Promise<PromotedPurchaseResource> {
    this.createdPromoted.push(input);
    return Promise.resolve({
      id: `pp-new-${this.createdPromoted.length}`,
      inAppPurchaseId: input.inAppPurchaseId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      enabled: input.enabled,
      visibleForAllUsers: input.visibleForAllUsers,
    });
  }
  reorderPromotedPurchases(_appId: string, orderedIds: string[]): Promise<void> {
    this.reorderedTo = orderedIds;
    return Promise.resolve();
  }
}

/** Build a products config with one subscription carrying the given offer overrides. */
function productsWith(overrides: Partial<SubscriptionConfig>): AppProducts {
  const subscription: SubscriptionConfig = {
    productId: 'com.acme.pro',
    referenceName: 'Pro',
    subscriptionPeriod: 'ONE_MONTH',
    localizations: [{ locale: 'en-US', name: 'Pro' }],
    ...overrides,
  };
  return {
    subscriptionGroups: [
      {
        referenceName: 'Main',
        localizations: [{ locale: 'en-US', name: 'Main' }],
        subscriptions: [subscription],
      },
    ],
  };
}

describe('reconcileOffers — offer codes', () => {
  it('creates a missing offer code with its prices resolved to price points', async () => {
    const api = new FakeOffersApi();
    const report = await reconcileOffers(api, {
      bundleId: 'com.acme.app',
      dryRun: false,
      products: productsWith({
        offerCodes: [
          {
            name: 'LAUNCH',
            customerEligibilities: ['NEW'],
            offerEligibility: 'REPLACE_INTRO_OFFERS',
            duration: 'ONE_MONTH',
            offerMode: 'PAY_AS_YOU_GO',
            numberOfPeriods: 3,
            prices: [{ territory: 'USA', customerPrice: 4.99 }],
          },
        ],
      }),
    });
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0]?.status).toBe('applied');
    expect(api.createdOfferCodes).toHaveLength(1);
    expect(api.createdOfferCodes[0]?.prices).toEqual([
      { territory: 'USA', pricePointId: 'pp-USA-4.99' },
    ]);
  });

  it('skips an offer code that already exists (matched by name)', async () => {
    const api = new FakeOffersApi();
    api.offerCodes = [{ id: 'oc-LAUNCH', name: 'LAUNCH', active: true }];
    const report = await reconcileOffers(api, {
      bundleId: 'com.acme.app',
      dryRun: false,
      products: productsWith({
        offerCodes: [
          {
            name: 'LAUNCH',
            customerEligibilities: ['NEW'],
            offerEligibility: 'REPLACE_INTRO_OFFERS',
            duration: 'ONE_MONTH',
            offerMode: 'PAY_AS_YOU_GO',
            numberOfPeriods: 3,
            prices: [{ customerPrice: 4.99 }],
          },
        ],
      }),
    });
    expect(report.actions).toHaveLength(0);
    expect(api.createdOfferCodes).toHaveLength(0);
  });

  it('plans but does not write on a dry-run', async () => {
    const api = new FakeOffersApi();
    const report = await reconcileOffers(api, {
      bundleId: 'com.acme.app',
      dryRun: true,
      products: productsWith({
        offerCodes: [
          {
            name: 'LAUNCH',
            customerEligibilities: ['NEW'],
            offerEligibility: 'REPLACE_INTRO_OFFERS',
            duration: 'ONE_MONTH',
            offerMode: 'FREE_TRIAL',
            numberOfPeriods: 1,
          },
        ],
      }),
    });
    expect(report.actions[0]?.status).toBe('planned');
    expect(api.createdOfferCodes).toHaveLength(0);
  });

  it('skips a FREE_TRIAL offer code that wrongly carries a price', async () => {
    const api = new FakeOffersApi();
    const report = await reconcileOffers(api, {
      bundleId: 'com.acme.app',
      dryRun: false,
      products: productsWith({
        offerCodes: [
          {
            name: 'TRIAL',
            customerEligibilities: ['NEW'],
            offerEligibility: 'REPLACE_INTRO_OFFERS',
            duration: 'ONE_WEEK',
            offerMode: 'FREE_TRIAL',
            numberOfPeriods: 1,
            prices: [{ customerPrice: 4.99 }],
          },
        ],
      }),
    });
    expect(report.actions[0]?.status).toBe('skipped');
    expect(report.actions[0]?.description).toContain('FREE_TRIAL');
    expect(api.createdOfferCodes).toHaveLength(0);
  });

  it('fails the action (not the run) when a declared price matches no price point', async () => {
    const api = new FakeOffersApi();
    const report = await reconcileOffers(api, {
      bundleId: 'com.acme.app',
      dryRun: false,
      products: productsWith({
        offerCodes: [
          {
            name: 'BAD',
            customerEligibilities: ['NEW'],
            offerEligibility: 'REPLACE_INTRO_OFFERS',
            duration: 'ONE_MONTH',
            offerMode: 'PAY_AS_YOU_GO',
            numberOfPeriods: 1,
            prices: [{ customerPrice: 999 }],
          },
        ],
      }),
    });
    expect(report.actions[0]?.status).toBe('failed');
    expect(report.actions[0]?.error).toContain('price point');
  });
});

describe('reconcileOffers — promotional / introductory / win-back', () => {
  it("creates each declared offer kind that's missing", async () => {
    const api = new FakeOffersApi();
    const report = await reconcileOffers(api, {
      bundleId: 'com.acme.app',
      dryRun: false,
      products: productsWith({
        promotionalOffers: [
          {
            name: 'Loyalty',
            offerCode: 'loyalty10',
            duration: 'ONE_MONTH',
            offerMode: 'PAY_AS_YOU_GO',
            numberOfPeriods: 2,
            prices: [{ customerPrice: 2.99 }],
          },
        ],
        introductoryOffers: [{ duration: 'ONE_WEEK', offerMode: 'FREE_TRIAL', numberOfPeriods: 1 }],
        winBackOffers: [
          {
            offerId: 'comeback',
            referenceName: 'Come back',
            duration: 'ONE_MONTH',
            offerMode: 'PAY_AS_YOU_GO',
            numberOfPeriods: 3,
            eligiblePaidMonths: 6,
            monthsSinceLastSubscribed: { min: 1, max: 6 },
            startDate: '2026-07-01',
            prices: [{ customerPrice: 1.99 }],
          },
        ],
      }),
    });
    expect(report.actions.every((action) => action.status === 'applied')).toBe(true);
    expect(api.createdPromotional).toHaveLength(1);
    expect(api.introCreateCount).toBe(1);
    expect(api.createdWinBack).toHaveLength(1);
  });

  it('skips a win-back offer whose eligibility window is inverted', async () => {
    const api = new FakeOffersApi();
    const report = await reconcileOffers(api, {
      bundleId: 'com.acme.app',
      dryRun: false,
      products: productsWith({
        winBackOffers: [
          {
            offerId: 'bad',
            referenceName: 'Bad',
            duration: 'ONE_MONTH',
            offerMode: 'PAY_AS_YOU_GO',
            numberOfPeriods: 1,
            eligiblePaidMonths: 1,
            monthsSinceLastSubscribed: { min: 9, max: 2 },
            startDate: '2026-07-01',
            prices: [{ customerPrice: 1.99 }],
          },
        ],
      }),
    });
    expect(report.actions[0]?.status).toBe('skipped');
    expect(api.createdWinBack).toHaveLength(0);
  });
});

describe('reconcileOffers — promoted purchases', () => {
  it('promotes a missing product and reorders to the declared order', async () => {
    const api = new FakeOffersApi();
    api.iaps = [
      { id: 'iap-1', productId: 'com.acme.coins', name: 'Coins', inAppPurchaseType: 'CONSUMABLE' },
    ];
    api.promoted = [
      {
        id: 'pp-existing',
        inAppPurchaseId: 'iap-1',
        subscriptionId: null,
        enabled: true,
        visibleForAllUsers: true,
      },
    ];
    const products: AppProducts = {
      ...productsWith({}),
      promotedPurchases: [{ productId: 'com.acme.pro' }, { productId: 'com.acme.coins' }],
    };
    const report = await reconcileOffers(api, {
      bundleId: 'com.acme.app',
      dryRun: false,
      products,
    });
    // The subscription isn't promoted yet → created; then a reorder puts pro (new) before coins (existing).
    expect(api.createdPromoted).toHaveLength(1);
    expect(api.createdPromoted[0]?.subscriptionId).toBe('sub-1');
    expect(
      report.actions.some((action) => action.description.startsWith('reorder promoted purchases')),
    ).toBe(true);
  });

  it('skips a promoted product that maps to no subscription or IAP', async () => {
    const api = new FakeOffersApi();
    const products: AppProducts = {
      ...productsWith({}),
      promotedPurchases: [{ productId: 'com.acme.ghost' }],
    };
    const report = await reconcileOffers(api, {
      bundleId: 'com.acme.app',
      dryRun: false,
      products,
    });
    expect(report.actions[0]?.status).toBe('skipped');
    expect(report.actions[0]?.description).toContain('com.acme.ghost');
    expect(api.createdPromoted).toHaveLength(0);
  });
});

describe('reconcileOffers — preconditions', () => {
  it("skips a subscription that isn't in App Store Connect yet", async () => {
    const api = new FakeOffersApi();
    api.subsByGroup = { 'grp-1': [] };
    const report = await reconcileOffers(api, {
      bundleId: 'com.acme.app',
      dryRun: false,
      products: productsWith({
        offerCodes: [
          {
            name: 'LAUNCH',
            customerEligibilities: ['NEW'],
            offerEligibility: 'REPLACE_INTRO_OFFERS',
            duration: 'ONE_MONTH',
            offerMode: 'FREE_TRIAL',
            numberOfPeriods: 1,
          },
        ],
      }),
    });
    expect(report.actions[0]?.status).toBe('skipped');
    expect(report.actions[0]?.description).toContain('launch sync');
  });

  it('throws when the app has no App Store Connect record', async () => {
    const api = new FakeOffersApi();
    api.appId = null;
    await expect(
      reconcileOffers(api, { bundleId: 'com.acme.app', dryRun: false, products: productsWith({}) }),
    ).rejects.toThrow(/No App Store Connect app record/);
  });
});
