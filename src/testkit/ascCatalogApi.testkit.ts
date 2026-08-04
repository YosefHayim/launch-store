import { Effect } from 'effect';
import { vi } from 'vitest';
import type { AscCatalogApi } from '../core/store/ascSync.js';

const effectMethods = <Api extends object>(api: Api): Api => {
  const wrappedMethods = new Map<PropertyKey, unknown>();
  return new Proxy(api, {
    get(targetApi, methodName, receiver) {
      if (wrappedMethods.has(methodName)) return wrappedMethods.get(methodName);
      const apiMember = Reflect.get(targetApi, methodName, receiver);
      if (typeof apiMember !== 'function') return apiMember;
      const effectMethod = vi.fn((...methodArguments: unknown[]) => {
        const methodOutput = Reflect.apply(apiMember, targetApi, methodArguments);
        if (Effect.isEffect(methodOutput)) return methodOutput;
        return Effect.tryPromise({
          try: () => Promise.resolve(methodOutput),
          catch: (fakeFailure) => fakeFailure,
        });
      });
      wrappedMethods.set(methodName, effectMethod);
      return effectMethod;
    },
  });
};
/** A fully-stubbed {@link AscCatalogApi}. Reads default to "nothing exists yet"; writes resolve to a created resource. */
export const makeAscCatalogApiFake = (overrides: Partial<AscCatalogApi> = {}): AscCatalogApi => {
  const base: AscCatalogApi = {
    getAppId: vi.fn(() => Effect.succeed('app1')),
    findBundleId: vi.fn(() => Effect.succeed({ id: 'bundle1', identifier: 'com.acme.app' })),
    listBundleIdCapabilities: vi.fn(() => Effect.succeed([])),
    enableCapability: vi
      .fn()
      .mockImplementation((_b: string, capabilityType: string) =>
        Effect.succeed({ id: 'cap-new', capabilityType }),
      ),
    disableCapability: vi.fn(() => Effect.void),
    listInAppPurchases: vi.fn(() => Effect.succeed([])),
    createInAppPurchase: vi.fn().mockImplementation(
      (
        _a: string,
        input: {
          productId: string;
          name: string;
          inAppPurchaseType: string;
        },
      ) =>
        Effect.succeed({
          id: 'iap-new',
          productId: input.productId,
          name: input.name,
          inAppPurchaseType: input.inAppPurchaseType,
        }),
    ),
    listInAppPurchaseLocalizations: vi.fn(() => Effect.succeed([])),
    createInAppPurchaseLocalization: vi.fn().mockImplementation(
      (
        _i: string,
        input: {
          locale: string;
          name: string;
        },
      ) => Effect.succeed({ id: 'iloc', locale: input.locale, name: input.name }),
    ),
    inAppPurchaseHasPrice: vi.fn(() => Effect.succeed(false)),
    findInAppPurchasePricePoint: vi
      .fn()
      .mockImplementation((_i: string, territory: string, price: number) =>
        Effect.succeed({ id: 'ipp', customerPrice: String(price), territory }),
      ),
    createInAppPurchasePriceSchedule: vi.fn(() => Effect.void),
    listSubscriptionGroups: vi.fn(() => Effect.succeed([])),
    createSubscriptionGroup: vi
      .fn()
      .mockImplementation((_a: string, referenceName: string) =>
        Effect.succeed({ id: 'grp-new', referenceName }),
      ),
    listSubscriptionGroupLocalizations: vi.fn(() => Effect.succeed([])),
    createSubscriptionGroupLocalization: vi.fn().mockImplementation(
      (
        _g: string,
        input: {
          locale: string;
          name: string;
        },
      ) => Effect.succeed({ id: 'gloc', locale: input.locale, name: input.name }),
    ),
    listSubscriptions: vi.fn(() => Effect.succeed([])),
    createSubscription: vi.fn().mockImplementation(
      (
        _g: string,
        input: {
          productId: string;
          name: string;
        },
      ) => Effect.succeed({ id: 'sub-new', productId: input.productId, name: input.name }),
    ),
    listSubscriptionLocalizations: vi.fn(() => Effect.succeed([])),
    createSubscriptionLocalization: vi.fn().mockImplementation(
      (
        _s: string,
        input: {
          locale: string;
          name: string;
        },
      ) => Effect.succeed({ id: 'sloc', locale: input.locale, name: input.name }),
    ),
    subscriptionHasPrice: vi.fn(() => Effect.succeed(false)),
    findSubscriptionPricePoint: vi
      .fn()
      .mockImplementation((_s: string, territory: string, price: number) =>
        Effect.succeed({ id: 'spp', customerPrice: String(price), territory }),
      ),
    createSubscriptionPrice: vi.fn(() => Effect.void),
    getEditableAppInfoId: vi.fn(() => Effect.succeed('appinfo1')),
    listAppInfoLocalizations: vi.fn(() => Effect.succeed([])),
    createAppInfoLocalization: vi.fn(() => Effect.void),
    updateAppInfoLocalization: vi.fn(() => Effect.void),
    getEditableVersionId: vi.fn(() => Effect.succeed('version1')),
    listVersionLocalizations: vi.fn(() => Effect.succeed([])),
    createVersionLocalization: vi.fn(() => Effect.void),
    updateVersionLocalization: vi.fn(() => Effect.void),
  };
  const normalizedOverrides = effectMethods(overrides);
  return { ...base, ...normalizedOverrides };
};
