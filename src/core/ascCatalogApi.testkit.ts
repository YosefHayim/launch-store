/**
 * Shared test fake for the `launch sync` reconciler's {@link AscCatalogApi} write surface. Reused by the
 * reconciler's own tests (`ascSync.test.ts`) and the snapshot listing-restore tests (`snapshot/sources`),
 * so the ~30-method stub lives in one place instead of being copied per consumer.
 *
 * Defaults model a fresh account: reads return "nothing exists yet", writes resolve to a created resource.
 * Override any method to model existing state or a failure. Not shipped — imported only from `*.test.ts`.
 */

import { vi } from 'vitest';
import type { AscCatalogApi } from './ascSync.js';

/** A fully-stubbed {@link AscCatalogApi}. Reads default to "nothing exists yet"; writes resolve to a created resource. */
export function makeAscCatalogApiFake(overrides: Partial<AscCatalogApi> = {}): AscCatalogApi {
  const base: AscCatalogApi = {
    getAppId: vi.fn().mockResolvedValue('app1'),
    findBundleId: vi.fn().mockResolvedValue({ id: 'bundle1', identifier: 'com.acme.app' }),
    listBundleIdCapabilities: vi.fn().mockResolvedValue([]),
    enableCapability: vi
      .fn()
      .mockImplementation((_b: string, capabilityType: string) =>
        Promise.resolve({ id: 'cap-new', capabilityType }),
      ),
    disableCapability: vi.fn().mockResolvedValue(undefined),
    listInAppPurchases: vi.fn().mockResolvedValue([]),
    createInAppPurchase: vi
      .fn()
      .mockImplementation(
        (_a: string, input: { productId: string; name: string; inAppPurchaseType: string }) =>
          Promise.resolve({
            id: 'iap-new',
            productId: input.productId,
            name: input.name,
            inAppPurchaseType: input.inAppPurchaseType,
          }),
      ),
    listInAppPurchaseLocalizations: vi.fn().mockResolvedValue([]),
    createInAppPurchaseLocalization: vi
      .fn()
      .mockImplementation((_i: string, input: { locale: string; name: string }) =>
        Promise.resolve({ id: 'iloc', locale: input.locale, name: input.name }),
      ),
    inAppPurchaseHasPrice: vi.fn().mockResolvedValue(false),
    findInAppPurchasePricePoint: vi
      .fn()
      .mockImplementation((_i: string, territory: string, price: number) =>
        Promise.resolve({ id: 'ipp', customerPrice: String(price), territory }),
      ),
    createInAppPurchasePriceSchedule: vi.fn().mockResolvedValue(undefined),
    listSubscriptionGroups: vi.fn().mockResolvedValue([]),
    createSubscriptionGroup: vi
      .fn()
      .mockImplementation((_a: string, referenceName: string) =>
        Promise.resolve({ id: 'grp-new', referenceName }),
      ),
    listSubscriptionGroupLocalizations: vi.fn().mockResolvedValue([]),
    createSubscriptionGroupLocalization: vi
      .fn()
      .mockImplementation((_g: string, input: { locale: string; name: string }) =>
        Promise.resolve({ id: 'gloc', locale: input.locale, name: input.name }),
      ),
    listSubscriptions: vi.fn().mockResolvedValue([]),
    createSubscription: vi
      .fn()
      .mockImplementation((_g: string, input: { productId: string; name: string }) =>
        Promise.resolve({ id: 'sub-new', productId: input.productId, name: input.name }),
      ),
    listSubscriptionLocalizations: vi.fn().mockResolvedValue([]),
    createSubscriptionLocalization: vi
      .fn()
      .mockImplementation((_s: string, input: { locale: string; name: string }) =>
        Promise.resolve({ id: 'sloc', locale: input.locale, name: input.name }),
      ),
    subscriptionHasPrice: vi.fn().mockResolvedValue(false),
    findSubscriptionPricePoint: vi
      .fn()
      .mockImplementation((_s: string, territory: string, price: number) =>
        Promise.resolve({ id: 'spp', customerPrice: String(price), territory }),
      ),
    createSubscriptionPrice: vi.fn().mockResolvedValue(undefined),
    getEditableAppInfoId: vi.fn().mockResolvedValue('appinfo1'),
    listAppInfoLocalizations: vi.fn().mockResolvedValue([]),
    createAppInfoLocalization: vi.fn().mockResolvedValue(undefined),
    updateAppInfoLocalization: vi.fn().mockResolvedValue(undefined),
    getEditableVersionId: vi.fn().mockResolvedValue('version1'),
    listVersionLocalizations: vi.fn().mockResolvedValue([]),
    createVersionLocalization: vi.fn().mockResolvedValue(undefined),
    updateVersionLocalization: vi.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides };
}
