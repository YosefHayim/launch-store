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
} from '../../types/apple-catalog.ts';
import type { AppProducts, SubscriptionConfig } from '../../types/catalog.ts';
import { appDeclaresOffers, reconcileOffers, type AscOffersApi } from './offers.ts';
import type { ActionStatus } from '../../types/reconcile.ts';

/** Hand-rolled {@link AscOffersApi} fake */
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
  reorderedTo: readonly string[] | null = null;
  getAppId(): Promise<string | null> {
    return Promise.resolve(this.appId);
  }
  listSubscriptionGroups(): Promise<SubscriptionGroupResource[]> {
    return Promise.resolve(this.groups);
  }
  listSubscriptions(groupId: string): Promise<SubscriptionResource[]> {
    let subscriptions: SubscriptionResource[] = [];
    if (this.subsByGroup[groupId] != null) subscriptions = this.subsByGroup[groupId];
    return Promise.resolve(subscriptions);
  }
  listInAppPurchases(): Promise<InAppPurchaseResource[]> {
    return Promise.resolve(this.iaps);
  }
  findSubscriptionPricePoint(
    _subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    if (customerPrice == 999) return Promise.resolve(null);
    const asString = String(customerPrice);
    return Promise.resolve({
      id: `pp-${territory}-${customerPrice}`,
      customerPrice: asString,
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
    let inAppPurchaseId: string | null = null;
    if (input.inAppPurchaseId != null) inAppPurchaseId = input.inAppPurchaseId;
    let subscriptionId: string | null = null;
    if (input.subscriptionId != null) subscriptionId = input.subscriptionId;
    return Promise.resolve({
      id: `pp-new-${this.createdPromoted.length}`,
      inAppPurchaseId,
      subscriptionId,
      enabled: input.enabled,
      visibleForAllUsers: input.visibleForAllUsers,
    });
  }
  reorderPromotedPurchases(_appId: string, orderedIds: readonly string[]): Promise<void> {
    this.reorderedTo = orderedIds;
    return Promise.resolve();
  }
}
/** Execute the offers reconciler at the test boundary. */
function runReconcile(api: AscOffersApi, input: Parameters<typeof reconcileOffers>[1]) {
  return reconcileOffers(api, input);
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
function describeReconcileOffersOfferCodes() {
  async function createsAMissingOfferCodeWithItsPricesResolvedToPricePoints() {
    const api = new FakeOffersApi();
    const report = await runReconcile(api, {
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
  }

  it(
    'creates a missing offer code with its prices resolved to price points',
    createsAMissingOfferCodeWithItsPricesResolvedToPricePoints,
  );
  async function skipsAnOfferCodeThatAlreadyExistsMatchedByName() {
    const api = new FakeOffersApi();
    api.offerCodes = [{ id: 'oc-LAUNCH', name: 'LAUNCH', active: true }];
    const report = await runReconcile(api, {
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
  }

  it(
    'skips an offer code that already exists (matched by name)',
    skipsAnOfferCodeThatAlreadyExistsMatchedByName,
  );
  async function plansButDoesNotWriteOnADryRun() {
    const api = new FakeOffersApi();
    const report = await runReconcile(api, {
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
  }

  it('plans but does not write on a dry-run', plansButDoesNotWriteOnADryRun);
  async function skipsAFREETRIALOfferCodeThatWronglyCarriesAPrice() {
    const api = new FakeOffersApi();
    const report = await runReconcile(api, {
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
  }

  it(
    'skips a FREE_TRIAL offer code that wrongly carries a price',
    skipsAFREETRIALOfferCodeThatWronglyCarriesAPrice,
  );
  async function failsTheActionNotTheRunWhenADeclaredPriceMatchesNoPricePoint() {
    const api = new FakeOffersApi();
    const report = await runReconcile(api, {
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
  }

  it(
    'fails the action (not the run) when a declared price matches no price point',
    failsTheActionNotTheRunWhenADeclaredPriceMatchesNoPricePoint,
  );
}

describe('reconcileOffers - offer codes', describeReconcileOffersOfferCodes);
function describeReconcileOffersPromotionalIntroductoryWinBack() {
  async function createsEachDeclaredOfferKindThatSMissing() {
    const api = new FakeOffersApi();
    const report = await runReconcile(api, {
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
    function everyAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'applied';
    }

    expect(report.actions.every(everyAction)).toBe(true);
    expect(api.createdPromotional).toHaveLength(1);
    expect(api.introCreateCount).toBe(1);
    expect(api.createdWinBack).toHaveLength(1);
  }

  it("creates each declared offer kind that's missing", createsEachDeclaredOfferKindThatSMissing);
  async function skipsAWinBackOfferWhoseEligibilityWindowIsInverted() {
    const api = new FakeOffersApi();
    const report = await runReconcile(api, {
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
  }

  it(
    'skips a win-back offer whose eligibility window is inverted',
    skipsAWinBackOfferWhoseEligibilityWindowIsInverted,
  );
}

describe(
  'reconcileOffers - promotional / introductory / win-back',
  describeReconcileOffersPromotionalIntroductoryWinBack,
);
function describeReconcileOffersPromotedPurchases() {
  async function promotesAMissingProductAndReordersToTheDeclaredOrder() {
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
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      dryRun: false,
      products,
    });
    // The subscription isn't promoted yet -> created; then a reorder puts pro (new) before coins (existing).
    expect(api.createdPromoted).toHaveLength(1);
    expect(api.createdPromoted[0]?.subscriptionId).toBe('sub-1');
    function someAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.description.startsWith('reorder promoted purchases');
    }

    expect(report.actions.some(someAction)).toBe(true);
  }

  it(
    'promotes a missing product and reorders to the declared order',
    promotesAMissingProductAndReordersToTheDeclaredOrder,
  );
  async function skipsAPromotedProductThatMapsToNoSubscriptionOrIAP() {
    const api = new FakeOffersApi();
    const products: AppProducts = {
      ...productsWith({}),
      promotedPurchases: [{ productId: 'com.acme.ghost' }],
    };
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      dryRun: false,
      products,
    });
    expect(report.actions[0]?.status).toBe('skipped');
    expect(report.actions[0]?.description).toContain('com.acme.ghost');
    expect(api.createdPromoted).toHaveLength(0);
  }

  it(
    'skips a promoted product that maps to no subscription or IAP',
    skipsAPromotedProductThatMapsToNoSubscriptionOrIAP,
  );
}

describe('reconcileOffers - promoted purchases', describeReconcileOffersPromotedPurchases);
function describeReconcileOffersPreconditions() {
  async function skipsASubscriptionThatIsnTInAppStoreConnectYet() {
    const api = new FakeOffersApi();
    api.subsByGroup = { 'grp-1': [] };
    const report = await runReconcile(api, {
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
    expect(report.actions[0]?.description).toContain('launch-store sync');
  }

  it(
    "skips a subscription that isn't in App Store Connect yet",
    skipsASubscriptionThatIsnTInAppStoreConnectYet,
  );
  async function throwsWhenTheAppHasNoAppStoreConnectPiece() {
    const api = new FakeOffersApi();
    api.appId = null;
    const reconcile = runReconcile(api, {
      bundleId: 'com.acme.app',
      dryRun: false,
      products: productsWith({}),
    });
    await expect(reconcile).rejects.toThrow(/No App Store Connect app record/);
  }

  it(
    'throws when the app has no App Store Connect record',
    throwsWhenTheAppHasNoAppStoreConnectPiece,
  );
  async function skipsANonFREETRIALOfferCodeWithNoPrices() {
    const api = new FakeOffersApi();
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      dryRun: false,
      products: productsWith({
        offerCodes: [
          {
            name: 'NOPRICE',
            customerEligibilities: ['NEW'],
            offerEligibility: 'REPLACE_INTRO_OFFERS',
            duration: 'ONE_MONTH',
            offerMode: 'PAY_AS_YOU_GO',
            numberOfPeriods: 1,
          },
        ],
      }),
    });
    expect(report.actions[0]?.status).toBe('skipped');
    expect(report.actions[0]?.description).toContain('need at least one price');
    expect(api.createdOfferCodes).toHaveLength(0);
  }

  it('skips a non-FREE_TRIAL offer code with no prices', skipsANonFREETRIALOfferCodeWithNoPrices);
  async function skipsAPromotionalOfferThatAlreadyExistsMatchedByOfferCode() {
    const api = new FakeOffersApi();
    api.promotionalOffers = [{ id: 'po-1', name: 'Loyalty', offerCode: 'loyalty10' }];
    const report = await runReconcile(api, {
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
      }),
    });
    expect(report.actions).toHaveLength(0);
    expect(api.createdPromotional).toHaveLength(0);
  }

  it(
    'skips a promotional offer that already exists (matched by offerCode)',
    skipsAPromotionalOfferThatAlreadyExistsMatchedByOfferCode,
  );
}

describe('reconcileOffers - preconditions', describeReconcileOffersPreconditions);
function describeAppDeclaresOffers() {
  function isFalseForEmptyCatalogsAndPlainSubscriptions() {
    expect(appDeclaresOffers({})).toBe(false);
    expect(appDeclaresOffers(productsWith({}))).toBe(false);
  }

  it(
    'is false for empty catalogs and plain subscriptions',
    isFalseForEmptyCatalogsAndPlainSubscriptions,
  );
  function isTrueForAnySubscriptionOfferKindOrPromotedPurchaseOrdering() {
    expect(
      appDeclaresOffers(
        productsWith({
          offerCodes: [
            {
              name: 'LAUNCH',
              customerEligibilities: ['NEW'],
              offerEligibility: 'REPLACE_INTRO_OFFERS',
              duration: 'ONE_WEEK',
              offerMode: 'FREE_TRIAL',
              numberOfPeriods: 1,
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      appDeclaresOffers({
        promotedPurchases: [{ productId: 'com.acme.pro' }],
      }),
    ).toBe(true);
  }

  it(
    'is true for any subscription offer kind or promoted-purchase ordering',
    isTrueForAnySubscriptionOfferKindOrPromotedPurchaseOrdering,
  );
}

describe('appDeclaresOffers', describeAppDeclaresOffers);
