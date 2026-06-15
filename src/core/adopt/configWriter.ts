/**
 * Render imported App Store Connect products into `launch.config.ts` text for `launch adopt`.
 *
 * The product adopter emits per-product {@link ProductPiece}s; this module aggregates them per bundle id
 * and serializes the `products` block. For a **fresh** repo (no `launch.config.ts`) the orchestrator
 * writes a full config via {@link buildAdoptedConfig} (the `init` template with the block pre-filled);
 * for an **existing** config it prints {@link serializeProductsSection} for the developer to paste, since
 * a hand-edited `.ts` can't be spliced safely (the same reason a dynamic `app.config.js` is print-only).
 *
 * Serialization is plain `JSON.stringify` — quoted keys are valid TypeScript object literals — so there's
 * no bespoke code-emitter to maintain, and the developer reviews/commits the result like any other config.
 */

import { configTemplate } from "../configScaffold.js";
import type { AppProducts, InAppPurchaseConfig, SubscriptionGroupConfig } from "../types.js";
import type { EntitlementValue, ProductPiece } from "./types.js";

/** Fold one bundle's imported product pieces into a single {@link AppProducts}, dropping empty arms. */
export function aggregateProductPieces(pieces: ProductPiece[]): AppProducts {
  const inAppPurchases: InAppPurchaseConfig[] = [];
  const subscriptionGroups: SubscriptionGroupConfig[] = [];
  for (const piece of pieces) {
    if (piece.type === "iap") inAppPurchases.push(piece.iap);
    else subscriptionGroups.push(piece.group);
  }
  const products: AppProducts = {};
  if (inAppPurchases.length > 0) products.inAppPurchases = inAppPurchases;
  if (subscriptionGroups.length > 0) products.subscriptionGroups = subscriptionGroups;
  return products;
}

/** Serialize a `products` block (keyed by bundle id) as an indented, paste-ready TypeScript section. */
export function serializeProductsSection(productsByBundleId: Record<string, AppProducts>): string {
  const json = JSON.stringify(productsByBundleId, null, 2);
  // Shift every line but the first right by two spaces so the block nests under `products:` cleanly.
  const indented = json
    .split("\n")
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join("\n");
  return [
    "  // Imported from App Store Connect by `launch adopt` — review, then commit.",
    `  products: ${indented},`,
  ].join("\n");
}

/** Build a complete fresh `launch.config.ts` with the imported products pre-filled (extends `init`'s template). */
export function buildAdoptedConfig(appRoot: string | null, productsByBundleId: Record<string, AppProducts>): string {
  return configTemplate(appRoot, serializeProductsSection(productsByBundleId));
}

/** Render an `ios.entitlements` block for the developer to paste into a dynamic `app.config.{js,ts}`. */
export function renderEntitlementsBlock(entitlements: Record<string, EntitlementValue>): string {
  return JSON.stringify({ ios: { entitlements } }, null, 2);
}
