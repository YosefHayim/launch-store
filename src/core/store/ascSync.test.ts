import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  reconcileApp,
  reconcileAppListing,
  type AscCatalogApi,
  type ListingReconcileInput,
  type ReconcileInput,
} from './ascSync.js';
import { makeAscCatalogApiFake } from '@testkit/ascCatalogApi.testkit.js';
import type { AppleStoreConfig } from './storeConfig.js';
import type {
  AppProducts,
  InAppPurchaseConfig,
  SubscriptionGroupConfig,
} from '../types/catalog.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';

/** Local alias for the shared {@link AscCatalogApi} fake - keeps existing `makeApi(...)` call sites intact. */
const makeApi = (overrides: Partial<AscCatalogApi> = {}): AscCatalogApi => {
  return makeAscCatalogApiFake(overrides);
};

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

const PRODUCTS: AppProducts = { inAppPurchases: IAPS, subscriptionGroups: SUBSCRIPTION_GROUPS };

const input = (overrides: Partial<ReconcileInput> = {}): ReconcileInput => {
  return {
    bundleId: 'com.acme.app',
    capabilities: ['PUSH_NOTIFICATIONS'],
    products: PRODUCTS,
    dryRun: false,
    allowDestructive: false,
    ...overrides,
  };
};

/** Execute the full catalog reconciler at the test boundary. */
const runReconcile = (api: AscCatalogApi, reconcileInput: ReconcileInput) =>
  Effect.runPromise(reconcileApp(api, reconcileInput));

/** Execute the listing-only reconciler (plan listing / snapshot surface). */
const runListingReconcile = (api: AscCatalogApi, listingInput: ListingReconcileInput) =>
  Effect.runPromise(reconcileAppListing(api, listingInput));

describe('reconcileApp', () => {
  it('plans every create from an empty account without performing any writes (dry-run)', async () => {
    const api = makeApi();
    const report = await runReconcile(api, input({ dryRun: true }));
    const descriptions = report.actions.map((action) => action.description);
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
    expect(report.actions.every((action) => action.status === 'planned')).toBe(true);
    expect(api.enableCapability).not.toHaveBeenCalled();
    expect(api.createInAppPurchase).not.toHaveBeenCalled();
    expect(api.createSubscription).not.toHaveBeenCalled();
  });

  it('applies every create against an empty account, in dependency order', async () => {
    const api = makeApi();
    const report = await runReconcile(api, input());
    expect(report.actions.every((action) => action.status === 'applied')).toBe(true);
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
  });

  it('is additive: existing products, localizations, capabilities, and prices are left untouched', async () => {
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
  });

  it('gates capability removal behind allowDestructive', async () => {
    const withExtra = {
      listBundleIdCapabilities: vi
        .fn()
        .mockResolvedValue([{ id: 'c-extra', capabilityType: 'HEALTHKIT' }]),
    };
    const guarded = makeApi(withExtra);
    const guardedReport = await runReconcile(guarded, input());
    const disable = guardedReport.actions.find(
      (action) => action.description === 'disable capability HEALTHKIT',
    );
    expect(disable).toMatchObject({ destructive: true, status: 'skipped' });
    expect(guarded.disableCapability).not.toHaveBeenCalled();
    const allowed = makeApi(withExtra);
    await runReconcile(allowed, input({ allowDestructive: true }));
    expect(allowed.disableCapability).toHaveBeenCalledWith('c-extra');
  });

  it("never proposes removing Apple's always-on capabilities (IN_APP_PURCHASE / GAME_CENTER)", async () => {
    const api = makeApi({
      listBundleIdCapabilities: vi.fn().mockResolvedValue([
        { id: 'c1', capabilityType: 'IN_APP_PURCHASE' },
        { id: 'c2', capabilityType: 'GAME_CENTER' },
      ]),
    });
    const report = await runReconcile(api, input({ capabilities: [] }));
    expect(report.actions.filter((action) => action.destructive)).toEqual([]);
  });

  it('throws an actionable error when the app has no App Store Connect record', async () => {
    const api = makeApi({ getAppId: vi.fn().mockResolvedValue(null) });
    await expect(runReconcile(api, input())).rejects.toThrow(
      /No App Store Connect app record.*Apple has no API/s,
    );
  });

  it("skips capabilities (without failing) when the bundle id isn't registered yet", async () => {
    const api = makeApi({ findBundleId: vi.fn().mockResolvedValue(null) });
    const report = await runReconcile(api, input({ products: {} }));
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0]).toMatchObject({ status: 'skipped' });
    expect(expectArrayElement(report.actions, 0, 'report.actions').description).toContain(
      'not registered yet',
    );
    expect(api.enableCapability).not.toHaveBeenCalled();
  });

  it('isolates a failing action (no matching price point) and still applies the rest', async () => {
    const api = makeApi({
      findInAppPurchasePricePoint: vi.fn().mockResolvedValue(null),
    });
    const report = await runReconcile(
      api,
      input({ capabilities: [], products: { inAppPurchases: IAPS } }),
    );
    const priceAction = report.actions.find((action) =>
      action.description.startsWith('set IAP price'),
    );
    expect(priceAction).toMatchObject({ status: 'failed' });
    expect(priceAction?.error).toMatch(/No USA price point matches 4.99/);
    // The create + localization before it still went through - one failure doesn't abort the walk.
    expect(api.createInAppPurchase).toHaveBeenCalled();
    expect(api.createInAppPurchaseLocalization).toHaveBeenCalled();
    expect(api.createInAppPurchasePriceSchedule).not.toHaveBeenCalled();
  });

  it("skips a new product's dependent work when its creation fails", async () => {
    const api = makeApi({
      createInAppPurchase: vi.fn().mockRejectedValue(new Error('duplicate productId')),
    });
    const report = await runReconcile(
      api,
      input({ capabilities: [], products: { inAppPurchases: IAPS } }),
    );
    expect(report.actions.map((action) => ({ d: action.description, s: action.status }))).toEqual([
      { d: 'create in-app purchase com.acme.coins (CONSUMABLE)', s: 'failed' },
    ]);
    expect(api.createInAppPurchaseLocalization).not.toHaveBeenCalled();
    expect(api.findInAppPurchasePricePoint).not.toHaveBeenCalled();
  });

  it('assigns group levels from config order (first subscription = level 1)', async () => {
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
  });

  it('honors ProductPrice.baseTerritory when setting an initial IAP price', async () => {
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
  });

  it('skips dependent subscription work when group creation fails', async () => {
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
  });
});

describe('reconcileApp - store listing localizations', () => {
  /** A listing-only run through the full reconciler: no capabilities/products. */
  const listingViaFullReconcile = (
    listing: AppleStoreConfig,
    overrides: Partial<ReconcileInput> = {},
  ): ReconcileInput => {
    return input({ capabilities: [], products: {}, listing, ...overrides });
  };

  it('creates missing app-level and version-level locales, routing each field correctly', async () => {
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
    expect(report.actions.map((action) => action.description)).toEqual(
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
  });

  it('patches only the fields that changed, leaving matching copy untouched', async () => {
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
  });

  it('is a no-op when the stored listing already matches', async () => {
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
  });

  it('skips an over-length field but still writes the valid ones', async () => {
    const api = makeApi();
    const listing: AppleStoreConfig = {
      info: { 'en-US': { title: 'Acme', description: 'Copy', keywords: ['x'.repeat(120)] } },
    };
    const report = await runReconcile(api, listingViaFullReconcile(listing));
    expect(report.actions.find((action) => action.status === 'skipped')?.description).toContain(
      'keywords is 120 chars (max 100)',
    );
    expect(api.createVersionLocalization).toHaveBeenCalledWith('version1', 'en-US', {
      description: 'Copy',
    });
  });

  it('skips version copy when no editable App Store version exists, but still writes app-level copy', async () => {
    const api = makeApi({ getEditableVersionId: vi.fn().mockResolvedValue(null) });
    const listing: AppleStoreConfig = { info: { 'en-US': { title: 'Acme', description: 'Copy' } } };
    const report = await runReconcile(api, listingViaFullReconcile(listing));
    expect(
      report.actions.some(
        (action) =>
          action.status === 'skipped' &&
          action.description.includes('no editable App Store version'),
      ),
    ).toBe(true);
    expect(api.createVersionLocalization).not.toHaveBeenCalled();
    expect(api.createAppInfoLocalization).toHaveBeenCalled();
  });
});

describe('reconcileAppListing', () => {
  it('plans listing writes only (no catalog surfaces) and never calls product APIs', async () => {
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
    expect(report.actions.every((action) => action.status === 'planned')).toBe(true);
    expect(report.actions.map((action) => action.description)).toEqual(
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
  });

  it('applies listing creates when not dry-run', async () => {
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
    expect(report.actions.every((action) => action.status === 'applied')).toBe(true);
    expect(api.createAppInfoLocalization).toHaveBeenCalledWith('appinfo1', 'en-US', {
      name: 'Acme',
    });
    expect(api.createVersionLocalization).toHaveBeenCalledWith('version1', 'en-US', {
      description: 'Ship it',
      whatsNew: 'v1',
      supportUrl: 'https://example.com/support',
    });
  });

  it('fails with the same missing-app-record precondition as full reconcile', async () => {
    const api = makeApi({ getAppId: vi.fn().mockResolvedValue(null) });
    await expect(
      runListingReconcile(api, {
        bundleId: 'com.acme.app',
        listing: { info: { 'en-US': { title: 'Acme' } } },
        dryRun: true,
      }),
    ).rejects.toThrow(/No App Store Connect app record.*Apple has no API/s);
  });
});
