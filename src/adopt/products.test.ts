import { describe, expect, it } from 'vitest';
import type { AdoptCatalogApi, AdoptTarget } from '../types/adopt.ts';
import type { AppDescriptor } from '../types/app.ts';
import { productsAdopter } from './products.ts';

function ready<Value>(value: Value): Promise<Value> {
  return Promise.resolve(value);
}

/** Empty catalog fake; override only the reads a scenario needs. */
function emptyAdoptCatalog(overrides: Partial<AdoptCatalogApi> = {}): AdoptCatalogApi {
  const baseCatalog = {
    getAppId() {
      return ready('app1');
    },
    getLatestMarketingVersion() {
      return ready('1.0.0');
    },
    getLatestBuildNumber() {
      return ready(1);
    },
    findBundleId() {
      return ready({ id: 'b1', identifier: 'com.acme.app' });
    },
    listBundleIdCapabilities() {
      return ready([]);
    },
    listProfilesForBundleId() {
      return ready([]);
    },
    listMerchantIds() {
      return ready([]);
    },
    listInAppPurchases() {
      return ready([]);
    },
    listInAppPurchaseLocalizations() {
      return ready([]);
    },
    inAppPurchaseHasPrice() {
      return ready(false);
    },
    listSubscriptionGroups() {
      return ready([]);
    },
    listSubscriptionGroupLocalizations() {
      return ready([]);
    },
    listSubscriptions() {
      return ready([]);
    },
    listSubscriptionLocalizations() {
      return ready([]);
    },
    subscriptionHasPrice() {
      return ready(false);
    },
    listDistributionCertificates() {
      return ready([]);
    },
  };

  return { ...baseCatalog, ...overrides } as AdoptCatalogApi;
}

const acmeApp: AppDescriptor = {
  name: 'acme',
  dir: '/repo/acme',
  configPath: '/repo/acme/app.json',
  bundleId: 'com.acme.app',
};

function adoptTarget(overrides: Partial<AdoptTarget> = {}): AdoptTarget {
  return {
    app: acmeApp,
    appId: 'app1',
    bundleId: 'com.acme.app',
    keyId: 'K',
    cwd: '/repo',
    hasLaunchConfig: false,
    ...overrides,
  };
}
function describeProductsAdopter() {
  async function importsAnInAppPurchaseWithItsLocalizationsKeyedByBundleId() {
    const appleCatalog = emptyAdoptCatalog({
      listInAppPurchases() {
        return ready([
          {
            id: 'iap1',
            productId: 'com.acme.coins',
            name: 'Coins',
            inAppPurchaseType: 'CONSUMABLE',
          },
        ]);
      },
      listInAppPurchaseLocalizations() {
        return ready([{ id: 'l1', locale: 'en-US', name: 'Coins', description: 'Buy coins' }]);
      },
    });
    const target = adoptTarget();
    const writes = await productsAdopter.read(appleCatalog, target);
    expect(writes).toHaveLength(1);
    const firstWrite = writes[0];
    expect(firstWrite).toBeDefined();

    if (firstWrite == null) {
      return;
    }

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
  }

  it(
    'imports an in-app purchase with its localizations, keyed by bundle id',
    importsAnInAppPurchaseWithItsLocalizationsKeyedByBundleId,
  );
  async function notesAPricedProductWhoseAmountTheAPIWonTCheaplyReturn() {
    const appleCatalog = emptyAdoptCatalog({
      listInAppPurchases() {
        return ready([
          {
            id: 'iap1',
            productId: 'com.acme.pro',
            name: 'Pro',
            inAppPurchaseType: 'NON_CONSUMABLE',
          },
        ]);
      },
      inAppPurchaseHasPrice() {
        return ready(true);
      },
    });
    const target = adoptTarget();
    const writes = await productsAdopter.read(appleCatalog, target);
    const firstWrite = writes[0];
    expect(firstWrite).toBeDefined();

    if (firstWrite == null) {
      return;
    }

    expect(firstWrite.note).toMatch(/priced on App Store Connect/);
  }

  it(
    "notes a priced product whose amount the API won't cheaply return",
    notesAPricedProductWhoseAmountTheAPIWonTCheaplyReturn,
  );
  async function skipsAnInAppPurchaseWhoseTypeLaunchDoesnTModel() {
    const appleCatalog = emptyAdoptCatalog({
      listInAppPurchases() {
        return ready([
          { id: 'iap1', productId: 'com.acme.weird', name: 'Weird', inAppPurchaseType: 'MYSTERY' },
        ]);
      },
    });
    const target = adoptTarget();
    expect(await productsAdopter.read(appleCatalog, target)).toEqual([]);
  }

  it(
    "skips an in-app purchase whose type Launch doesn't model",
    skipsAnInAppPurchaseWhoseTypeLaunchDoesnTModel,
  );
  async function importsASubscriptionGroupWithItsLevelsAndBillingPeriod() {
    const appleCatalog = emptyAdoptCatalog({
      listSubscriptionGroups() {
        return ready([{ id: 'g1', referenceName: 'Pro' }]);
      },
      listSubscriptionGroupLocalizations() {
        return ready([{ id: 'gl', locale: 'en-US', name: 'Pro Tiers' }]);
      },
      listSubscriptions() {
        return ready([
          {
            id: 's1',
            productId: 'com.acme.pro.monthly',
            name: 'Pro Monthly',
            subscriptionPeriod: 'ONE_MONTH',
          },
        ]);
      },
      listSubscriptionLocalizations() {
        return ready([{ id: 'sl', locale: 'en-US', name: 'Pro' }]);
      },
    });
    const target = adoptTarget();
    const writes = await productsAdopter.read(appleCatalog, target);
    const firstWrite = writes[0];
    expect(firstWrite).toBeDefined();

    if (firstWrite == null) {
      return;
    }

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
  }

  it(
    'imports a subscription group with its levels and billing period',
    importsASubscriptionGroupWithItsLevelsAndBillingPeriod,
  );
  async function dropsASubscriptionGroupWhoseOnlyLevelIsMissingItsBillingPeriod() {
    const appleCatalog = emptyAdoptCatalog({
      listSubscriptionGroups() {
        return ready([{ id: 'g1', referenceName: 'Pro' }]);
      },
      listSubscriptions() {
        return ready([{ id: 's1', productId: 'com.acme.pro', name: 'Pro' }]);
      },
    });
    const target = adoptTarget();
    expect(await productsAdopter.read(appleCatalog, target)).toEqual([]);
  }

  it(
    'drops a subscription group whose only level is missing its billing period',
    dropsASubscriptionGroupWhoseOnlyLevelIsMissingItsBillingPeriod,
  );
}

describe('productsAdopter', describeProductsAdopter);
