import type { AdoptCatalogApi, Adopter, PlannedWrite } from '../types/adopt.ts';
import type {
  InAppPurchaseResource,
  LocalizationResource,
  SubscriptionResource,
} from '../types/apple-catalog.ts';
import type {
  InAppPurchaseConfig,
  InAppPurchaseType,
  ProductLocalization,
  SubscriptionConfig,
  SubscriptionGroupConfig,
  SubscriptionPeriod,
} from '../types/catalog.ts';
import type { MutableDeep } from '../types/mutable.ts';

/** Narrow an App Store in-app purchase type to the modeled config union. */
function parseInAppPurchaseType(purchaseType: string): InAppPurchaseType | null {
  switch (purchaseType) {
    case 'CONSUMABLE':
    case 'NON_CONSUMABLE':
    case 'NON_RENEWING_SUBSCRIPTION':
      return purchaseType;
    default:
      return null;
  }
}

/** Narrow an App Store subscription period to the modeled config union. */
function parseSubscriptionPeriod(
  subscriptionPeriod: string | undefined,
): SubscriptionPeriod | null {
  switch (subscriptionPeriod) {
    case 'ONE_WEEK':
    case 'ONE_MONTH':
    case 'TWO_MONTHS':
    case 'THREE_MONTHS':
    case 'SIX_MONTHS':
    case 'ONE_YEAR':
      return subscriptionPeriod;
    default:
      return null;
  }
}

function readProductLocalization(localization: LocalizationResource): ProductLocalization {
  const productLocalization: MutableDeep<ProductLocalization> = {
    locale: localization.locale,
    name: localization.name,
  };

  if (localization.description != null) {
    productLocalization.description = localization.description;
  }

  return productLocalization;
}

/** Convert App Store localization resources into config localization entries. */
function productLocalizationsFromResources(
  localizations: readonly LocalizationResource[],
): ProductLocalization[] {
  return localizations.map(readProductLocalization);
}

function purchaseWrite(
  bundleId: string,
  purchase: InAppPurchaseResource,
  purchaseType: InAppPurchaseType,
  purchaseConfig: InAppPurchaseConfig,
  hasPrice: boolean,
): PlannedWrite {
  const description = `products: import in-app purchase ${purchase.productId} (${purchaseType})`;
  const change = {
    home: 'launch.config' as const,
    bundleId,
    piece: { type: 'iap' as const, iap: purchaseConfig },
  };

  if (hasPrice) {
    return {
      description,
      fidelity: 'importable' as const,
      note: 'priced on App Store Connect - add `price` in config or keep managing it in the UI',
      change,
    };
  }

  return {
    description,
    fidelity: 'importable' as const,
    change,
  };
}

/** Import one in-app purchase and preserve an advisory when pricing remains portal-owned. */
async function importInAppPurchase(
  appleCatalog: AdoptCatalogApi,
  bundleId: string,
  purchase: InAppPurchaseResource,
): Promise<PlannedWrite | null> {
  const purchaseType = parseInAppPurchaseType(purchase.inAppPurchaseType);

  if (purchaseType == null) {
    return null;
  }

  const localizationsPromise = appleCatalog.listInAppPurchaseLocalizations(purchase.id);
  const pricePromise = appleCatalog.inAppPurchaseHasPrice(purchase.id);
  const localizations = await localizationsPromise;
  const hasPrice = await pricePromise;
  const purchaseConfig: InAppPurchaseConfig = {
    productId: purchase.productId,
    referenceName: purchase.name,
    type: purchaseType,
    localizations: productLocalizationsFromResources(localizations),
  };

  return purchaseWrite(bundleId, purchase, purchaseType, purchaseConfig, hasPrice);
}

type ImportedSubscription = Readonly<{
  readonly config: SubscriptionConfig;
  readonly pricedUnimported: boolean;
}>;

/** Import one subscription level when its billing period is modeled. */
async function importSubscription(
  appleCatalog: AdoptCatalogApi,
  subscription: SubscriptionResource,
): Promise<ImportedSubscription | null> {
  const subscriptionPeriod = parseSubscriptionPeriod(subscription.subscriptionPeriod);

  if (subscriptionPeriod == null) {
    return null;
  }

  const localizationsPromise = appleCatalog.listSubscriptionLocalizations(subscription.id);
  const pricePromise = appleCatalog.subscriptionHasPrice(subscription.id);
  const localizations = await localizationsPromise;
  const hasPrice = await pricePromise;

  return {
    config: {
      productId: subscription.productId,
      referenceName: subscription.name,
      subscriptionPeriod,
      localizations: productLocalizationsFromResources(localizations),
    },
    pricedUnimported: hasPrice,
  };
}

function isImportedSubscription(
  subscription: ImportedSubscription | null,
): subscription is ImportedSubscription {
  return subscription != null;
}

function groupLocalizationName(localization: LocalizationResource) {
  return {
    locale: localization.locale,
    name: localization.name,
  };
}

function subscriptionConfigOf(subscription: ImportedSubscription): SubscriptionConfig {
  return subscription.config;
}

function isPricedUnimported(subscription: ImportedSubscription): boolean {
  return subscription.pricedUnimported;
}

function productIdOf(subscription: ImportedSubscription): string {
  return subscription.config.productId;
}

/** Import one subscription group and its usable levels. */
async function importSubscriptionGroup(
  appleCatalog: AdoptCatalogApi,
  bundleId: string,
  group: Readonly<{ id: string; referenceName: string }>,
): Promise<PlannedWrite | null> {
  const groupLocalizationsPromise = appleCatalog.listSubscriptionGroupLocalizations(group.id);
  const subscriptionsPromise = appleCatalog.listSubscriptions(group.id);
  const groupLocalizations = await groupLocalizationsPromise;
  const subscriptions = await subscriptionsPromise;

  async function importGroupSubscription(
    subscription: SubscriptionResource,
  ): Promise<ImportedSubscription | null> {
    return importSubscription(appleCatalog, subscription);
  }

  const subscriptionCandidates = await Promise.all(subscriptions.map(importGroupSubscription));
  const importedSubscriptions = subscriptionCandidates.filter(isImportedSubscription);

  const hasNoLevels = importedSubscriptions.length == 0;

  if (hasNoLevels) {
    return null;
  }

  const groupConfig: SubscriptionGroupConfig = {
    referenceName: group.referenceName,
    localizations: groupLocalizations.map(groupLocalizationName),
    subscriptions: importedSubscriptions.map(subscriptionConfigOf),
  };
  const unimportedPriceIds = importedSubscriptions.filter(isPricedUnimported).map(productIdOf);
  let levelSuffix = 'levels';

  if (importedSubscriptions.length == 1) {
    levelSuffix = 'level';
  }

  const description = `products: import subscription group "${group.referenceName}" (${importedSubscriptions.length} ${levelSuffix})`;
  const change = {
    home: 'launch.config' as const,
    bundleId,
    piece: { type: 'subscriptionGroup' as const, group: groupConfig },
  };

  const hasUnimportedPrices = unimportedPriceIds.length > 0;

  if (hasUnimportedPrices) {
    return {
      description,
      fidelity: 'importable' as const,
      note: `priced on App Store Connect, not imported - set \`price\` for: ${unimportedPriceIds.join(', ')}`,
      change,
    };
  }

  return {
    description,
    fidelity: 'importable' as const,
    change,
  };
}

function isPlannedWrite(plannedWrite: PlannedWrite | null): plannedWrite is PlannedWrite {
  return plannedWrite != null;
}

/** Read products and plan their launch.config imports. */
export const productsAdopter: Adopter = {
  domain: 'products',
  fidelity: 'importable',
  async read(appleCatalog, target) {
    const purchasesPromise = appleCatalog.listInAppPurchases(target.appId);
    const groupsPromise = appleCatalog.listSubscriptionGroups(target.appId);
    const purchases = await purchasesPromise;
    const subscriptionGroups = await groupsPromise;

    async function importPurchase(purchase: InAppPurchaseResource): Promise<PlannedWrite | null> {
      return importInAppPurchase(appleCatalog, target.bundleId, purchase);
    }

    async function importGroup(
      group: Readonly<{ id: string; referenceName: string }>,
    ): Promise<PlannedWrite | null> {
      return importSubscriptionGroup(appleCatalog, target.bundleId, group);
    }

    const purchaseWritesPromise = Promise.all(purchases.map(importPurchase));
    const subscriptionWritesPromise = Promise.all(subscriptionGroups.map(importGroup));
    const purchaseWrites = await purchaseWritesPromise;
    const subscriptionWrites = await subscriptionWritesPromise;

    return [...purchaseWrites, ...subscriptionWrites].filter(isPlannedWrite);
  },
};
