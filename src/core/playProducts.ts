/**
 * Reconcile an app's **Google Play in-app managed products** (`inappproducts`) from the shared
 * `launch.config.ts` product catalog, using the Play service account alone. This is the Play twin of the
 * App Store Connect in-app-purchase leg of `launch sync`: the one-off (non-subscription) products a user
 * declares under `products[bundleId].inAppPurchases` are published to Play whenever they carry a
 * {@link PlayProductOverride} under `play`. Products without that override stay Apple-only.
 *
 * Per declared product (matched by SKU):
 * 1. **Create** an active managed product when Play has none with that SKU.
 * 2. **Update** when a managed field drifted from config — merged ONTO the live product so Play's
 *    auto-generated regional prices and any console-managed fields survive the write.
 * 3. **Skip** (no action emitted) when every field Launch manages already matches.
 *
 * Mirrors {@link reconcileAccessibility `core/accessibility.ts`}: a read-only PLAN pass builds idempotent
 * {@link PlannedAction}s, the command prints them, then an APPLY pass performs them with each action
 * isolated so one failure never aborts the rest. **Additive** — a Play product whose SKU isn't in config
 * is left untouched (deleting a product is a destructive Play Console action Launch won't take).
 *
 * The diff is deliberately a *subset* check: Play fans a single `defaultPrice` out to ~150 regional
 * prices, so comparing the full price map would never converge. Launch only compares the fields it
 * writes — status, purchase type, default language/price, the regions explicitly listed in config, and
 * the listings derived from the product's localizations — and on update merges those onto the live
 * product rather than replacing it.
 */

import type { InAppProductResource, PlayMoney } from "../google/playClient.js";
import type { InAppPurchaseConfig, PlayPriceConfig } from "./types.js";
import type { PlannedAction } from "./ascSync.js";

/** Play's purchase type for a one-off managed (non-subscription) product. */
const MANAGED_PRODUCT = "managedUser";
/** Status Launch publishes products as — declaring a `play` override means "this product should be sellable". */
const ACTIVE_STATUS = "active";

/**
 * The slice of {@link GooglePlayClient} the products reconciler depends on. Declared here (not the
 * concrete client) so the diff logic is unit-testable with a hand-rolled fake; `GooglePlayClient`
 * satisfies it structurally, mirroring {@link AscAccessibilityApi} in `accessibility.ts`.
 */
export interface PlayProductsApi {
  assertAppExists(packageName: string): Promise<void>;
  listInAppProducts(packageName: string): Promise<InAppProductResource[]>;
  insertInAppProduct(packageName: string, product: InAppProductResource): Promise<void>;
  updateInAppProduct(packageName: string, product: InAppProductResource): Promise<void>;
}

/** Inputs to reconcile one app's Play in-app products. */
export interface PlayProductsReconcileInput {
  /** The app's Android application id (Play package name) — the product catalog hangs off it. */
  packageName: string;
  /** The app's declared in-app purchases; only those carrying a `play` override are reconciled. */
  products: InAppPurchaseConfig[];
  /** Rehearse only: read state and build the plan, perform no writes. */
  dryRun: boolean;
}

/** Mutable per-run context threaded through the reconcile walk (mirrors `core/accessibility.ts`). */
interface ReconcileContext {
  actions: PlannedAction[];
  dryRun: boolean;
}

/** Push a planned action and return its handle, so the caller can mark it applied/failed after running. */
function plan(ctx: ReconcileContext, description: string): PlannedAction {
  const action: PlannedAction = { description, destructive: false, status: "planned" };
  ctx.actions.push(action);
  return action;
}

/** A short message for a thrown value (Play product writes carry no secrets). */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Map a config price (micro-units + currency) to the client's wire money shape. */
function toMoney(price: PlayPriceConfig): PlayMoney {
  return { priceMicros: price.priceMicros, currency: price.currency };
}

/**
 * Build the Play product Launch wants from one declared in-app purchase. The SKU defaults to the shared
 * Apple `productId`; the default language and listings come from the product's localizations (name →
 * title, description → description); pricing comes from the `play` override. Throws when the product has
 * no localization, since Play requires a default language Launch derives from the first one.
 */
export function toPlayProduct(config: InAppPurchaseConfig): InAppProductResource {
  const play = config.play ?? {};
  const sku = play.sku ?? config.productId;
  const defaultLocale = config.localizations[0]?.locale;
  if (!defaultLocale) {
    throw new Error(`Play product ${sku} needs at least one localization (used as its default language).`);
  }

  const listings: Record<string, { title: string; description?: string }> = {};
  for (const localization of config.localizations) {
    listings[localization.locale] = {
      title: localization.name,
      ...(localization.description === undefined ? {} : { description: localization.description }),
    };
  }

  const prices: Record<string, PlayMoney> = {};
  for (const [region, price] of Object.entries(play.prices ?? {})) prices[region] = toMoney(price);

  return {
    sku,
    status: ACTIVE_STATUS,
    purchaseType: MANAGED_PRODUCT,
    defaultLanguage: defaultLocale,
    ...(play.defaultPrice ? { defaultPrice: toMoney(play.defaultPrice) } : {}),
    ...(Object.keys(prices).length > 0 ? { prices } : {}),
    listings,
  };
}

/** Whether two money values agree on amount and currency (both absent counts as equal). */
function moneyEquals(a: PlayMoney | undefined, b: PlayMoney | undefined): boolean {
  return (a?.priceMicros ?? "") === (b?.priceMicros ?? "") && (a?.currency ?? "") === (b?.currency ?? "");
}

/**
 * Whether the live product already satisfies everything Launch manages. A *subset* check: it only
 * inspects the fields Launch writes, and for prices/listings only the entries config names — so Play's
 * auto-fanned regional prices and any console-only fields never trigger a spurious update.
 */
export function productInSync(current: InAppProductResource, desired: InAppProductResource): boolean {
  if ((current.status ?? "") !== (desired.status ?? "")) return false;
  if ((current.purchaseType ?? "") !== (desired.purchaseType ?? "")) return false;
  if ((current.defaultLanguage ?? "") !== (desired.defaultLanguage ?? "")) return false;
  if (!moneyEquals(current.defaultPrice, desired.defaultPrice)) return false;
  for (const [region, price] of Object.entries(desired.prices ?? {})) {
    if (!moneyEquals(current.prices?.[region], price)) return false;
  }
  for (const [locale, listing] of Object.entries(desired.listings ?? {})) {
    const live = current.listings?.[locale];
    if (
      !live ||
      (live.title ?? "") !== (listing.title ?? "") ||
      (live.description ?? "") !== (listing.description ?? "")
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Merge the fields Launch manages onto the live product so an update preserves everything else Play
 * holds — most importantly the regional prices Play fans out from `defaultPrice`, which a bare replace
 * would wipe.
 */
function mergeOntoCurrent(current: InAppProductResource, desired: InAppProductResource): InAppProductResource {
  // `desired` (from toPlayProduct) only ever carries defined fields, so spreading it over `current`
  // overrides the managed fields without clobbering Play's other state. Prices and listings are then
  // merged key-wise so Play's auto-fanned regions and any extra locales survive.
  return {
    ...current,
    ...desired,
    prices: { ...current.prices, ...desired.prices },
    listings: { ...current.listings, ...desired.listings },
  };
}

/**
 * Reconcile one app's Play in-app products. Throws only for a precondition the user must fix (the Play
 * app record is unreachable, via {@link PlayProductsApi.assertAppExists}); everything else is captured
 * per-action so a single failure never aborts the run.
 */
export async function reconcilePlayProducts(
  api: PlayProductsApi,
  input: PlayProductsReconcileInput,
): Promise<{ packageName: string; actions: PlannedAction[] }> {
  const ctx: ReconcileContext = { actions: [], dryRun: input.dryRun };

  await api.assertAppExists(input.packageName);
  const live = new Map(
    (await api.listInAppProducts(input.packageName)).map((product) => [product.sku, product] as const),
  );

  for (const product of input.products) {
    const desired = toPlayProduct(product);
    const current = live.get(desired.sku);
    if (!current) await createProduct(ctx, api, input.packageName, desired);
    else if (!productInSync(current, desired)) await updateProduct(ctx, api, input.packageName, current, desired);
  }
  return { packageName: input.packageName, actions: ctx.actions };
}

/** Create a new active managed product for a SKU Play doesn't have yet. */
async function createProduct(
  ctx: ReconcileContext,
  api: PlayProductsApi,
  packageName: string,
  desired: InAppProductResource,
): Promise<void> {
  const action = plan(ctx, `create Play product ${desired.sku}`);
  if (ctx.dryRun) return;
  try {
    await api.insertInAppProduct(packageName, desired);
    action.status = "applied";
  } catch (error) {
    action.status = "failed";
    action.error = errorMessage(error);
  }
}

/** Update a drifted product, merging the managed fields onto the live one so Play's own fields survive. */
async function updateProduct(
  ctx: ReconcileContext,
  api: PlayProductsApi,
  packageName: string,
  current: InAppProductResource,
  desired: InAppProductResource,
): Promise<void> {
  const action = plan(ctx, `update Play product ${desired.sku}`);
  if (ctx.dryRun) return;
  try {
    await api.updateInAppProduct(packageName, mergeOntoCurrent(current, desired));
    action.status = "applied";
  } catch (error) {
    action.status = "failed";
    action.error = errorMessage(error);
  }
}

/** Tally a report's action statuses for the run summary (mirrors the other store-sync commands). */
export function summarizePlayProducts(actions: PlannedAction[]): { applied: number; failed: number; skipped: number } {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    if (action.status === "applied") applied++;
    else if (action.status === "failed") failed++;
    else if (action.status === "skipped") skipped++;
  }
  return { applied, failed, skipped };
}
