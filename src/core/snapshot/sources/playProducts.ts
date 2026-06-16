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
  JsonValue,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
  SourceCapture,
} from "../types.js";
import type { InAppProductResource, PlayMoney } from "../../../google/playClient.js";
import { androidApps } from "../../readiness/appScopes.js";

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
  const statusSuffix = product.status ? ` (${product.status})` : "";
  return { key: product.sku, summary: `Play product${statusSuffix}`, data };
}

/** The Google Play managed-product snapshot source. */
export const playProductsSource: SnapshotSource = {
  id: "play-products",
  title: "Google Play products",
  store: "play",
  async capture(ctx: SnapshotContext): Promise<SourceCapture> {
    const apps = androidApps(ctx.apps);
    if (apps.length === 0) return { state: "omitted" };

    const api = await ctx.resolvePlayApi();
    if (!api) {
      return { state: "skipped", reason: "no Play service account", hint: "configure Play credentials" };
    }

    const captured = await Promise.all(
      apps.map(async ({ name, identifier }): Promise<AppEntities> => {
        const entities = (await api.listInAppProducts(identifier)).map(toEntity);
        return { app: name, identifier, entities };
      }),
    );
    return { state: "captured", apps: captured };
  },
};
