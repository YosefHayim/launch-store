import { Effect } from 'effect';
import type {
  InAppPurchaseConfig,
  PlayProductOverride,
  ProductLocalization,
} from '@core/types/catalog.js';
import type {
  JsonValue,
  RestoreInput,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
} from '@core/types/snapshot.js';
import type { InAppProductResource, PlayMoney } from '@core/types/googlePlay.js';
import type { PlannedAction } from '@core/types/reconcile.js';
import { reconcilePlayProducts } from '@core/store/playProducts.js';
import { androidApps } from '@core/readiness/appScopes.js';
import type { MutableDeep } from '@core/types/mutable.js';
import {
  jsonRecord,
  restoreErrorMessage,
  skippedAction,
  stringField,
  toPriceConfig,
} from './playRestore.js';
/** A Play money value as a normalized, serializable record (fields Play left unset are dropped). */
const money = (playMoney: PlayMoney): JsonValue => {
  const moneyFields: Record<string, JsonValue> = {};
  if (playMoney.priceMicros) moneyFields['priceMicros'] = playMoney.priceMicros;
  if (playMoney.currency) moneyFields['currency'] = playMoney.currency;
  return moneyFields;
};
/** A product's locale -> listing copy, normalized to serializable records (empty fields dropped). */
const listings = (
  map: Record<
    string,
    {
      title?: string;
      description?: string;
    }
  >,
): JsonValue => {
  return Object.fromEntries(
    Object.entries(map).map(([locale, listing]): [string, JsonValue] => {
      const listingFields: Record<string, JsonValue> = {};
      if (listing.title) listingFields['title'] = listing.title;
      if (listing.description) listingFields['description'] = listing.description;
      return [locale, listingFields];
    }),
  );
};
/** One captured managed product -> a snapshot entity keyed by its SKU. */
const toEntity = (product: InAppProductResource): SnapshotEntity => {
  const productFields: Record<string, JsonValue> = { sku: product.sku };
  if (product.status) productFields['status'] = product.status;
  if (product.defaultLanguage) productFields['defaultLanguage'] = product.defaultLanguage;
  if (product.defaultPrice) productFields['defaultPrice'] = money(product.defaultPrice);
  if (product.listings) productFields['listings'] = listings(product.listings);
  let statusSuffix = '';
  if (product.status) statusSuffix = ` (${product.status})`;
  return { key: product.sku, summary: `Play product${statusSuffix}`, data: productFields };
};
/**
 * Invert a captured product's `listings` map back into the shared {@link ProductLocalization} list the
 * reconciler reads (title -> name, description -> description). The captured `defaultLanguage` is placed
 * first because {@link import("../../store/playProducts.js").toPlayProduct} derives the Play default language
 * from the first localization; the rest follow sorted for a deterministic restore. Listings with no title
 * are dropped - Play requires a title, so a title-less locale can't become a localization.
 */
const toLocalizations = (
  listings: JsonValue | undefined,
  defaultLanguage: string | undefined,
): ProductLocalization[] => {
  const map = jsonRecord(listings);
  if (!map) return [];
  const localizations: ProductLocalization[] = [];
  for (const [locale, capturedListing] of Object.entries(map)) {
    const fields = jsonRecord(capturedListing);
    let name: string | undefined;
    if (fields) name = stringField(fields, 'title');
    if (name === undefined) continue;
    const localization: MutableDeep<ProductLocalization> = { locale, name };
    let description: string | undefined;
    if (fields) description = stringField(fields, 'description');
    if (description !== undefined) localization.description = description;
    localizations.push(localization);
  }
  localizations.sort((a, b) => {
    if (a.locale === defaultLanguage) {
      if (b.locale === defaultLanguage) return 0;
      return -1;
    }
    if (b.locale === defaultLanguage) return 1;
    return a.locale.localeCompare(b.locale);
  });
  return localizations;
};
/**
 * Rebuild an {@link InAppPurchaseConfig} from one captured product entity, targeting the Play reconciler.
 * The SKU drives `productId` and the `play` override; pricing restores the captured `defaultPrice` (Play
 * fans it back out across regions, and the reconciler merges onto live so existing regional prices
 * survive). Apple-only fields the Play path ignores (`type`, `referenceName`) get neutral placeholders.
 * Returns `null` when the product has no restorable listing (the reconciler requires at least one).
 */
const toProductConfig = (entity: SnapshotEntity): InAppPurchaseConfig | null => {
  const productFields = jsonRecord(entity.data);
  if (!productFields) return null;
  let sku = stringField(productFields, 'sku');
  if (sku === undefined) sku = entity.key;
  const localizations = toLocalizations(
    productFields['listings'],
    stringField(productFields, 'defaultLanguage'),
  );
  if (localizations.length === 0) return null;
  const play: MutableDeep<PlayProductOverride> = { sku };
  const defaultPrice = toPriceConfig(productFields['defaultPrice']);
  if (defaultPrice) play.defaultPrice = defaultPrice;
  return { productId: sku, referenceName: sku, type: 'NON_CONSUMABLE', localizations, play };
};
/** The Google Play managed-product snapshot source. */
export const playProductsSource: SnapshotSource = {
  id: 'play-products',
  title: 'Google Play products',
  store: 'play',
  capture(snapshotContext: SnapshotContext) {
    return Effect.gen(function* () {
      const apps = androidApps(snapshotContext.apps);
      if (apps.length === 0) return { state: 'omitted' };
      const api = yield* snapshotContext.resolvePlayApi();
      if (!api) {
        return {
          state: 'skipped',
          reason: 'no Play service account',
          hint: 'configure Play credentials',
        };
      }
      const captured = yield* Effect.forEach(
        apps,
        ({ name, identifier }) =>
          Effect.gen(function* () {
            const products = yield* api.listInAppProducts(identifier);
            const entities = products.map(toEntity);
            return { app: name, identifier, entities };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'captured', apps: captured };
    });
  },
  /**
   * Restore each app's captured managed products to Google Play via the same `reconcilePlayProducts` the
   * `launch sync` / `launch plan` Play-products surface uses. Additive and merge-onto-live: it creates a
   * missing product or patches a drifted one, never deletes, and preserves Play's auto-fanned regional
   * prices. Each app is isolated - an unreachable Play app record is recorded as a skipped action rather
   * than aborting the rest - and a product with no restorable listing is skipped with a reason.
   */
  restore({ ctx: restoreContext, saved, dryRun }: RestoreInput) {
    return Effect.gen(function* () {
      const client = yield* restoreContext.resolvePlayWriteClient();
      if (!client) {
        return {
          actions: [skippedAction('Google Play products: skipped - no Play service account')],
        };
      }
      const actions: PlannedAction[] = [];
      for (const app of saved) {
        const products: InAppPurchaseConfig[] = [];
        for (const entity of app.entities) {
          const config = toProductConfig(entity);
          if (config) products.push(config);
          else
            actions.push(
              skippedAction(`Play product ${entity.key}: skipped - no listing to restore`),
            );
        }
        if (products.length === 0) continue;
        const reconciliation = yield* reconcilePlayProducts(client, {
          packageName: app.identifier,
          products,
          dryRun,
        }).pipe(
          Effect.match({
            onFailure: (reconciliationFailure) => ({
              actions: [
                skippedAction(
                  `Google Play products ${app.identifier}: ${restoreErrorMessage(reconciliationFailure)}`,
                ),
              ],
            }),
            onSuccess: (reconciliationReport) => reconciliationReport,
          }),
        );
        actions.push(...reconciliation.actions);
      }
      return { actions };
    });
  },
};
