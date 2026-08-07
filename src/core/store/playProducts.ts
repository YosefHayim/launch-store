import { Data, Effect } from 'effect';
import type { InAppProductResource, PlayMoney } from '../types/googlePlay.js';
import type { InAppPurchaseConfig, PlayPriceConfig } from '../types/catalog.js';
import type { PlannedAction } from '../types/reconcile.js';
import { plan, type ReconcileContext } from './reconcile.js';
import { errorMessage } from '../services/errorMessage.js';
import type { MutableDeep } from '../types/mutable.js';
/** Play's purchase type for a one-off managed (non-subscription) product. */
const MANAGED_PRODUCT = 'managedUser';
/** Status Launch publishes products as - declaring a `play` override means "this product should be sellable". */
const ACTIVE_STATUS = 'active';
/**
 * The slice of {@link GooglePlayClient} the products reconciler depends on. Declared here (not the
 * concrete client) so the diff logic is unit-testable with a hand-rolled fake; `GooglePlayClient`
 * satisfies it structurally, mirroring {@link AscAccessibilityApi} in `accessibility.ts`.
 */
export type PlayProductsApi = {
  assertAppExists(packageName: string): Effect.Effect<void, unknown>;
  listInAppProducts(packageName: string): Effect.Effect<InAppProductResource[], unknown>;
  insertInAppProduct(
    packageName: string,
    product: InAppProductResource,
  ): Effect.Effect<void, unknown>;
  updateInAppProduct(
    packageName: string,
    product: InAppProductResource,
  ): Effect.Effect<void, unknown>;
};
/** Inputs to reconcile one app's Play in-app products. */
export type PlayProductsReconcileInput = {
  packageName: string;
  products: InAppPurchaseConfig[];
  dryRun: boolean;
};
/** Map a config price (micro-units + currency) to the client's wire money shape. */
const toMoney = (price: PlayPriceConfig): PlayMoney => {
  return { priceMicros: price.priceMicros, currency: price.currency };
};
/**
 * Build the Play product Launch wants from one declared in-app purchase. The SKU defaults to the shared
 * Apple `productId`; the default language and listings come from the product's localizations (name ->
 * title, description -> description); pricing comes from the `play` override. Throws when the product has
 * no localization, since Play requires a default language Launch derives from the first one.
 */
export type PlayProductConfigFailure = Readonly<{
  readonly _tag: 'PlayProductConfigFailure';
  readonly message: string;
}>;

/** Build a typed configuration failure for a Play product. */
export const makePlayProductConfigFailure = Data.tagged<PlayProductConfigFailure>(
  'PlayProductConfigFailure',
);

export const toPlayProduct = (
  config: InAppPurchaseConfig,
): Effect.Effect<InAppProductResource, PlayProductConfigFailure> => {
  const playOverrides = config.play;
  let sku = config.productId;
  if (playOverrides?.sku !== undefined) sku = playOverrides.sku;
  const defaultLocale = config.localizations[0]?.locale;
  if (defaultLocale === undefined) {
    return Effect.fail(
      makePlayProductConfigFailure({
        message: `Play product ${sku} needs at least one localization (used as its default language).`,
      }),
    );
  }
  const listings: Record<
    string,
    {
      title: string;
      description?: string;
    }
  > = {};
  for (const localization of config.localizations) {
    const listing: { title: string; description?: string } = {
      title: localization.name,
    };
    if (localization.description !== undefined) listing.description = localization.description;
    listings[localization.locale] = listing;
  }
  const prices: Record<string, PlayMoney> = {};
  if (playOverrides?.prices !== undefined) {
    for (const [region, price] of Object.entries(playOverrides.prices)) {
      prices[region] = toMoney(price);
    }
  }
  const desiredProduct: MutableDeep<InAppProductResource> = {
    sku,
    status: ACTIVE_STATUS,
    purchaseType: MANAGED_PRODUCT,
    defaultLanguage: defaultLocale,
    listings,
  };
  if (playOverrides?.defaultPrice !== undefined) {
    desiredProduct.defaultPrice = toMoney(playOverrides.defaultPrice);
  }
  if (Object.keys(prices).length > 0) desiredProduct.prices = prices;
  return Effect.succeed(desiredProduct);
};
/** Whether two money values agree on amount and currency (both absent counts as equal). */
const moneyEquals = (a: PlayMoney | undefined, b: PlayMoney | undefined): boolean => {
  if (a?.priceMicros !== b?.priceMicros) return false;
  return a?.currency === b?.currency;
};
/**
 * Whether the live product already satisfies everything Launch manages. A *subset* check: it only
 * inspects the fields Launch writes, and for prices/listings only the entries config names - so Play's
 * auto-fanned regional prices and any console-only fields never trigger a spurious update.
 */
export const productInSync = (
  current: InAppProductResource,
  desired: InAppProductResource,
): boolean => {
  if (current.status !== desired.status) return false;
  if (current.purchaseType !== desired.purchaseType) return false;
  if (current.defaultLanguage !== desired.defaultLanguage) return false;
  if (!moneyEquals(current.defaultPrice, desired.defaultPrice)) return false;
  if (desired.prices !== undefined) {
    for (const [region, desiredPrice] of Object.entries(desired.prices)) {
      if (!moneyEquals(current.prices?.[region], desiredPrice)) return false;
    }
  }
  if (desired.listings !== undefined) {
    for (const [locale, desiredListing] of Object.entries(desired.listings)) {
      const currentListing = current.listings?.[locale];
      if (currentListing === undefined) return false;
      if (currentListing.title !== desiredListing.title) return false;
      if (currentListing.description !== desiredListing.description) return false;
    }
  }
  return true;
};
/**
 * Merge the fields Launch manages onto the live product so an update preserves everything else Play
 * holds - most importantly the regional prices Play fans out from `defaultPrice`, which a bare replace
 * would wipe.
 */
const mergeOntoCurrent = (
  current: InAppProductResource,
  desired: InAppProductResource,
): InAppProductResource => {
  // `desired` (from toPlayProduct) only ever carries defined fields, so spreading it over `current`
  // overrides the managed fields without clobbering Play's other state. Prices and listings are then
  // merged key-wise so Play's auto-fanned regions and any extra locales survive.
  return {
    ...current,
    ...desired,
    prices: { ...current.prices, ...desired.prices },
    listings: { ...current.listings, ...desired.listings },
  };
};
/**
 * Reconcile one app's Play in-app products. Throws only for a precondition the user must fix (the Play
 * app record is unreachable, via {@link PlayProductsApi.assertAppExists}); everything else is captured
 * per-action so a single failure never aborts the run.
 */
export const reconcilePlayProducts = (
  api: PlayProductsApi,
  input: PlayProductsReconcileInput,
): Effect.Effect<
  { packageName: string; actions: PlannedAction[] },
  PlayProductConfigFailure | unknown
> =>
  Effect.gen(function* () {
    const reconcileContext: ReconcileContext = { actions: [], dryRun: input.dryRun };
    yield* api.assertAppExists(input.packageName);
    const products = yield* api.listInAppProducts(input.packageName);
    const liveProductsBySku = new Map<string, InAppProductResource>();
    for (const liveProduct of products) liveProductsBySku.set(liveProduct.sku, liveProduct);
    for (const product of input.products) {
      const desired = yield* toPlayProduct(product);
      const current = liveProductsBySku.get(desired.sku);
      if (!current) yield* createProduct(reconcileContext, api, input.packageName, desired);
      else if (!productInSync(current, desired))
        yield* updateProduct(reconcileContext, api, input.packageName, current, desired);
    }
    return { packageName: input.packageName, actions: reconcileContext.actions };
  });
/** Create a new active managed product for a SKU Play doesn't have yet. */
const createProduct = (
  reconcileContext: ReconcileContext,
  api: PlayProductsApi,
  packageName: string,
  desired: InAppProductResource,
): Effect.Effect<void> => {
  const action = plan(reconcileContext, `create Play product ${desired.sku}`);
  if (reconcileContext.dryRun) return Effect.void;
  return api.insertInAppProduct(packageName, desired).pipe(
    Effect.match({
      onFailure: (writeFailure) => {
        action.status = 'failed';
        action.error = errorMessage(writeFailure);
      },
      onSuccess: () => {
        action.status = 'applied';
      },
    }),
  );
};
/** Update a drifted product, merging the managed fields onto the live one so Play's own fields survive. */
const updateProduct = (
  reconcileContext: ReconcileContext,
  api: PlayProductsApi,
  packageName: string,
  current: InAppProductResource,
  desired: InAppProductResource,
): Effect.Effect<void> => {
  const action = plan(reconcileContext, `update Play product ${desired.sku}`);
  if (reconcileContext.dryRun) return Effect.void;
  return api.updateInAppProduct(packageName, mergeOntoCurrent(current, desired)).pipe(
    Effect.match({
      onFailure: (writeFailure) => {
        action.status = 'failed';
        action.error = errorMessage(writeFailure);
      },
      onSuccess: () => {
        action.status = 'applied';
      },
    }),
  );
};
/** Tally a report's action statuses for the run summary (mirrors the other store-sync commands). */
export const summarizePlayProducts = (
  actions: PlannedAction[],
): {
  applied: number;
  failed: number;
  skipped: number;
} => {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    if (action.status === 'applied') applied++;
    else if (action.status === 'failed') failed++;
    else if (action.status === 'skipped') skipped++;
  }
  return { applied, failed, skipped };
};
