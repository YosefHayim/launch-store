// Reconciles in-app products on Google Play with the products Launch declares.

import type { InAppProductResource, PlayMoney } from '@/types/google-play.js';
import type { InAppPurchaseConfig, PlayPriceConfig } from '@/types/catalog.js';
import type { PlannedAction } from '@/types/reconcile.js';
import { plan, type ReconcileContext } from '@/store/shared/reconcile.js';
import { errorMessage } from '@/services/platform/error-message.js';
import type { MutableDeep } from '@/types/mutable.js';

/** The slice of GooglePlayClient the products reconciler depends on. */
export type PlayProductsApi = {
  assertAppExists(packageName: string): Promise<void>;

  listInAppProducts(packageName: string): Promise<InAppProductResource[]>;

  insertInAppProduct(packageName: string, product: InAppProductResource): Promise<void>;

  updateInAppProduct(packageName: string, product: InAppProductResource): Promise<void>;
};

/** Inputs to reconcile one app's Play in-app products. */
type PlayProductsReconcileInput = {
  packageName: string;
  products: InAppPurchaseConfig[];
  dryRun: boolean;
};

function readPlayMoney(price: PlayPriceConfig): PlayMoney {
  return { priceMicros: price.priceMicros, currency: price.currency };
}

type PlayProductConfigFailure = Readonly<{
  readonly _tag: 'PlayProductConfigFailure';
  readonly message: string;
}>;

function makePlayProductConfigFailure(fields: { message: string }): PlayProductConfigFailure {
  return { _tag: 'PlayProductConfigFailure', ...fields };
}

/** Build the Play product Launch wants from one declared in-app purchase. */
export function readPlayProduct(purchase: InAppPurchaseConfig): InAppProductResource {
  const playOverrides = purchase.play;
  let sku = purchase.productId;
  const overrideSku = playOverrides?.sku ?? null;

  if (overrideSku != null) {
    sku = overrideSku;
  }

  const defaultLocale = purchase.localizations[0]?.locale;

  if (defaultLocale == null) {
    throw makePlayProductConfigFailure({
      message: `Play product ${sku} needs at least one localization (used as its default language).`,
    });
  }

  const listings: Record<string, { title: string; description?: string }> = {};

  for (const localization of purchase.localizations) {
    const listing: { title: string; description?: string } = {
      title: localization.name,
    };

    if (localization.description != null) {
      listing.description = localization.description;
    }

    listings[localization.locale] = listing;
  }

  const prices: Record<string, PlayMoney> = {};

  if (playOverrides?.prices != null) {
    for (const [region, price] of Object.entries(playOverrides.prices)) {
      prices[region] = readPlayMoney(price);
    }
  }

  const desiredProduct: MutableDeep<InAppProductResource> = {
    sku,
    status: 'active',
    purchaseType: 'managedUser',
    defaultLanguage: defaultLocale,
    listings,
  };

  if (playOverrides?.defaultPrice != null) {
    desiredProduct.defaultPrice = readPlayMoney(playOverrides.defaultPrice);
  }

  const hasRegionalPrices = Object.keys(prices).length > 0;

  if (hasRegionalPrices) {
    desiredProduct.prices = prices;
  }

  return desiredProduct;
}

function moneyEquals(left: PlayMoney | undefined, right: PlayMoney | undefined): boolean {
  if (left == null) {
    return right == null;
  }

  if (right == null) {
    return false;
  }

  if (left.priceMicros != right.priceMicros) {
    return false;
  }

  return left.currency == right.currency;
}

function regionPriceMatches(
  current: InAppProductResource,
  region: string,
  desiredPrice: PlayMoney,
): boolean {
  return moneyEquals(current.prices?.[region], desiredPrice);
}

/** Whether the live product already satisfies everything Launch manages. */
export function productInSync(
  current: InAppProductResource,
  desired: InAppProductResource,
): boolean {
  if (current.status != desired.status) {
    return false;
  }

  if (current.purchaseType != desired.purchaseType) {
    return false;
  }

  if (current.defaultLanguage != desired.defaultLanguage) {
    return false;
  }

  const defaultPriceMatches = moneyEquals(current.defaultPrice, desired.defaultPrice);

  if (defaultPriceMatches == false) {
    return false;
  }

  if (desired.prices != null) {
    for (const [region, desiredPrice] of Object.entries(desired.prices)) {
      const priceMatches = regionPriceMatches(current, region, desiredPrice);

      if (priceMatches == false) {
        return false;
      }
    }
  }

  if (desired.listings != null) {
    for (const [locale, desiredListing] of Object.entries(desired.listings)) {
      const currentListing = current.listings?.[locale];

      if (currentListing == null) {
        return false;
      }

      if (currentListing.title != desiredListing.title) {
        return false;
      }

      if (currentListing.description != desiredListing.description) {
        return false;
      }
    }
  }

  return true;
}

/** Merge the fields Launch manages onto the live product so an update preserves everything else */
function mergeOntoCurrent(
  current: InAppProductResource,
  desired: InAppProductResource,
): InAppProductResource {
  return {
    ...current,
    ...desired,
    prices: { ...current.prices, ...desired.prices },
    listings: { ...current.listings, ...desired.listings },
  };
}

async function recordWrite(write: Promise<void>, action: PlannedAction): Promise<void> {
  try {
    await write;
    action.status = 'applied';
  } catch (writeFailure) {
    action.status = 'failed';
    action.error = errorMessage(writeFailure);
  }
}

async function createProduct(
  reconcileContext: ReconcileContext,
  api: PlayProductsApi,
  packageName: string,
  desired: InAppProductResource,
): Promise<void> {
  const action = plan(reconcileContext, `create Play product ${desired.sku}`);

  if (reconcileContext.dryRun) {
    return;
  }

  await recordWrite(api.insertInAppProduct(packageName, desired), action);
}

async function updateProduct(
  reconcileContext: ReconcileContext,
  api: PlayProductsApi,
  packageName: string,
  current: InAppProductResource,
  desired: InAppProductResource,
): Promise<void> {
  const action = plan(reconcileContext, `update Play product ${desired.sku}`);

  if (reconcileContext.dryRun) {
    return;
  }

  const mergedProduct = mergeOntoCurrent(current, desired);

  await recordWrite(api.updateInAppProduct(packageName, mergedProduct), action);
}

/** Reconcile one app's Play in-app products. */
export async function reconcilePlayProducts(
  api: PlayProductsApi,
  reconcileInput: PlayProductsReconcileInput,
): Promise<{ packageName: string; actions: PlannedAction[] }> {
  const reconcileContext: ReconcileContext = { actions: [], dryRun: reconcileInput.dryRun };

  await api.assertAppExists(reconcileInput.packageName);

  const products = await api.listInAppProducts(reconcileInput.packageName);
  const liveProductsBySku = new Map<string, InAppProductResource>();

  for (const liveProduct of products) {
    liveProductsBySku.set(liveProduct.sku, liveProduct);
  }

  for (const product of reconcileInput.products) {
    const desired = readPlayProduct(product);
    const current = liveProductsBySku.get(desired.sku) ?? null;

    if (current == null) {
      await createProduct(reconcileContext, api, reconcileInput.packageName, desired);
      continue;
    }

    const isInSync = productInSync(current, desired);

    if (isInSync) {
      continue;
    }

    await updateProduct(reconcileContext, api, reconcileInput.packageName, current, desired);
  }

  return { packageName: reconcileInput.packageName, actions: reconcileContext.actions };
}

/** Tally a report's action statuses for the run summary. */
export function summarizePlayProducts(actions: PlannedAction[]): {
  applied: number;
  failed: number;
  skipped: number;
} {
  let applied = 0;
  let failed = 0;
  let skipped = 0;

  for (const action of actions) {
    if (action.status == 'applied') {
      applied += 1;
      continue;
    }

    if (action.status == 'failed') {
      failed += 1;
      continue;
    }

    if (action.status == 'skipped') {
      skipped += 1;
    }
  }

  return { applied, failed, skipped };
}
