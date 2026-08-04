import { Effect } from 'effect';
import type { AdoptCatalogApi, Adopter, PlannedWrite } from '../types/adopt.js';
import type { MutableDeep } from '../types/mutable.js';
import type {
  InAppPurchaseResource,
  LocalizationResource,
  SubscriptionResource,
} from '../types/appleCatalog.js';
import type {
  InAppPurchaseConfig,
  InAppPurchaseType,
  ProductLocalization,
  SubscriptionConfig,
  SubscriptionGroupConfig,
  SubscriptionPeriod,
} from '../types/catalog.js';

/** Narrow an App Store in-app purchase type to the modeled config union. */
const toInAppPurchaseType = (purchaseType: string): InAppPurchaseType | null => {
  switch (purchaseType) {
    case 'CONSUMABLE':
    case 'NON_CONSUMABLE':
    case 'NON_RENEWING_SUBSCRIPTION':
      return purchaseType;
    default:
      return null;
  }
};

/** Narrow an App Store subscription period to the modeled config union. */
const toSubscriptionPeriod = (
  subscriptionPeriod: string | undefined,
): SubscriptionPeriod | null => {
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
};

/** Convert App Store localization resources into config localization entries. */
const toProductLocalizations = (
  localizations: readonly LocalizationResource[],
): ProductLocalization[] =>
  localizations.map((localization) => {
    const productLocalization: MutableDeep<ProductLocalization> = {
      locale: localization.locale,
      name: localization.name,
    };
    if (localization.description !== undefined)
      productLocalization.description = localization.description;
    return productLocalization;
  });

/** Import one in-app purchase and preserve an advisory when pricing remains portal-owned. */
const importInAppPurchase = (
  appleCatalog: AdoptCatalogApi,
  bundleId: string,
  purchase: InAppPurchaseResource,
): Effect.Effect<PlannedWrite | null, unknown> =>
  Effect.gen(function* () {
    const purchaseType = toInAppPurchaseType(purchase.inAppPurchaseType);
    if (purchaseType === null) return null;
    const [localizations, hasPrice] = yield* Effect.all(
      [
        appleCatalog.listInAppPurchaseLocalizations(purchase.id),
        appleCatalog.inAppPurchaseHasPrice(purchase.id),
      ],
      { concurrency: 'unbounded' },
    );
    const purchaseConfig: InAppPurchaseConfig = {
      productId: purchase.productId,
      referenceName: purchase.name,
      type: purchaseType,
      localizations: [...toProductLocalizations(localizations)],
    };
    const plannedWrite: PlannedWrite = {
      description: `products: import in-app purchase ${purchase.productId} (${purchaseType})`,
      fidelity: 'importable',
      change: {
        home: 'launch.config',
        bundleId,
        piece: { type: 'iap', iap: purchaseConfig },
      },
    };
    if (!hasPrice) return plannedWrite;
    return {
      ...plannedWrite,
      note: 'priced on App Store Connect - add `price` in config or keep managing it in the UI',
    };
  });

type ImportedSubscription = Readonly<{
  readonly config: SubscriptionConfig;
  readonly pricedUnimported: boolean;
}>;

/** Import one subscription level when its billing period is modeled. */
const importSubscription = (
  appleCatalog: AdoptCatalogApi,
  subscription: SubscriptionResource,
): Effect.Effect<ImportedSubscription | null, unknown> =>
  Effect.gen(function* () {
    const subscriptionPeriod = toSubscriptionPeriod(subscription.subscriptionPeriod);
    if (subscriptionPeriod === null) return null;
    const [localizations, hasPrice] = yield* Effect.all(
      [
        appleCatalog.listSubscriptionLocalizations(subscription.id),
        appleCatalog.subscriptionHasPrice(subscription.id),
      ],
      { concurrency: 'unbounded' },
    );
    return {
      config: {
        productId: subscription.productId,
        referenceName: subscription.name,
        subscriptionPeriod,
        localizations: [...toProductLocalizations(localizations)],
      },
      pricedUnimported: hasPrice,
    };
  });

/** Import one subscription group and its usable levels. */
const importSubscriptionGroup = (
  appleCatalog: AdoptCatalogApi,
  bundleId: string,
  group: Readonly<{ id: string; referenceName: string }>,
): Effect.Effect<PlannedWrite | null, unknown> =>
  Effect.gen(function* () {
    const [groupLocalizations, subscriptions] = yield* Effect.all(
      [
        appleCatalog.listSubscriptionGroupLocalizations(group.id),
        appleCatalog.listSubscriptions(group.id),
      ],
      { concurrency: 'unbounded' },
    );
    const subscriptionCandidates = yield* Effect.forEach(
      subscriptions,
      (subscription) => importSubscription(appleCatalog, subscription),
      { concurrency: 'unbounded' },
    );
    const importedSubscriptions = subscriptionCandidates.filter(
      (subscription): subscription is ImportedSubscription => subscription !== null,
    );
    if (importedSubscriptions.length === 0) return null;
    const groupConfig: SubscriptionGroupConfig = {
      referenceName: group.referenceName,
      localizations: groupLocalizations.map((localization) => ({
        locale: localization.locale,
        name: localization.name,
      })),
      subscriptions: importedSubscriptions.map((subscription) => subscription.config),
    };
    const unimportedPriceIds = importedSubscriptions
      .filter((subscription) => subscription.pricedUnimported)
      .map((subscription) => subscription.config.productId);
    let levelSuffix = 'levels';
    if (importedSubscriptions.length === 1) levelSuffix = 'level';
    const plannedWrite: PlannedWrite = {
      description: `products: import subscription group "${group.referenceName}" (${importedSubscriptions.length} ${levelSuffix})`,
      fidelity: 'importable',
      change: {
        home: 'launch.config',
        bundleId,
        piece: { type: 'subscriptionGroup', group: groupConfig },
      },
    };
    if (unimportedPriceIds.length === 0) return plannedWrite;
    return {
      ...plannedWrite,
      note: `priced on App Store Connect, not imported - set \`price\` for: ${unimportedPriceIds.join(', ')}`,
    };
  });

/** Read products and plan their launch.config imports. */
export const productsAdopter: Adopter = {
  domain: 'products',
  fidelity: 'importable',
  read: (appleCatalog, target) =>
    Effect.gen(function* () {
      const [purchases, subscriptionGroups] = yield* Effect.all(
        [
          appleCatalog.listInAppPurchases(target.appId),
          appleCatalog.listSubscriptionGroups(target.appId),
        ],
        { concurrency: 'unbounded' },
      );
      const [purchaseWrites, subscriptionWrites] = yield* Effect.all(
        [
          Effect.forEach(
            purchases,
            (purchase) => importInAppPurchase(appleCatalog, target.bundleId, purchase),
            { concurrency: 'unbounded' },
          ),
          Effect.forEach(
            subscriptionGroups,
            (group) => importSubscriptionGroup(appleCatalog, target.bundleId, group),
            { concurrency: 'unbounded' },
          ),
        ],
        { concurrency: 'unbounded' },
      );
      return [...purchaseWrites, ...subscriptionWrites].filter(
        (plannedWrite): plannedWrite is PlannedWrite => plannedWrite !== null,
      );
    }),
};
