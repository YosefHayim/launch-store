import { describe, expect, it } from 'vitest';
import type { SubscriptionOfferResource, SubscriptionResource } from '@/types/google-play.js';
import type { SubscriptionConfig } from '@/types/catalog.js';
import { expectArrayElement } from '@/testkit/assertions-testkit.js';
import {
  type PlaySubscriptionsApi,
  microsToMoney,
  offerFromConfig,
  periodFromIso,
  reconcilePlaySubscriptions,
  summarizePlaySubscriptions,
  unitsToMicros,
} from './play-subscriptions.ts';
import type { ActionStatus } from '@/types/reconcile.js';

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
  listOffersFailures: number;
};

/** A hand-rolled {@link PlaySubscriptionsApi} - no network - serving `existing` and recording writes. */
function makeApi(
  existing: SubscriptionResource[],
  options: {
    reachable?: boolean;
    offersByBasePlan?: Record<string, SubscriptionOfferResource[]>;
    failCreateSubscription?: boolean;
    createSubscriptionFailure?: string;
    failCreateOffer?: boolean;
    failListOffers?: boolean;
  } = {},
): {
  api: PlaySubscriptionsApi;
  calls: Calls;
} {
  const calls: Calls = {
    created: [],
    patched: [],
    activatedBasePlans: [],
    createdOffers: [],
    activatedOffers: [],
    listOffersFailures: 0,
  };
  const api: PlaySubscriptionsApi = {
    async assertAppExists() {
      if (options.reachable == false) throw new Error('No reachable Play app');
    },
    async listSubscriptions() {
      return existing;
    },
    async createSubscription(_packageName, subscription) {
      if (options.createSubscriptionFailure != null) {
        throw new Error(options.createSubscriptionFailure);
      }

      if (options.failCreateSubscription == true) {
        throw new Error('create subscription rejected');
      }

      calls.created.push(subscription);
    },
    async patchSubscription(_packageName, subscription, updateMask) {
      calls.patched.push({ subscription, updateMask });
    },
    async activateBasePlan(_packageName, productId, basePlanId) {
      calls.activatedBasePlans.push({ productId, basePlanId });
    },
    async listSubscriptionOffers(_packageName, productId, basePlanId) {
      if (options.failListOffers == true) {
        calls.listOffersFailures += 1;
        throw new Error('list offers unavailable');
      }

      let offers: SubscriptionOfferResource[] = [];
      const configuredOffers = options.offersByBasePlan?.[`${productId}/${basePlanId}`];

      if (configuredOffers != null) offers = configuredOffers;

      return offers;
    },
    async createSubscriptionOffer(_packageName, offer) {
      if (options.failCreateOffer == true) {
        throw new Error('create offer rejected');
      }

      calls.createdOffers.push(offer);
    },
    async activateSubscriptionOffer(_packageName, productId, basePlanId, offerId) {
      calls.activatedOffers.push({ productId, basePlanId, offerId });
    },
  };

  return { api, calls };
}

/** Execute the offer builder at the test boundary. */
function runOffer(...offerInput: Parameters<typeof offerFromConfig>): SubscriptionOfferResource {
  return offerFromConfig(...offerInput);
}

/** Execute the subscriptions reconciler at the test boundary. */
function runReconcile(
  api: PlaySubscriptionsApi,
  input: Parameters<typeof reconcilePlaySubscriptions>[1],
) {
  return reconcilePlaySubscriptions(api, input);
}

/** A minimal shared subscription config with a Play override. */
function sub(overrides: Partial<SubscriptionConfig> = {}): SubscriptionConfig {
  return {
    productId: 'com.acme.pro.monthly',
    referenceName: 'Pro Monthly',
    subscriptionPeriod: 'ONE_MONTH',
    localizations: [{ locale: 'en-US', name: 'Pro Monthly', description: 'All features' }],
    play: { prices: { US: { priceMicros: '9990000', currency: 'USD' } } },
    ...overrides,
  };
}
function describePeriodFromIso() {
  function mapsEveryKnownISODurationAndRejectsUnknowns() {
    expect(periodFromIso('P1W')).toBe('ONE_WEEK');
    expect(periodFromIso('P1M')).toBe('ONE_MONTH');
    expect(periodFromIso('P2M')).toBe('TWO_MONTHS');
    expect(periodFromIso('P3M')).toBe('THREE_MONTHS');
    expect(periodFromIso('P6M')).toBe('SIX_MONTHS');
    expect(periodFromIso('P1Y')).toBe('ONE_YEAR');
    expect(periodFromIso('P99Y')).toBeUndefined();
  }

  it(
    'maps every known ISO duration and rejects unknowns',
    mapsEveryKnownISODurationAndRejectsUnknowns,
  );
}

describe('periodFromIso', describePeriodFromIso);
function describeMicrosToMoneyUnitsToMicros() {
  function splitsMicroUnitsIntoWholeUnitsAndBillionths() {
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
  }

  it(
    'splits micro-units into whole units and billionths',
    splitsMicroUnitsIntoWholeUnitsAndBillionths,
  );

  function roundTripsUnitsNanosBackToMicroUnits() {
    const money = microsToMoney({ priceMicros: '1990000', currency: 'USD' });
    expect(unitsToMicros(money)).toBe('1990000');
  }

  it('round-trips units+nanos back to micro-units', roundTripsUnitsNanosBackToMicroUnits);
}

describe('microsToMoney / unitsToMicros', describeMicrosToMoneyUnitsToMicros);
function describeOfferFromPiece() {
  function buildsAFreeTrialOfferCoveringTheBasePlanSRegions() {
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
  }

  it(
    "builds a free-trial offer covering the base plan's regions",
    buildsAFreeTrialOfferCoveringTheBasePlanSRegions,
  );

  function buildsAnIntroductoryPriceOfferOverThePricedRegions() {
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
  }

  it(
    'builds an introductory-price offer over the priced regions',
    buildsAnIntroductoryPriceOfferOverThePricedRegions,
  );

  function intersectsRegionsWhenAnOfferHasBothATrialAndAnIntroPhase() {
    const offer = runOffer('com.acme.pro', 'p1m', ['US', 'GB'], {
      offerId: 'combo',
      freeTrialDuration: 'P3D',
      introPrices: { US: { priceMicros: '4990000', currency: 'USD' } },
    });

    expect(offer.regionalConfigs).toEqual([{ regionCode: 'US', newSubscriberAvailability: true }]);
    expect(offer.phases[0]?.regionalConfigs).toEqual([{ regionCode: 'US', free: {} }]);
  }

  it(
    'intersects regions when an offer has both a trial and an intro phase',
    intersectsRegionsWhenAnOfferHasBothATrialAndAnIntroPhase,
  );

  function rejectsAnOfferThatDiscountsNothingAndOneWhosePhasesShareNoRegion() {
    function callOfferFromPiece() {
      return offerFromConfig('p', 'bp', ['US'], { offerId: 'empty' });
    }

    expect(callOfferFromPiece).toThrow(/neither a free trial nor intro/);

    function callOfferFromPiece2() {
      return offerFromConfig('p', 'bp', ['GB'], {
        offerId: 'split',
        freeTrialDuration: 'P1W',
        introPrices: { US: { priceMicros: '1', currency: 'USD' } },
      });
    }

    expect(callOfferFromPiece2).toThrow(/no region common/);
  }

  it(
    'rejects an offer that discounts nothing and one whose phases share no region',
    rejectsAnOfferThatDiscountsNothingAndOneWhosePhasesShareNoRegion,
  );
}

describe('offerFromConfig', describeOfferFromPiece);

describe('reconcilePlaySubscriptions', () => {
  async function throwsWhenThePlayAppPieceIsUnreachable() {
    const { api } = makeApi([], { reachable: false });
    const reconcile = runReconcile(api, {
      packageName: 'com.acme.app',
      subscriptions: [sub()],
      dryRun: true,
    });

    await expect(reconcile).rejects.toThrow(/No reachable Play app/);
  }

  it('throws when the Play app record is unreachable', throwsWhenThePlayAppPieceIsUnreachable);

  async function skipsCatalogSubscriptionsWithoutAPlayOverride() {
    const { api, calls } = makeApi([]);
    const appleOnlySubscription: SubscriptionConfig = {
      productId: 'com.acme.pro.monthly',
      referenceName: 'Pro Monthly',
      subscriptionPeriod: 'ONE_MONTH',
      localizations: [{ locale: 'en-US', name: 'Pro Monthly', description: 'All features' }],
    };
    const subscriptionsOutcome = await runReconcile(api, {
      packageName: 'com.acme.app',
      subscriptions: [appleOnlySubscription],
      dryRun: false,
    });

    expect(subscriptionsOutcome.actions).toEqual([]);
    expect(calls.created).toHaveLength(0);
  }

  it(
    'skips catalog subscriptions without a play override',
    skipsCatalogSubscriptionsWithoutAPlayOverride,
  );

  async function createsASubscriptionBasePlanActivatesThePlanThenCreatesActivatesItsOffers() {
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

    const playSubscriptions = summarizePlaySubscriptions(subscriptionsOutcome.actions);

    expect(playSubscriptions.failed).toBe(0);
  }

  it(
    'creates a subscription + base plan, activates the plan, then creates + activates its offers',
    createsASubscriptionBasePlanActivatesThePlanThenCreatesActivatesItsOffers,
  );

  async function honorsPlayProductIdAndPlayBasePlanIdOverrides() {
    const { api, calls } = makeApi([]);

    await runReconcile(api, {
      packageName: 'com.acme.app',
      subscriptions: [
        sub({
          play: {
            productId: 'pro_monthly_play',
            basePlanId: 'monthly-v2',
            prices: { US: { priceMicros: '9990000', currency: 'USD' } },
          },
        }),
      ],
      dryRun: false,
    });

    const created = expectArrayElement(calls.created, 0, 'calls.created');

    expect(created.productId).toBe('pro_monthly_play');
    expect(created.basePlans?.[0]?.basePlanId).toBe('monthly-v2');
    expect(calls.activatedBasePlans).toEqual([
      { productId: 'pro_monthly_play', basePlanId: 'monthly-v2' },
    ]);
  }

  it(
    'honors play.productId and play.basePlanId overrides',
    honorsPlayProductIdAndPlayBasePlanIdOverrides,
  );

  async function fallsBackToTheLocalizationNameWhenDescriptionIsOmitted() {
    const { api, calls } = makeApi([]);

    await runReconcile(api, {
      packageName: 'com.acme.app',
      subscriptions: [
        sub({
          localizations: [{ locale: 'en-US', name: 'Pro Monthly' }],
        }),
      ],
      dryRun: false,
    });

    const created = expectArrayElement(calls.created, 0, 'calls.created');

    expect(created.listings).toEqual([
      { languageCode: 'en-US', title: 'Pro Monthly', description: 'Pro Monthly' },
    ]);
  }

  it(
    'falls back to the localization name when description is omitted',
    fallsBackToTheLocalizationNameWhenDescriptionIsOmitted,
  );

  async function doesNothingWhenTheSubscriptionBasePlanAndListingsAlreadyPiece() {
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
  }

  it(
    'does nothing when the subscription, base plan, and listings already match',
    doesNothingWhenTheSubscriptionBasePlanAndListingsAlreadyPiece,
  );

  async function patchesListingsMaskListingsWhenATitleDriftsPreservingLocalesItDoesnTManage() {
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

    if (patchedListings == null) patchedListings = [];

    function readLanguageCode(listing: {
      readonly languageCode: string;
      readonly title: string;
      readonly description: string;
      readonly benefits?: readonly string[];
    }) {
      return listing.languageCode;
    }

    const languages = patchedListings.map(readLanguageCode).sort();

    expect(languages).toEqual(['de-DE', 'en-US']);
  }

  it(
    "patches listings (mask 'listings') when a title drifts, preserving locales it doesn't manage",
    patchesListingsMaskListingsWhenATitleDriftsPreservingLocalesItDoesnTManage,
  );

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

    if (sentPlans == null) sentPlans = [];

    expect(sentPlans.map((basePlan) => basePlan.basePlanId)).toEqual(['p1y', 'p1m']);
    expect(sentPlans.find((basePlan) => basePlan.basePlanId == 'p1y')?.state).toBeUndefined();
    expect(calls.activatedBasePlans).toEqual([
      { productId: 'com.acme.pro.monthly', basePlanId: 'p1m' },
    ]);
  });

  async function activatesABasePlanThatExistsButIsStillDRAFT() {
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
  }

  it(
    'activates a base plan that exists but is still DRAFT',
    activatesABasePlanThatExistsButIsStillDRAFT,
  );

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

  it('treats a failed offer list as empty and still creates missing offers', async () => {
    const existing: SubscriptionResource = {
      productId: 'com.acme.pro.monthly',
      listings: [{ languageCode: 'en-US', title: 'Pro Monthly', description: 'All features' }],
      basePlans: [{ basePlanId: 'p1m', state: 'ACTIVE' }],
    };
    const { api, calls } = makeApi([existing], { failListOffers: true });

    await runReconcile(api, {
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
    expect(calls.listOffersFailures).toBe(1);
    expect(calls.createdOffers.map((offer) => offer.offerId)).toEqual(['trial']);
  });

  async function plansWithoutWritingOnADryRunIncludingCreateActivateForOffers() {
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
      dryRun: true,
    });

    function isPlannedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'planned';
    }

    expect(subscriptionsOutcome.actions.every(isPlannedAction)).toBe(true);

    function readDescription(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.description;
    }

    expect(subscriptionsOutcome.actions.map(readDescription)).toEqual(
      expect.arrayContaining([
        'create Play subscription com.acme.pro.monthly',
        'activate base plan p1m',
        'create offer trial on base plan p1m',
        'activate offer trial',
      ]),
    );
    expect(calls.created).toHaveLength(0);
    expect(calls.createdOffers).toHaveLength(0);
  }

  it(
    'plans without writing on a dry run, including create+activate for offers',
    plansWithoutWritingOnADryRunIncludingCreateActivateForOffers,
  );

  async function recordsAFailedActionForAnOfferPieceThatDiscountsNothingWithoutAborting() {
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

    function isFailedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'failed';
    }

    const failedAction = subscriptionsOutcome.actions.find(isFailedAction);

    expect(failedAction?.error).toMatch(/neither a free trial nor intro/);
    expect(calls.created).toHaveLength(1);
  }

  it(
    'records a failed action for an offer config that discounts nothing, without aborting',
    recordsAFailedActionForAnOfferPieceThatDiscountsNothingWithoutAborting,
  );

  async function skipsDependentWritesAndDiagnosesKnownSubscriptionCreateFailures() {
    const { api, calls } = makeApi([], { failCreateSubscription: true });
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

    expect(calls.created).toHaveLength(0);
    expect(calls.activatedBasePlans).toHaveLength(0);
    expect(calls.createdOffers).toHaveLength(0);

    const summary = summarizePlaySubscriptions(subscriptionsOutcome.actions);

    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);

    const { api: permissionFailureApi } = makeApi([], {
      createSubscriptionFailure: 'The caller does not have permission',
    });
    const permissionFailureOutcome = await runReconcile(permissionFailureApi, {
      packageName: 'com.acme.app',
      serviceAccountEmail: 'launch-catalog@proj.iam.gserviceaccount.com',
      subscriptions: [sub()],
      dryRun: false,
    });

    function isFailedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'failed';
    }

    const permissionFailureAction = permissionFailureOutcome.actions.find(isFailedAction);

    expect(permissionFailureAction?.error).toContain('launch-catalog@proj.iam.gserviceaccount.com');
    expect(permissionFailureAction?.error).toContain('Manage store presence');
    expect(permissionFailureAction?.error).toContain('Users and permissions');
    expect(permissionFailureAction?.error).toContain(
      'https://play.google.com/console/developers/users-and-permissions',
    );
    expect(permissionFailureAction?.error).toContain('Admin (all permissions)');
    expect(permissionFailureAction?.error).toContain('View financial data');
    expect(permissionFailureAction?.error).toContain('Manage orders and subscriptions');
    expect(permissionFailureAction?.error).not.toContain('Permissions Declaration');

    const { api: paymentsFailureApi } = makeApi([], {
      createSubscriptionFailure:
        'Cannot create a subscription without first registering a payments profile for the developer account.',
    });
    const paymentsFailureOutcome = await runReconcile(paymentsFailureApi, {
      packageName: 'com.acme.app',
      serviceAccountEmail: 'launch-catalog@proj.iam.gserviceaccount.com',
      subscriptions: [sub()],
      dryRun: false,
    });

    function hasFailedStatus(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'failed';
    }

    const paymentsFailureAction = paymentsFailureOutcome.actions.find(hasFailedStatus);

    expect(paymentsFailureAction?.error).toContain('Setup > Payments profile');
    expect(paymentsFailureAction?.error).toContain(
      'https://play.google.com/console/developers/paymentssettings',
    );
    expect(paymentsFailureAction?.error).toContain(
      'rerun your original `launch-store play-subscriptions` command',
    );
    expect(paymentsFailureAction?.error).not.toContain('--app com.acme.app');
  }

  it(
    'skips dependent writes and diagnoses known subscription create failures',
    skipsDependentWritesAndDiagnosesKnownSubscriptionCreateFailures,
  );

  async function skipsOfferActivateWhenOfferCreateFails() {
    const existing: SubscriptionResource = {
      productId: 'com.acme.pro.monthly',
      listings: [{ languageCode: 'en-US', title: 'Pro Monthly', description: 'All features' }],
      basePlans: [{ basePlanId: 'p1m', state: 'ACTIVE' }],
    };
    const { api, calls } = makeApi([existing], { failCreateOffer: true });
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

    expect(calls.createdOffers).toHaveLength(0);
    expect(calls.activatedOffers).toHaveLength(0);

    const summary = summarizePlaySubscriptions(subscriptionsOutcome.actions);

    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
  }

  it('skips offer activate when offer create fails', skipsOfferActivateWhenOfferCreateFails);
});
