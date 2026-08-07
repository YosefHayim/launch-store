import { Effect } from 'effect';
import type { AdoptCatalogApi, Adopter, PlannedWrite } from '../types/adopt.js';
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
import type { MutableDeep } from '../types/mutable.js';

/** Narrow an App Store in-app purchase type to the modeled config union. */
const parseInAppPurchaseType = (purchaseType: string): InAppPurchaseType | null => {
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
const parseSubscriptionPeriod = (
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
const productLocalizationsFromResources = (
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
    const purchaseType = parseInAppPurchaseType(purchase.inAppPurchaseType);
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
      localizations: productLocalizationsFromResources(localizations),
    };
    if (hasPrice) {
      return {
        description: `products: import in-app purchase ${purchase.productId} (${purchaseType})`,
        fidelity: 'importable' as const,
        note: 'priced on App Store Connect - add `price` in config or keep managing it in the UI',
        change: {
          home: 'launch.config' as const,
          bundleId,
          piece: { type: 'iap' as const, iap: purchaseConfig },
        },
      };
    }
    return {
      description: `products: import in-app purchase ${purchase.productId} (${purchaseType})`,
      fidelity: 'importable' as const,
      change: {
        home: 'launch.config' as const,
        bundleId,
        piece: { type: 'iap' as const, iap: purchaseConfig },
      },
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
    const subscriptionPeriod = parseSubscriptionPeriod(subscription.subscriptionPeriod);
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
        localizations: productLocalizationsFromResources(localizations),
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
    const description = `products: import subscription group "${group.referenceName}" (${importedSubscriptions.length} ${levelSuffix})`;
    const change = {
      home: 'launch.config' as const,
      bundleId,
      piece: { type: 'subscriptionGroup' as const, group: groupConfig },
    };
    if (unimportedPriceIds.length > 0) {
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
