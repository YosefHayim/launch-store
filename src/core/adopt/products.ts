/**
 * The **products** adopter (importable tier): read an app's live in-app purchases and subscription
 * groups from App Store Connect and import them as `products[bundleId]` in `launch.config.ts`.
 *
 * Highest-fidelity domain — Apple's product catalog maps almost 1:1 onto {@link AppProducts}, so a
 * developer who built their monetization by hand in the App Store Connect UI gets it back as reviewable
 * config in one command. The one lossy field is **price**: the API exposes only "has a price / no price"
 * for a product, not the current amount through a cheap read, so a priced product is imported without a
 * `price` and flagged with a note (set it in config, or keep managing it in the UI) rather than guessed.
 */

import type {
  InAppPurchaseResource,
  LocalizationResource,
  SubscriptionResource,
} from '../../apple/ascClient.js';
import type {
  Adopter,
  AdoptCatalogApi,
  AdoptTarget,
  InAppPurchaseConfig,
  InAppPurchaseType,
  PlannedWrite,
  ProductLocalization,
  SubscriptionConfig,
  SubscriptionGroupConfig,
  SubscriptionPeriod,
} from '../types.js';

/** Apple's `inAppPurchaseType` values Launch models — used to validate an imported product's kind. */
const IN_APP_PURCHASE_TYPES = new Set<InAppPurchaseType>([
  'CONSUMABLE',
  'NON_CONSUMABLE',
  'NON_RENEWING_SUBSCRIPTION',
]);

/** Apple's `subscriptionPeriod` values — used to validate an imported subscription's billing period. */
const SUBSCRIPTION_PERIODS = new Set<SubscriptionPeriod>([
  'ONE_WEEK',
  'ONE_MONTH',
  'TWO_MONTHS',
  'THREE_MONTHS',
  'SIX_MONTHS',
  'ONE_YEAR',
]);

/** Narrow a raw `inAppPurchaseType` string to the modeled union, or null when Apple sent one we don't model. */
function toInAppPurchaseType(value: string): InAppPurchaseType | null {
  return (IN_APP_PURCHASE_TYPES as Set<string>).has(value) ? (value as InAppPurchaseType) : null;
}

/** Narrow a raw `subscriptionPeriod` string to the modeled union, or null when it's missing/unknown. */
function toSubscriptionPeriod(value: string | undefined): SubscriptionPeriod | null {
  return value !== undefined && (SUBSCRIPTION_PERIODS as Set<string>).has(value)
    ? (value as SubscriptionPeriod)
    : null;
}

/** Map Apple's localizations to config localizations, keeping a description only when Apple has one. */
function toProductLocalizations(localizations: LocalizationResource[]): ProductLocalization[] {
  return localizations.map((localization) => ({
    locale: localization.locale,
    name: localization.name,
    ...(localization.description ? { description: localization.description } : {}),
  }));
}

/** Import one in-app purchase into config + a one-line plan write, noting an un-imported price. */
async function importInAppPurchase(
  asc: AdoptCatalogApi,
  bundleId: string,
  iap: InAppPurchaseResource,
): Promise<PlannedWrite | null> {
  const type = toInAppPurchaseType(iap.inAppPurchaseType);
  if (!type) return null;
  const [localizations, hasPrice] = await Promise.all([
    asc.listInAppPurchaseLocalizations(iap.id),
    asc.inAppPurchaseHasPrice(iap.id),
  ]);
  const config: InAppPurchaseConfig = {
    productId: iap.productId,
    referenceName: iap.name,
    type,
    localizations: toProductLocalizations(localizations),
  };
  return {
    description: `products: import in-app purchase ${iap.productId} (${type})`,
    fidelity: 'importable',
    ...(hasPrice
      ? {
          note: 'priced on App Store Connect — add `price` in config or keep managing it in the UI',
        }
      : {}),
    change: { home: 'launch.config', bundleId, piece: { type: 'iap', iap: config } },
  };
}

/** Import one subscription into config, returning the config and whether a price went un-imported. */
async function importSubscription(
  asc: AdoptCatalogApi,
  subscription: SubscriptionResource,
): Promise<{ config: SubscriptionConfig; pricedUnimported: boolean } | null> {
  const period = toSubscriptionPeriod(subscription.subscriptionPeriod);
  if (!period) return null;
  const [localizations, hasPrice] = await Promise.all([
    asc.listSubscriptionLocalizations(subscription.id),
    asc.subscriptionHasPrice(subscription.id),
  ]);
  return {
    config: {
      productId: subscription.productId,
      referenceName: subscription.name,
      subscriptionPeriod: period,
      localizations: toProductLocalizations(localizations),
    },
    pricedUnimported: hasPrice,
  };
}

/** Import one subscription group (its display names + every level) into a single plan write. */
async function importSubscriptionGroup(
  asc: AdoptCatalogApi,
  bundleId: string,
  group: { id: string; referenceName: string },
): Promise<PlannedWrite | null> {
  const [groupLocalizations, subscriptions] = await Promise.all([
    asc.listSubscriptionGroupLocalizations(group.id),
    asc.listSubscriptions(group.id),
  ]);
  const imported = (
    await Promise.all(subscriptions.map((subscription) => importSubscription(asc, subscription)))
  ).filter(
    (entry): entry is { config: SubscriptionConfig; pricedUnimported: boolean } => entry !== null,
  );
  if (imported.length === 0) return null;

  const config: SubscriptionGroupConfig = {
    referenceName: group.referenceName,
    localizations: groupLocalizations.map((localization) => ({
      locale: localization.locale,
      name: localization.name,
    })),
    subscriptions: imported.map((entry) => entry.config),
  };
  const priced = imported
    .filter((entry) => entry.pricedUnimported)
    .map((entry) => entry.config.productId);
  return {
    description: `products: import subscription group "${group.referenceName}" (${imported.length} level${imported.length === 1 ? '' : 's'})`,
    fidelity: 'importable',
    ...(priced.length > 0
      ? {
          note: `priced on App Store Connect, not imported — set \`price\` for: ${priced.join(', ')}`,
        }
      : {}),
    change: {
      home: 'launch.config',
      bundleId,
      piece: { type: 'subscriptionGroup', group: config },
    },
  };
}

/** Read an app's products from App Store Connect and plan the `launch.config.ts` writes (keyed by bundle id). */
export const productsAdopter: Adopter = {
  domain: 'products',
  fidelity: 'importable',
  async read(asc: AdoptCatalogApi, target: AdoptTarget): Promise<PlannedWrite[]> {
    const [iaps, groups] = await Promise.all([
      asc.listInAppPurchases(target.appId),
      asc.listSubscriptionGroups(target.appId),
    ]);
    const iapWrites = await Promise.all(
      iaps.map((iap) => importInAppPurchase(asc, target.bundleId, iap)),
    );
    const groupWrites = await Promise.all(
      groups.map((group) => importSubscriptionGroup(asc, target.bundleId, group)),
    );
    return [...iapWrites, ...groupWrites].filter((write): write is PlannedWrite => write !== null);
  },
};
