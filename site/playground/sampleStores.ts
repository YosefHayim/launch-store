import { Effect } from 'effect';
import type { AscSurfacesApi } from '@core/types/plan.js';
import type { PresetId } from './presets.js';

const sampleSubscriptionStore: Partial<AscSurfacesApi> = {
  getAppId: () => Effect.succeed('app1'),
  listSubscriptionGroups: () => Effect.succeed([{ id: 'group1', referenceName: 'Hello Pro' }]),
  listSubscriptionGroupLocalizations: () =>
    Effect.succeed([{ id: 'groupCopy1', locale: 'en-US', name: 'Hello Pro' }]),
  listSubscriptions: () =>
    Effect.succeed([
      {
        id: 'sub1',
        productId: 'pro.monthly',
        name: 'Pro Monthly',
        subscriptionPeriod: 'ONE_MONTH',
      },
    ]),
  listSubscriptionLocalizations: () =>
    Effect.succeed([{ id: 'subCopy1', locale: 'en-US', name: 'Pro Monthly' }]),
  subscriptionHasPrice: () => Effect.succeed(false),
  findSubscriptionPricePoint: (_subscriptionId, territory, customerPrice) =>
    Effect.succeed({ id: 'pricePoint1', territory, customerPrice: String(customerPrice) }),
};

const sampleGameStore: Partial<AscSurfacesApi> = {
  getAppId: () => Effect.succeed('app1'),
  listInAppPurchases: () =>
    Effect.succeed([
      {
        id: 'iap1',
        productId: 'gems.small',
        name: 'Small gem pack',
        inAppPurchaseType: 'CONSUMABLE',
      },
    ]),
  listInAppPurchaseLocalizations: () =>
    Effect.succeed([{ id: 'iapCopy1', locale: 'en-US', name: 'Small gem pack' }]),
  inAppPurchaseHasPrice: () => Effect.succeed(false),
  findInAppPurchasePricePoint: (_purchaseId, territory, customerPrice) =>
    Effect.succeed({ id: 'pricePoint1', territory, customerPrice: String(customerPrice) }),
};

const sampleFirstReleaseStore: Partial<AscSurfacesApi> = {
  getAppId: () => Effect.succeed('app1'),
  findSubscriptionPricePoint: (_subscriptionId, territory, customerPrice) =>
    Effect.succeed({ id: 'pricePoint1', territory, customerPrice: String(customerPrice) }),
  findInAppPurchasePricePoint: (_purchaseId, territory, customerPrice) =>
    Effect.succeed({ id: 'pricePoint1', territory, customerPrice: String(customerPrice) }),
};

export const sampleAscStoreFor = (presetId: PresetId): Partial<AscSurfacesApi> => {
  switch (presetId) {
    case 'subscriptionApp':
      return sampleSubscriptionStore;
    case 'freeGame':
      return sampleGameStore;
    case 'firstRelease':
      return sampleFirstReleaseStore;
  }
};
