import { vi } from 'vitest';
import type {
  BundleIdCapabilityResource,
  InAppPurchaseResource,
  LocalizationResource,
  PricePointResource,
  SubscriptionGroupResource,
  SubscriptionResource,
} from '../types/apple-catalog.ts';
import type { AscCatalogApi } from '../store/apple/app-store-sync.ts';

function readAppId(): Promise<string> {
  return Promise.resolve('app1');
}

function readBundleId(): Promise<{ id: string; identifier: string }> {
  return Promise.resolve({ id: 'bundle1', identifier: 'com.acme.app' });
}

function readEmptyList(): Promise<never[]> {
  return Promise.resolve([]);
}

function finishWrite(): Promise<void> {
  return Promise.resolve();
}

function readHasNoPrice(): Promise<boolean> {
  return Promise.resolve(false);
}

function readEditableAppInfoId(): Promise<string> {
  return Promise.resolve('appinfo1');
}

function readEditableVersionId(): Promise<string> {
  return Promise.resolve('version1');
}

function createCapability(
  _bundleIdResourceId: string,
  capabilityType: string,
): Promise<BundleIdCapabilityResource> {
  return Promise.resolve({ id: 'cap-new', capabilityType });
}

function createPurchase(
  _appId: string,
  purchase: {
    productId: string;
    name: string;
    inAppPurchaseType: string;
  },
): Promise<InAppPurchaseResource> {
  return Promise.resolve({
    id: 'iap-new',
    productId: purchase.productId,
    name: purchase.name,
    inAppPurchaseType: purchase.inAppPurchaseType,
  });
}

function createPurchaseLocalization(
  _purchaseId: string,
  localization: {
    locale: string;
    name: string;
    description?: string | undefined;
  },
): Promise<LocalizationResource> {
  return Promise.resolve({
    id: 'iloc',
    locale: localization.locale,
    name: localization.name,
  });
}

function readPurchasePricePoint(
  _purchaseId: string,
  territory: string,
  customerPrice: number,
): Promise<PricePointResource> {
  const printedPrice = String(customerPrice);

  return Promise.resolve({ id: 'ipp', customerPrice: printedPrice, territory });
}

function createGroup(_appId: string, referenceName: string): Promise<SubscriptionGroupResource> {
  return Promise.resolve({ id: 'grp-new', referenceName });
}

function createGroupLocalization(
  _groupId: string,
  localization: {
    locale: string;
    name: string;
  },
): Promise<LocalizationResource> {
  return Promise.resolve({
    id: 'gloc',
    locale: localization.locale,
    name: localization.name,
  });
}

function createSubscription(
  _groupId: string,
  subscription: {
    productId: string;
    name: string;
    subscriptionPeriod: string;
    groupLevel: number;
  },
): Promise<SubscriptionResource> {
  return Promise.resolve({
    id: 'sub-new',
    productId: subscription.productId,
    name: subscription.name,
  });
}

function createSubscriptionLocalization(
  _subscriptionId: string,
  localization: {
    locale: string;
    name: string;
    description?: string | undefined;
  },
): Promise<LocalizationResource> {
  return Promise.resolve({
    id: 'sloc',
    locale: localization.locale,
    name: localization.name,
  });
}

function readSubscriptionPricePoint(
  _subscriptionId: string,
  territory: string,
  customerPrice: number,
): Promise<PricePointResource> {
  const printedPrice = String(customerPrice);

  return Promise.resolve({ id: 'spp', customerPrice: printedPrice, territory });
}

/** Fully-stubbed AscCatalogApi. Reads start empty; writes resolve to a created resource. */
export function makeAscCatalogApiFake(overrides: Partial<AscCatalogApi> = {}): AscCatalogApi {
  const baseApi: AscCatalogApi = {
    getAppId: vi.fn(readAppId),
    findBundleId: vi.fn(readBundleId),
    listBundleIdCapabilities: vi.fn(readEmptyList),
    enableCapability: vi.fn(createCapability),
    disableCapability: vi.fn(finishWrite),
    listInAppPurchases: vi.fn(readEmptyList),
    createInAppPurchase: vi.fn(createPurchase),
    listInAppPurchaseLocalizations: vi.fn(readEmptyList),
    createInAppPurchaseLocalization: vi.fn(createPurchaseLocalization),
    inAppPurchaseHasPrice: vi.fn(readHasNoPrice),
    findInAppPurchasePricePoint: vi.fn(readPurchasePricePoint),
    createInAppPurchasePriceSchedule: vi.fn(finishWrite),
    listSubscriptionGroups: vi.fn(readEmptyList),
    createSubscriptionGroup: vi.fn(createGroup),
    listSubscriptionGroupLocalizations: vi.fn(readEmptyList),
    createSubscriptionGroupLocalization: vi.fn(createGroupLocalization),
    listSubscriptions: vi.fn(readEmptyList),
    createSubscription: vi.fn(createSubscription),
    listSubscriptionLocalizations: vi.fn(readEmptyList),
    createSubscriptionLocalization: vi.fn(createSubscriptionLocalization),
    subscriptionHasPrice: vi.fn(readHasNoPrice),
    findSubscriptionPricePoint: vi.fn(readSubscriptionPricePoint),
    createSubscriptionPrice: vi.fn(finishWrite),
    getEditableAppInfoId: vi.fn(readEditableAppInfoId),
    listAppInfoLocalizations: vi.fn(readEmptyList),
    createAppInfoLocalization: vi.fn(finishWrite),
    updateAppInfoLocalization: vi.fn(finishWrite),
    getEditableVersionId: vi.fn(readEditableVersionId),
    listVersionLocalizations: vi.fn(readEmptyList),
    createVersionLocalization: vi.fn(finishWrite),
    updateVersionLocalization: vi.fn(finishWrite),
  };

  return { ...baseApi, ...overrides };
}
