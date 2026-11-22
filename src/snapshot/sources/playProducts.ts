import type {
  InAppPurchaseConfig,
  PlayProductOverride,
  ProductLocalization,
} from '../../types/catalog.ts';
import type {
  JsonValue,
  RestoreInput,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
} from '../../types/snapshot.ts';
import type { InAppProductResource, PlayMoney } from '../../types/googlePlay.ts';
import type { PlannedAction } from '../../types/reconcile.ts';
import { reconcilePlayProducts } from '../../store/google/playProducts.ts';
import { androidApps } from '../../readiness/appScopes.ts';
import type { MutableDeep } from '../../types/mutable.ts';
import {
  jsonRecord,
  restoreErrorMessage,
  skippedAction,
  stringField,
  toPriceConfig,
} from './playRestore.ts';
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
 * first because {@link import("../../store/google/playProducts.ts").toPlayProduct} derives the Play default language
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
  capture: capturePlayProducts,
  /**
   * Restore each app's captured managed products to Google Play via the same `reconcilePlayProducts` the
   * `launch sync` / `launch plan` Play-products surface uses. Additive and merge-onto-live: it creates a
   * missing product or patches a drifted one, never deletes, and preserves Play's auto-fanned regional
   * prices. Each app is isolated - an unreachable Play app record is recorded as a skipped action rather
   * than aborting the rest - and a product with no restorable listing is skipped with a reason.
   */
  restore: restorePlayProducts,
};

type PlayCaptureEntry =
  | { readonly captured: { app: string; identifier: string; entities: SnapshotEntity[] } }
  | { readonly skipped: { app: string; identifier: string; reason: string } };

async function captureOneProductApp(
  snapshotContext: SnapshotContext,
  app: { name: string; identifier: string },
): Promise<PlayCaptureEntry> {
  const client = await snapshotContext.resolvePlayApi(app.identifier);

  if (client == null) {
    return {
      skipped: { app: app.name, identifier: app.identifier, reason: 'no Play service account' },
    };
  }

  const records = await client.listInAppProducts(app.identifier);

  return {
    captured: { app: app.name, identifier: app.identifier, entities: records.map(toEntity) },
  };
}

function capturedApps(entry: PlayCaptureEntry) {
  if ('captured' in entry) {
    return [entry.captured];
  }

  return [];
}

function skippedApps(entry: PlayCaptureEntry) {
  if ('skipped' in entry) {
    return [entry.skipped];
  }

  return [];
}

async function capturePlayProducts(snapshotContext: SnapshotContext) {
  const apps = androidApps(snapshotContext.apps);

  if (apps.length == 0) {
    return { state: 'omitted' as const };
  }

  const results = await Promise.all(
    apps.map(function captureNamedApp(app) {
      return captureOneProductApp(snapshotContext, app);
    }),
  );
  const captured = results.flatMap(capturedApps);
  const skipped = results.flatMap(skippedApps);

  if (captured.length == 0) {
    return {
      state: 'skipped' as const,
      reason: `no Play service account for ${skipped
        .map(function appName(entry) {
          return entry.app;
        })
        .join(', ')}`,
      hint: 'configure Play credentials',
    };
  }

  if (skipped.length == 0) {
    return { state: 'captured' as const, apps: captured };
  }

  return { state: 'captured' as const, apps: captured, skippedApps: skipped };
}

async function restorePlayProducts({ ctx: restoreContext, saved, dryRun }: RestoreInput) {
  const actions: PlannedAction[] = [];

  for (const app of saved) {
    const client = await restoreContext.resolvePlayWriteClient(app.identifier);

    if (client == null) {
      actions.push(
        skippedAction(`Google Play: skipped - no Play service account for ${app.identifier}`),
      );
      continue;
    }

    const products: InAppPurchaseConfig[] = [];

    for (const entity of app.entities) {
      const productConfig = toProductConfig(entity);

      if (productConfig == null) {
        actions.push(skippedAction(`Play product ${entity.key}: skipped - no listing to restore`));
        continue;
      }

      products.push(productConfig);
    }

    if (products.length == 0) {
      continue;
    }

    const appActions = await reconcileProductActions(client, app.identifier, products, dryRun);
    actions.push(...appActions);
  }

  return { actions };
}

async function reconcileProductActions(
  client: NonNullable<Awaited<ReturnType<RestoreInput['ctx']['resolvePlayWriteClient']>>>,
  packageName: string,
  products: InAppPurchaseConfig[],
  dryRun: boolean,
): Promise<PlannedAction[]> {
  try {
    const reconciliation = await reconcilePlayProducts(client, { packageName, products, dryRun });

    return [...reconciliation.actions];
  } catch (reconciliationFailure) {
    return [
      skippedAction(
        `Google Play products ${packageName}: ${restoreErrorMessage(reconciliationFailure)}`,
      ),
    ];
  }
}
