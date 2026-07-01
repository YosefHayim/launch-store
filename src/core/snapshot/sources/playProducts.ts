/**
 * Source: capture each Android app's managed in-app products from Google Play — the Play half of the
 * snapshot's product catalog. Read-only, via the same `listInAppProducts` reader `launch sync` uses.
 *
 * Recording is deliberately lean: the SKU, status, default language, default price, and listings — but
 * **not** the full per-region price map. Play auto-fans a single `defaultPrice` out to ~150 regional
 * prices, so capturing them all would bloat every snapshot and make routine diffs noisy; the default price
 * captures the pricing intent that actually changes.
 */

import type {
  AppEntities,
  InAppPurchaseConfig,
  JsonValue,
  PlayProductOverride,
  ProductLocalization,
  RestoreInput,
  RestoreReport,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
  SourceCapture,
} from '../../types.js';
import type { InAppProductResource, PlayMoney } from '../../../google/playClient.js';
import type { PlannedAction } from '../../ascSync.js';
import { reconcilePlayProducts } from '../../playProducts.js';
import { androidApps } from '../../readiness/appScopes.js';
import {
  jsonRecord,
  restoreErrorMessage,
  skippedAction,
  stringField,
  toPriceConfig,
} from './playRestore.js';

/** A Play money value as a normalized, serializable record (fields Play left unset are dropped). */
function money(value: PlayMoney): JsonValue {
  return {
    ...(value.priceMicros ? { priceMicros: value.priceMicros } : {}),
    ...(value.currency ? { currency: value.currency } : {}),
  };
}

/** A product's locale → listing copy, normalized to serializable records (empty fields dropped). */
function listings(map: Record<string, { title?: string; description?: string }>): JsonValue {
  return Object.fromEntries(
    Object.entries(map).map(([locale, listing]): [string, JsonValue] => [
      locale,
      {
        ...(listing.title ? { title: listing.title } : {}),
        ...(listing.description ? { description: listing.description } : {}),
      },
    ]),
  );
}

/** One captured managed product → a snapshot entity keyed by its SKU. */
function toEntity(product: InAppProductResource): SnapshotEntity {
  const data: JsonValue = {
    sku: product.sku,
    ...(product.status ? { status: product.status } : {}),
    ...(product.defaultLanguage ? { defaultLanguage: product.defaultLanguage } : {}),
    ...(product.defaultPrice ? { defaultPrice: money(product.defaultPrice) } : {}),
    ...(product.listings ? { listings: listings(product.listings) } : {}),
  };
  const statusSuffix = product.status ? ` (${product.status})` : '';
  return { key: product.sku, summary: `Play product${statusSuffix}`, data };
}

/**
 * Invert a captured product's `listings` map back into the shared {@link ProductLocalization} list the
 * reconciler reads (title → name, description → description). The captured `defaultLanguage` is placed
 * first because {@link import("../../playProducts.js").toPlayProduct} derives the Play default language
 * from the first localization; the rest follow sorted for a deterministic restore. Listings with no title
 * are dropped — Play requires a title, so a title-less locale can't become a localization.
 */
function toLocalizations(
  listings: JsonValue | undefined,
  defaultLanguage: string | undefined,
): ProductLocalization[] {
  const map = jsonRecord(listings);
  if (!map) return [];
  const localizations: ProductLocalization[] = [];
  for (const [locale, value] of Object.entries(map)) {
    const fields = jsonRecord(value);
    const name = fields ? stringField(fields, 'title') : undefined;
    if (name === undefined) continue;
    const localization: ProductLocalization = { locale, name };
    const description = fields ? stringField(fields, 'description') : undefined;
    if (description !== undefined) localization.description = description;
    localizations.push(localization);
  }
  localizations.sort((a, b) => {
    if (a.locale === defaultLanguage) return b.locale === defaultLanguage ? 0 : -1;
    if (b.locale === defaultLanguage) return 1;
    return a.locale.localeCompare(b.locale);
  });
  return localizations;
}

/**
 * Rebuild an {@link InAppPurchaseConfig} from one captured product entity, targeting the Play reconciler.
 * The SKU drives `productId` and the `play` override; pricing restores the captured `defaultPrice` (Play
 * fans it back out across regions, and the reconciler merges onto live so existing regional prices
 * survive). Apple-only fields the Play path ignores (`type`, `referenceName`) get neutral placeholders.
 * Returns `null` when the product has no restorable listing (the reconciler requires at least one).
 */
function toProductConfig(entity: SnapshotEntity): InAppPurchaseConfig | null {
  const data = jsonRecord(entity.data);
  if (!data) return null;
  const sku = stringField(data, 'sku') ?? entity.key;
  const localizations = toLocalizations(data['listings'], stringField(data, 'defaultLanguage'));
  if (localizations.length === 0) return null;

  const play: PlayProductOverride = { sku };
  const defaultPrice = toPriceConfig(data['defaultPrice']);
  if (defaultPrice) play.defaultPrice = defaultPrice;

  return { productId: sku, referenceName: sku, type: 'NON_CONSUMABLE', localizations, play };
}

/** The Google Play managed-product snapshot source. */
export const playProductsSource: SnapshotSource = {
  id: 'play-products',
  title: 'Google Play products',
  store: 'play',
  async capture(ctx: SnapshotContext): Promise<SourceCapture> {
    const apps = androidApps(ctx.apps);
    if (apps.length === 0) return { state: 'omitted' };

    const api = await ctx.resolvePlayApi();
    if (!api) {
      return {
        state: 'skipped',
        reason: 'no Play service account',
        hint: 'configure Play credentials',
      };
    }

    const captured = await Promise.all(
      apps.map(async ({ name, identifier }): Promise<AppEntities> => {
        const entities = (await api.listInAppProducts(identifier)).map(toEntity);
        return { app: name, identifier, entities };
      }),
    );
    return { state: 'captured', apps: captured };
  },

  /**
   * Restore each app's captured managed products to Google Play via the same `reconcilePlayProducts` the
   * `launch sync` / `launch plan` Play-products surface uses. Additive and merge-onto-live: it creates a
   * missing product or patches a drifted one, never deletes, and preserves Play's auto-fanned regional
   * prices. Each app is isolated — an unreachable Play app record is recorded as a skipped action rather
   * than aborting the rest — and a product with no restorable listing is skipped with a reason.
   */
  async restore({ ctx, saved, dryRun }: RestoreInput): Promise<RestoreReport> {
    const client = await ctx.resolvePlayWriteClient();
    if (!client) {
      return {
        actions: [skippedAction('Google Play products: skipped — no Play service account')],
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
            skippedAction(`Play product ${entity.key}: skipped — no listing to restore`),
          );
      }
      if (products.length === 0) continue;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: serial Google Play writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
        const report = await reconcilePlayProducts(client, {
          packageName: app.identifier,
          products,
          dryRun,
        });
        actions.push(...report.actions);
      } catch (error) {
        actions.push(
          skippedAction(`Google Play products ${app.identifier}: ${restoreErrorMessage(error)}`),
        );
      }
    }
    return { actions };
  },
};
