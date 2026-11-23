import { describe, expect, it, vi } from 'vitest';
import {
  reconcileApp,
  reconcileAppListing,
  type AscCatalogApi,
  type ListingReconcileInput,
  type ReconcileInput,
} from './app-store-sync.ts';
import type { AppleStoreConfig } from '@/store/shared/store-config.js';
import type { AppProducts, InAppPurchaseConfig, SubscriptionGroupConfig } from '@/types/catalog.js';
import { expectArrayElement } from '@/testkit/assertions-testkit.js';
import type { ActionStatus } from '@/types/reconcile.js';

/** Promise fake of {@link AscCatalogApi}. Reads default to "nothing exists yet"; writes resolve to a created resource. */
function makeApi(overrides: Partial<AscCatalogApi> = {}): AscCatalogApi {
  function mockCall() {
    return Promise.resolve('app1');
  }

  function mockCall2() {
    return Promise.resolve({ id: 'bundle1', identifier: 'com.acme.app' });
  }

  function mockCall3() {
    return Promise.resolve([]);
  }

  function mockImplementationBundleIdResourceId(
    _bundleIdResourceId: string,
    capabilityType: string,
  ) {
    return Promise.resolve({ id: 'cap-new', capabilityType });
  }

  function mockCall4() {
    return Promise.resolve();
  }

  function mockCall5() {
    return Promise.resolve([]);
  }

  function mockImplementationAppId(
    _appId: string,
    purchase: {
      productId: string;
      name: string;
      inAppPurchaseType: string;
    },
  ) {
    return Promise.resolve({
      id: 'iap-new',
      productId: purchase.productId,
      name: purchase.name,
      inAppPurchaseType: purchase.inAppPurchaseType,
    });
  }

  function mockCall6() {
    return Promise.resolve([]);
  }

  function mockImplementationIapId(
    _iapId: string,
    localization: {
      locale: string;
      name: string;
    },
  ) {
    return Promise.resolve({ id: 'iloc', locale: localization.locale, name: localization.name });
  }

  function mockCall7() {
    return Promise.resolve(false);
  }

  function mockImplementationIapId2(_iapId: string, territory: string, price: number) {
    const asString = String(price);
    return Promise.resolve({ id: 'ipp', customerPrice: asString, territory });
  }

  function mockCall8() {
    return Promise.resolve();
  }

  function mockCall9() {
    return Promise.resolve([]);
  }

  function mockImplementationAppId2(_appId: string, referenceName: string) {
    return Promise.resolve({ id: 'grp-new', referenceName });
  }

  function mockCall10() {
    return Promise.resolve([]);
  }

  function mockImplementationGroupId(
    _groupId: string,
    localization: {
      locale: string;
      name: string;
    },
  ) {
    return Promise.resolve({ id: 'gloc', locale: localization.locale, name: localization.name });
  }

  function mockCall11() {
    return Promise.resolve([]);
  }

  function mockImplementationGroupId2(
    _groupId: string,
    subscription: {
      productId: string;
      name: string;
    },
  ) {
    return Promise.resolve({
      id: 'sub-new',
      productId: subscription.productId,
      name: subscription.name,
    });
  }

  function mockCall12() {
    return Promise.resolve([]);
  }

  function mockImplementationSubscriptionId(
    _subscriptionId: string,
    localization: {
      locale: string;
      name: string;
    },
  ) {
    return Promise.resolve({ id: 'sloc', locale: localization.locale, name: localization.name });
  }

  function mockCall13() {
    return Promise.resolve(false);
  }

  function mockImplementationSubscriptionId2(
    _subscriptionId: string,
    territory: string,
    price: number,
  ) {
    const asString = String(price);
    return Promise.resolve({ id: 'spp', customerPrice: asString, territory });
  }

  function mockCall14() {
    return Promise.resolve();
  }

  function mockCall15() {
    return Promise.resolve('appinfo1');
  }

  function mockCall16() {
    return Promise.resolve([]);
  }

  function mockCall17() {
    return Promise.resolve();
  }

  function mockCall18() {
    return Promise.resolve();
  }

  function mockCall19() {
    return Promise.resolve('version1');
  }

  function mockCall20() {
    return Promise.resolve([]);
  }

  function mockCall21() {
    return Promise.resolve();
  }

  function mockCall22() {
    return Promise.resolve();
  }

  const base: AscCatalogApi = {
    getAppId: vi.fn(mockCall),
    findBundleId: vi.fn(mockCall2),
    listBundleIdCapabilities: vi.fn(mockCall3),
    enableCapability: vi.fn().mockImplementation(mockImplementationBundleIdResourceId),
    disableCapability: vi.fn(mockCall4),
    listInAppPurchases: vi.fn(mockCall5),
    createInAppPurchase: vi.fn().mockImplementation(mockImplementationAppId),
    listInAppPurchaseLocalizations: vi.fn(mockCall6),
    createInAppPurchaseLocalization: vi.fn().mockImplementation(mockImplementationIapId),
    inAppPurchaseHasPrice: vi.fn(mockCall7),
    findInAppPurchasePricePoint: vi.fn().mockImplementation(mockImplementationIapId2),
    createInAppPurchasePriceSchedule: vi.fn(mockCall8),
    listSubscriptionGroups: vi.fn(mockCall9),
    createSubscriptionGroup: vi.fn().mockImplementation(mockImplementationAppId2),
    listSubscriptionGroupLocalizations: vi.fn(mockCall10),
    createSubscriptionGroupLocalization: vi.fn().mockImplementation(mockImplementationGroupId),
    listSubscriptions: vi.fn(mockCall11),
    createSubscription: vi.fn().mockImplementation(mockImplementationGroupId2),
    listSubscriptionLocalizations: vi.fn(mockCall12),
    createSubscriptionLocalization: vi.fn().mockImplementation(mockImplementationSubscriptionId),
    subscriptionHasPrice: vi.fn(mockCall13),
    findSubscriptionPricePoint: vi.fn().mockImplementation(mockImplementationSubscriptionId2),
    createSubscriptionPrice: vi.fn(mockCall14),
    getEditableAppInfoId: vi.fn(mockCall15),
    listAppInfoLocalizations: vi.fn(mockCall16),
    createAppInfoLocalization: vi.fn(mockCall17),
    updateAppInfoLocalization: vi.fn(mockCall18),
    getEditableVersionId: vi.fn(mockCall19),
    listVersionLocalizations: vi.fn(mockCall20),
    createVersionLocalization: vi.fn(mockCall21),
    updateVersionLocalization: vi.fn(mockCall22),
  };

  return { ...base, ...overrides };
}

const IAPS: InAppPurchaseConfig[] = [
  {
    productId: 'com.acme.coins',
    referenceName: 'Coins',
    type: 'CONSUMABLE',
    localizations: [{ locale: 'en-US', name: 'Coins' }],
    price: { customerPrice: 4.99 },
  },
];

const SUBSCRIPTION_GROUPS: SubscriptionGroupConfig[] = [
  {
    referenceName: 'Pro',
    localizations: [{ locale: 'en-US', name: 'Pro Tiers' }],
    subscriptions: [
      {
        productId: 'com.acme.pro.monthly',
        referenceName: 'Pro Monthly',
        subscriptionPeriod: 'ONE_MONTH',
        localizations: [{ locale: 'en-US', name: 'Pro' }],
        price: { customerPrice: 9.99 },
      },
    ],
  },
];

function input(overrides: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    bundleId: 'com.acme.app',
    capabilities: ['PUSH_NOTIFICATIONS'],
    products: { inAppPurchases: IAPS, subscriptionGroups: SUBSCRIPTION_GROUPS },
    dryRun: false,
    allowDestructive: false,
    ...overrides,
  };
}

/** Execute the full catalog reconciler at the test boundary. */
function runReconcile(api: AscCatalogApi, reconcileInput: ReconcileInput) {
  return reconcileApp(api, reconcileInput);
}

/** Execute the listing-only reconciler (plan listing / snapshot surface). */
function runListingReconcile(api: AscCatalogApi, listingInput: ListingReconcileInput) {
  return reconcileAppListing(api, listingInput);
}

function describeReconcileApp() {
  async function plansEveryCreateFromAnEmptyAccountWithoutPerformingAnyWritesDryRun() {
    const api = makeApi();
    const report = await runReconcile(api, input({ dryRun: true }));

    function readDescription(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.description;
    }

    const descriptions = report.actions.map(readDescription);

    expect(descriptions).toEqual([
      'enable capability PUSH_NOTIFICATIONS',
      'create in-app purchase com.acme.coins (CONSUMABLE)',
      'add IAP copy com.acme.coins [en-US]',
      'set IAP price com.acme.coins = 4.99 (USA)',
      'create subscription group "Pro"',
      'add group name "Pro" [en-US]',
      'create subscription com.acme.pro.monthly (ONE_MONTH)',
      'add subscription copy com.acme.pro.monthly [en-US]',
      'set subscription price com.acme.pro.monthly = 9.99 (USA)',
    ]);

    function isPlannedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'planned';
    }

    expect(report.actions.every(isPlannedAction)).toBe(true);
    expect(api.enableCapability).not.toHaveBeenCalled();
    expect(api.createInAppPurchase).not.toHaveBeenCalled();
    expect(api.createSubscription).not.toHaveBeenCalled();
  }

  it(
    'plans every create from an empty account without performing any writes (dry-run)',
    plansEveryCreateFromAnEmptyAccountWithoutPerformingAnyWritesDryRun,
  );

  async function appliesEveryCreateAgainstAnEmptyAccountInDependencyOrder() {
    const api = makeApi();
    const report = await runReconcile(api, input());

    function isAppliedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'applied';
    }

    expect(report.actions.every(isAppliedAction)).toBe(true);
    expect(api.enableCapability).toHaveBeenCalledWith('bundle1', 'PUSH_NOTIFICATIONS');
    expect(api.createInAppPurchase).toHaveBeenCalledWith('app1', {
      productId: 'com.acme.coins',
      name: 'Coins',
      inAppPurchaseType: 'CONSUMABLE',
    });
    expect(api.createInAppPurchasePriceSchedule).toHaveBeenCalledWith('iap-new', 'USA', 'ipp');
    expect(api.createSubscription).toHaveBeenCalledWith('grp-new', {
      productId: 'com.acme.pro.monthly',
      name: 'Pro Monthly',
      subscriptionPeriod: 'ONE_MONTH',
      groupLevel: 1,
    });
    expect(api.createSubscriptionPrice).toHaveBeenCalledWith('sub-new', 'spp');
  }

  it(
    'applies every create against an empty account, in dependency order',
    appliesEveryCreateAgainstAnEmptyAccountInDependencyOrder,
  );

  async function isAdditiveExistingProductsLocalizationsCapabilitiesAndPricesAreLeftUntouched() {
    const api = makeApi({
      listBundleIdCapabilities: vi
        .fn()
        .mockResolvedValue([{ id: 'c1', capabilityType: 'PUSH_NOTIFICATIONS' }]),
      listInAppPurchases: vi.fn().mockResolvedValue([
        {
          id: 'iap1',
          productId: 'com.acme.coins',
          name: 'Coins',
          inAppPurchaseType: 'CONSUMABLE',
        },
      ]),
      listInAppPurchaseLocalizations: vi
        .fn()
        .mockResolvedValue([{ id: 'l1', locale: 'en-US', name: 'Coins' }]),
      inAppPurchaseHasPrice: vi.fn().mockResolvedValue(true),
      listSubscriptionGroups: vi.fn().mockResolvedValue([{ id: 'grp1', referenceName: 'Pro' }]),
      listSubscriptionGroupLocalizations: vi
        .fn()
        .mockResolvedValue([{ id: 'gl1', locale: 'en-US', name: 'Pro Tiers' }]),
      listSubscriptions: vi
        .fn()
        .mockResolvedValue([
          { id: 'sub1', productId: 'com.acme.pro.monthly', name: 'Pro Monthly' },
        ]),
      listSubscriptionLocalizations: vi
        .fn()
        .mockResolvedValue([{ id: 'sl1', locale: 'en-US', name: 'Pro' }]),
      subscriptionHasPrice: vi.fn().mockResolvedValue(true),
    });
    const report = await runReconcile(api, input());

    expect(report.actions).toEqual([]);
    expect(api.enableCapability).not.toHaveBeenCalled();
    expect(api.createInAppPurchase).not.toHaveBeenCalled();
    expect(api.createInAppPurchaseLocalization).not.toHaveBeenCalled();
    expect(api.createInAppPurchasePriceSchedule).not.toHaveBeenCalled();
    expect(api.createSubscription).not.toHaveBeenCalled();
    expect(api.createSubscriptionPrice).not.toHaveBeenCalled();
  }

  it(
    'is additive: existing products, localizations, capabilities, and prices are left untouched',
    isAdditiveExistingProductsLocalizationsCapabilitiesAndPricesAreLeftUntouched,
  );

  async function gatesCapabilityRemovalBehindAllowDestructive() {
    const withExtra = {
      listBundleIdCapabilities: vi
        .fn()
        .mockResolvedValue([{ id: 'c-extra', capabilityType: 'HEALTHKIT' }]),
    };
    const guarded = makeApi(withExtra);
    const guardedReport = await runReconcile(guarded, input());

    function isHealthKitDisable(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.description == 'disable capability HEALTHKIT';
    }

    const disable = guardedReport.actions.find(isHealthKitDisable);

    expect(disable).toMatchObject({ destructive: true, status: 'skipped' });
    expect(guarded.disableCapability).not.toHaveBeenCalled();

    const allowed = makeApi(withExtra);

    await runReconcile(allowed, input({ allowDestructive: true }));
    expect(allowed.disableCapability).toHaveBeenCalledWith('c-extra');
  }

  it(
    'gates capability removal behind allowDestructive',
    gatesCapabilityRemovalBehindAllowDestructive,
  );

  async function neverProposesRemovingAppleSAlwaysOnCapabilitiesINAPPPURCHASEGAMECENTER() {
    const api = makeApi({
      listBundleIdCapabilities: vi.fn().mockResolvedValue([
        { id: 'c1', capabilityType: 'IN_APP_PURCHASE' },
        { id: 'c2', capabilityType: 'GAME_CENTER' },
      ]),
    });
    const report = await runReconcile(api, input({ capabilities: [] }));

    function isDestructive(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.destructive;
    }

    expect(report.actions.filter(isDestructive)).toEqual([]);
  }

  it(
    "never proposes removing Apple's always-on capabilities (IN_APP_PURCHASE / GAME_CENTER)",
    neverProposesRemovingAppleSAlwaysOnCapabilitiesINAPPPURCHASEGAMECENTER,
  );

  async function throwsAnActionableErrorWhenTheAppHasNoAppStoreConnectPiece() {
    const api = makeApi({ getAppId: vi.fn().mockResolvedValue(null) });
    const reconcile = runReconcile(api, input());
    await expect(reconcile).rejects.toThrow(/No App Store Connect app record.*Apple has no API/s);
  }

  it(
    'throws an actionable error when the app has no App Store Connect record',
    throwsAnActionableErrorWhenTheAppHasNoAppStoreConnectPiece,
  );

  async function skipsCapabilitiesWithoutFailingWhenTheBundleIdIsnTRegisteredYet() {
    const api = makeApi({ findBundleId: vi.fn().mockResolvedValue(null) });
    const report = await runReconcile(api, input({ products: {} }));

    expect(report.actions).toHaveLength(1);
    expect(report.actions[0]).toMatchObject({ status: 'skipped' });

    const arrayElement = expectArrayElement(report.actions, 0, 'report.actions');

    expect(arrayElement.description).toContain('not registered yet');
    expect(api.enableCapability).not.toHaveBeenCalled();
  }

  it(
    "skips capabilities (without failing) when the bundle id isn't registered yet",
    skipsCapabilitiesWithoutFailingWhenTheBundleIdIsnTRegisteredYet,
  );

  async function isolatesAFailingActionNoMatchingPricePointAndStillAppliesTheRest() {
    const api = makeApi({
      findInAppPurchasePricePoint: vi.fn().mockResolvedValue(null),
    });
    const report = await runReconcile(
      api,
      input({ capabilities: [], products: { inAppPurchases: IAPS } }),
    );

    function isIapPriceAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.description.startsWith('set IAP price');
    }

    const priceAction = report.actions.find(isIapPriceAction);

    expect(priceAction).toMatchObject({ status: 'failed' });
    expect(priceAction?.error).toMatch(/No USA price point matches 4.99/);
    // The create + localization before it still went through - one failure doesn't abort the walk.
    expect(api.createInAppPurchase).toHaveBeenCalled();
    expect(api.createInAppPurchaseLocalization).toHaveBeenCalled();
    expect(api.createInAppPurchasePriceSchedule).not.toHaveBeenCalled();
  }

  it(
    'isolates a failing action (no matching price point) and still applies the rest',
    isolatesAFailingActionNoMatchingPricePointAndStillAppliesTheRest,
  );

  async function skipsANewProductSDependentWorkWhenItsCreationFails() {
    const api = makeApi({
      createInAppPurchase: vi.fn().mockRejectedValue(new Error('duplicate productId')),
    });
    const report = await runReconcile(
      api,
      input({ capabilities: [], products: { inAppPurchases: IAPS } }),
    );

    function readActionBrief(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return { d: action.description, s: action.status };
    }

    expect(report.actions.map(readActionBrief)).toEqual([
      { d: 'create in-app purchase com.acme.coins (CONSUMABLE)', s: 'failed' },
    ]);
    expect(api.createInAppPurchaseLocalization).not.toHaveBeenCalled();
    expect(api.findInAppPurchasePricePoint).not.toHaveBeenCalled();
  }

  it(
    "skips a new product's dependent work when its creation fails",
    skipsANewProductSDependentWorkWhenItsCreationFails,
  );

  async function assignsGroupLevelsFromPieceOrderFirstSubscriptionLevel1() {
    const api = makeApi();
    const twoTiers: AppProducts = {
      subscriptionGroups: [
        {
          referenceName: 'Pro',
          localizations: [{ locale: 'en-US', name: 'Pro' }],
          subscriptions: [
            {
              productId: 'com.acme.pro.yearly',
              referenceName: 'Yearly',
              subscriptionPeriod: 'ONE_YEAR',
              localizations: [{ locale: 'en-US', name: 'Yearly' }],
            },
            {
              productId: 'com.acme.pro.monthly',
              referenceName: 'Monthly',
              subscriptionPeriod: 'ONE_MONTH',
              localizations: [{ locale: 'en-US', name: 'Monthly' }],
            },
          ],
        },
      ],
    };

    await runReconcile(api, input({ capabilities: [], products: twoTiers }));
    expect(api.createSubscription).toHaveBeenNthCalledWith(
      1,
      'grp-new',
      expect.objectContaining({ productId: 'com.acme.pro.yearly', groupLevel: 1 }),
    );
    expect(api.createSubscription).toHaveBeenNthCalledWith(
      2,
      'grp-new',
      expect.objectContaining({ productId: 'com.acme.pro.monthly', groupLevel: 2 }),
    );
  }

  it(
    'assigns group levels from config order (first subscription = level 1)',
    assignsGroupLevelsFromPieceOrderFirstSubscriptionLevel1,
  );

  async function honorsProductPriceBaseTerritoryWhenSettingAnInitialIAPPrice() {
    const api = makeApi();
    const europeanIap: InAppPurchaseConfig = {
      productId: 'com.acme.coins.eu',
      referenceName: 'Coins EU',
      type: 'CONSUMABLE',
      localizations: [{ locale: 'en-US', name: 'Coins' }],
      price: { customerPrice: 4.99, baseTerritory: 'DEU' },
    };

    await runReconcile(
      api,
      input({ capabilities: [], products: { inAppPurchases: [europeanIap] } }),
    );
    expect(api.findInAppPurchasePricePoint).toHaveBeenCalledWith('iap-new', 'DEU', 4.99);
    expect(api.createInAppPurchasePriceSchedule).toHaveBeenCalledWith('iap-new', 'DEU', 'ipp');
  }

  it(
    'honors ProductPrice.baseTerritory when setting an initial IAP price',
    honorsProductPriceBaseTerritoryWhenSettingAnInitialIAPPrice,
  );

  async function skipsDependentSubscriptionWorkWhenGroupCreationFails() {
    const api = makeApi({
      createSubscriptionGroup: vi.fn().mockRejectedValue(new Error('quota')),
    });
    const report = await runReconcile(
      api,
      input({ capabilities: [], products: { subscriptionGroups: SUBSCRIPTION_GROUPS } }),
    );

    expect(report.actions).toEqual([
      expect.objectContaining({
        description: 'create subscription group "Pro"',
        status: 'failed',
      }),
    ]);
    expect(api.createSubscriptionGroupLocalization).not.toHaveBeenCalled();
    expect(api.createSubscription).not.toHaveBeenCalled();
  }

  it(
    'skips dependent subscription work when group creation fails',
    skipsDependentSubscriptionWorkWhenGroupCreationFails,
  );
}

describe('reconcileApp', describeReconcileApp);

function describeReconcileAppStoreListingLocalizations() {
  /** A listing-only run through the full reconciler: no capabilities/products. */
  function listingViaFullReconcile(
    listing: AppleStoreConfig,
    overrides: Partial<ReconcileInput> = {},
  ): ReconcileInput {
    return input({ capabilities: [], products: {}, listing, ...overrides });
  }

  async function createsMissingAppLevelAndVersionLevelLocalesRoutingEachFieldCorrectly() {
    const api = makeApi();
    const listing: AppleStoreConfig = {
      info: {
        'en-US': {
          title: 'Acme',
          subtitle: 'Do things',
          description: 'Long copy',
          keywords: ['a', 'b'],
        },
      },
    };
    const report = await runReconcile(api, listingViaFullReconcile(listing));

    function readDescription2(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.description;
    }

    expect(report.actions.map(readDescription2)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('create listing [en-US] App Info'),
        expect.stringContaining('create listing [en-US] App Store version'),
      ]),
    );
    expect(api.createAppInfoLocalization).toHaveBeenCalledWith('appinfo1', 'en-US', {
      name: 'Acme',
      subtitle: 'Do things',
    });
    expect(api.createVersionLocalization).toHaveBeenCalledWith('version1', 'en-US', {
      description: 'Long copy',
      keywords: 'a,b',
    });
  }

  it(
    'creates missing app-level and version-level locales, routing each field correctly',
    createsMissingAppLevelAndVersionLevelLocalesRoutingEachFieldCorrectly,
  );

  async function patchesOnlyTheFieldsThatChangedLeavingMatchingCopyUntouched() {
    const api = makeApi({
      listAppInfoLocalizations: vi
        .fn()
        .mockResolvedValue([
          { id: 'ail1', locale: 'en-US', fields: { name: 'Old', subtitle: 'Sub' } },
        ]),
      listVersionLocalizations: vi
        .fn()
        .mockResolvedValue([
          { id: 'vl1', locale: 'en-US', fields: { description: 'Desc', keywords: 'a' } },
        ]),
    });
    const listing: AppleStoreConfig = {
      info: {
        'en-US': { title: 'New', subtitle: 'Sub', description: 'Desc', keywords: ['a', 'b'] },
      },
    };

    await runReconcile(api, listingViaFullReconcile(listing));
    expect(api.updateAppInfoLocalization).toHaveBeenCalledWith('ail1', { name: 'New' });
    expect(api.updateVersionLocalization).toHaveBeenCalledWith('vl1', { keywords: 'a,b' });
  }

  it(
    'patches only the fields that changed, leaving matching copy untouched',
    patchesOnlyTheFieldsThatChangedLeavingMatchingCopyUntouched,
  );

  async function isANoOpWhenTheStoredListingAlreadyMatches() {
    const api = makeApi({
      listAppInfoLocalizations: vi
        .fn()
        .mockResolvedValue([{ id: 'ail1', locale: 'en-US', fields: { name: 'Acme' } }]),
      listVersionLocalizations: vi
        .fn()
        .mockResolvedValue([{ id: 'vl1', locale: 'en-US', fields: { description: 'Copy' } }]),
    });
    const listing: AppleStoreConfig = { info: { 'en-US': { title: 'Acme', description: 'Copy' } } };
    const report = await runReconcile(api, listingViaFullReconcile(listing));

    expect(report.actions).toHaveLength(0);
    expect(api.updateAppInfoLocalization).not.toHaveBeenCalled();
    expect(api.updateVersionLocalization).not.toHaveBeenCalled();
  }

  it(
    'is a no-op when the stored listing already matches',
    isANoOpWhenTheStoredListingAlreadyMatches,
  );

  async function skipsAnOverLengthFieldButStillWritesTheValidOnes() {
    const api = makeApi();
    const listing: AppleStoreConfig = {
      info: { 'en-US': { title: 'Acme', description: 'Copy', keywords: ['x'.repeat(120)] } },
    };
    const report = await runReconcile(api, listingViaFullReconcile(listing));

    function isSkippedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'skipped';
    }

    expect(report.actions.find(isSkippedAction)?.description).toContain(
      'keywords is 120 chars (max 100)',
    );
    expect(api.createVersionLocalization).toHaveBeenCalledWith('version1', 'en-US', {
      description: 'Copy',
    });
  }

  it(
    'skips an over-length field but still writes the valid ones',
    skipsAnOverLengthFieldButStillWritesTheValidOnes,
  );

  async function skipsVersionCopyWhenNoEditableAppStoreVersionExistsButStillWritesAppLevelCopy() {
    const api = makeApi({ getEditableVersionId: vi.fn().mockResolvedValue(null) });
    const listing: AppleStoreConfig = { info: { 'en-US': { title: 'Acme', description: 'Copy' } } };
    const report = await runReconcile(api, listingViaFullReconcile(listing));

    function isMissingEditableVersion(action: (typeof report.actions)[number]): boolean {
      const isSkipped = action.status == 'skipped';

      if (isSkipped) return action.description.includes('no editable App Store version');

      return false;
    }

    expect(report.actions.some(isMissingEditableVersion)).toBe(true);
    expect(api.createVersionLocalization).not.toHaveBeenCalled();
    expect(api.createAppInfoLocalization).toHaveBeenCalled();
  }

  it(
    'skips version copy when no editable App Store version exists, but still writes app-level copy',
    skipsVersionCopyWhenNoEditableAppStoreVersionExistsButStillWritesAppLevelCopy,
  );
}

describe(
  'reconcileApp - store listing localizations',
  describeReconcileAppStoreListingLocalizations,
);

function describeReconcileAppListing() {
  async function plansListingWritesOnlyNoCatalogSurfacesAndNeverCallsProductAPIs() {
    const api = makeApi();
    const listing: AppleStoreConfig = {
      info: {
        'en-US': { title: 'Acme', description: 'Ship it' },
      },
    };
    const report = await runListingReconcile(api, {
      bundleId: 'com.acme.app',
      listing,
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

    expect(report.actions.every(isPlannedAction)).toBe(true);

    function readDescription3(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.description;
    }

    expect(report.actions.map(readDescription3)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('create listing [en-US] App Info'),
        expect.stringContaining('create listing [en-US] App Store version'),
      ]),
    );
    expect(api.createAppInfoLocalization).not.toHaveBeenCalled();
    expect(api.createVersionLocalization).not.toHaveBeenCalled();
    expect(api.listInAppPurchases).not.toHaveBeenCalled();
    expect(api.listSubscriptionGroups).not.toHaveBeenCalled();
    expect(api.findBundleId).not.toHaveBeenCalled();
    expect(api.enableCapability).not.toHaveBeenCalled();
  }

  it(
    'plans listing writes only (no catalog surfaces) and never calls product APIs',
    plansListingWritesOnlyNoCatalogSurfacesAndNeverCallsProductAPIs,
  );

  async function appliesListingCreatesWhenNotDryRun() {
    const api = makeApi();
    const listing: AppleStoreConfig = {
      info: {
        'en-US': {
          title: 'Acme',
          description: 'Ship it',
          releaseNotes: 'v1',
          supportUrl: 'https://example.com/support',
        },
      },
    };
    const report = await runListingReconcile(api, {
      bundleId: 'com.acme.app',
      listing,
      dryRun: false,
    });

    function isAppliedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'applied';
    }

    expect(report.actions.every(isAppliedAction)).toBe(true);
    expect(api.createAppInfoLocalization).toHaveBeenCalledWith('appinfo1', 'en-US', {
      name: 'Acme',
    });
    expect(api.createVersionLocalization).toHaveBeenCalledWith('version1', 'en-US', {
      description: 'Ship it',
      whatsNew: 'v1',
      supportUrl: 'https://example.com/support',
    });
  }

  it('applies listing creates when not dry-run', appliesListingCreatesWhenNotDryRun);

  async function failsWithTheSameMissingAppPiecePreconditionAsFullReconcile() {
    const api = makeApi({ getAppId: vi.fn().mockResolvedValue(null) });
    const listingReconcile = runListingReconcile(api, {
      bundleId: 'com.acme.app',
      listing: { info: { 'en-US': { title: 'Acme' } } },
      dryRun: true,
    });

    await expect(listingReconcile).rejects.toThrow(
      /No App Store Connect app record.*Apple has no API/s,
    );
  }

  it(
    'fails with the same missing-app-record precondition as full reconcile',
    failsWithTheSameMissingAppPiecePreconditionAsFullReconcile,
  );
}

describe('reconcileAppListing', describeReconcileAppListing);
