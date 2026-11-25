import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { AdoptCatalogApi, AdoptTarget } from '../types/adopt.js';
import type { AppDescriptor } from '../types/app.js';
import { productsAdopter } from './products.js';

/** Empty catalog fake; override only the reads a scenario needs. */
const emptyAdoptCatalog = (overrides: Partial<AdoptCatalogApi> = {}): AdoptCatalogApi => {
  const baseCatalog: AdoptCatalogApi = {
    getAppId: () => Effect.succeed('app1'),
    getLatestMarketingVersion: () => Effect.succeed('1.0.0'),
    getLatestBuildNumber: () => Effect.succeed(1),
    findBundleId: () => Effect.succeed({ id: 'b1', identifier: 'com.acme.app' }),
    listBundleIdCapabilities: () => Effect.succeed([]),
    listProfilesForBundleId: () => Effect.succeed([]),
    listMerchantIds: () => Effect.succeed([]),
    listInAppPurchases: () => Effect.succeed([]),
    listInAppPurchaseLocalizations: () => Effect.succeed([]),
    inAppPurchaseHasPrice: () => Effect.succeed(false),
    listSubscriptionGroups: () => Effect.succeed([]),
    listSubscriptionGroupLocalizations: () => Effect.succeed([]),
    listSubscriptions: () => Effect.succeed([]),
    listSubscriptionLocalizations: () => Effect.succeed([]),
    subscriptionHasPrice: () => Effect.succeed(false),
    listDistributionCertificates: () => Effect.succeed([]),
  };
  return { ...baseCatalog, ...overrides };
};

const APP: AppDescriptor = {
  name: 'acme',
  dir: '/repo/acme',
  configPath: '/repo/acme/app.json',
  bundleId: 'com.acme.app',
};

const adoptTarget = (overrides: Partial<AdoptTarget> = {}): AdoptTarget => ({
  app: APP,
  appId: 'app1',
  bundleId: 'com.acme.app',
  keyId: 'K',
  cwd: '/repo',
  hasLaunchConfig: false,
  ...overrides,
});

describe('productsAdopter', () => {
  it('imports an in-app purchase with its localizations, keyed by bundle id', async () => {
    const appleCatalog = emptyAdoptCatalog({
      listInAppPurchases: () =>
        Effect.succeed([
          {
            id: 'iap1',
            productId: 'com.acme.coins',
            name: 'Coins',
            inAppPurchaseType: 'CONSUMABLE',
          },
        ]),
      listInAppPurchaseLocalizations: () =>
        Effect.succeed([{ id: 'l1', locale: 'en-US', name: 'Coins', description: 'Buy coins' }]),
    });
    const writes = await Effect.runPromise(productsAdopter.read(appleCatalog, adoptTarget()));
    expect(writes).toHaveLength(1);
    const firstWrite = writes[0];
    expect(firstWrite).toBeDefined();
    if (firstWrite === undefined) return;
    expect(firstWrite.description).toBe(
      'products: import in-app purchase com.acme.coins (CONSUMABLE)',
    );
    expect(firstWrite.note).toBeUndefined();
    expect(firstWrite.change).toEqual({
      home: 'launch.config',
      bundleId: 'com.acme.app',
      piece: {
        type: 'iap',
        iap: {
          productId: 'com.acme.coins',
          referenceName: 'Coins',
          type: 'CONSUMABLE',
          localizations: [{ locale: 'en-US', name: 'Coins', description: 'Buy coins' }],
        },
      },
    });
  });

  it("notes a priced product whose amount the API won't cheaply return", async () => {
    const appleCatalog = emptyAdoptCatalog({
      listInAppPurchases: () =>
        Effect.succeed([
          {
            id: 'iap1',
            productId: 'com.acme.pro',
            name: 'Pro',
            inAppPurchaseType: 'NON_CONSUMABLE',
          },
        ]),
      inAppPurchaseHasPrice: () => Effect.succeed(true),
    });
    const writes = await Effect.runPromise(productsAdopter.read(appleCatalog, adoptTarget()));
    const firstWrite = writes[0];
    expect(firstWrite).toBeDefined();
    if (firstWrite === undefined) return;
    expect(firstWrite.note).toMatch(/priced on App Store Connect/);
  });

  it("skips an in-app purchase whose type Launch doesn't model", async () => {
    const appleCatalog = emptyAdoptCatalog({
      listInAppPurchases: () =>
        Effect.succeed([
          { id: 'iap1', productId: 'com.acme.weird', name: 'Weird', inAppPurchaseType: 'MYSTERY' },
        ]),
    });
    expect(await Effect.runPromise(productsAdopter.read(appleCatalog, adoptTarget()))).toEqual([]);
  });

  it('imports a subscription group with its levels and billing period', async () => {
    const appleCatalog = emptyAdoptCatalog({
      listSubscriptionGroups: () => Effect.succeed([{ id: 'g1', referenceName: 'Pro' }]),
      listSubscriptionGroupLocalizations: () =>
        Effect.succeed([{ id: 'gl', locale: 'en-US', name: 'Pro Tiers' }]),
      listSubscriptions: () =>
        Effect.succeed([
          {
            id: 's1',
            productId: 'com.acme.pro.monthly',
            name: 'Pro Monthly',
            subscriptionPeriod: 'ONE_MONTH',
          },
        ]),
      listSubscriptionLocalizations: () =>
        Effect.succeed([{ id: 'sl', locale: 'en-US', name: 'Pro' }]),
    });
    const writes = await Effect.runPromise(productsAdopter.read(appleCatalog, adoptTarget()));
    const firstWrite = writes[0];
    expect(firstWrite).toBeDefined();
    if (firstWrite === undefined) return;
    expect(firstWrite.description).toBe('products: import subscription group "Pro" (1 level)');
    expect(firstWrite.change).toMatchObject({
      home: 'launch.config',
      bundleId: 'com.acme.app',
      piece: {
        type: 'subscriptionGroup',
        group: {
          referenceName: 'Pro',
          localizations: [{ locale: 'en-US', name: 'Pro Tiers' }],
          subscriptions: [
            {
              productId: 'com.acme.pro.monthly',
              referenceName: 'Pro Monthly',
              subscriptionPeriod: 'ONE_MONTH',
              localizations: [{ locale: 'en-US', name: 'Pro' }],
            },
          ],
        },
      },
    });
  });

  it('drops a subscription group whose only level is missing its billing period', async () => {
    const appleCatalog = emptyAdoptCatalog({
      listSubscriptionGroups: () => Effect.succeed([{ id: 'g1', referenceName: 'Pro' }]),
      listSubscriptions: () =>
        Effect.succeed([{ id: 's1', productId: 'com.acme.pro', name: 'Pro' }]),
    });
    expect(await Effect.runPromise(productsAdopter.read(appleCatalog, adoptTarget()))).toEqual([]);
  });
});
