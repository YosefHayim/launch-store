import { configTemplate } from '../config/configScaffold.js';
import type { EntitlementValue, ProductPiece } from '../types/adopt.js';
import type {
  AppProducts,
  InAppPurchaseConfig,
  SubscriptionGroupConfig,
} from '../types/catalog.js';
/** Fold one bundle's imported product pieces into a single {@link AppProducts}, dropping empty arms. */
export const aggregateProductPieces = (pieces: readonly ProductPiece[]): AppProducts => {
  const inAppPurchases: InAppPurchaseConfig[] = [];
  const subscriptionGroups: SubscriptionGroupConfig[] = [];
  for (const piece of pieces) {
    if (piece.type === 'iap') inAppPurchases.push(piece.iap);
    else subscriptionGroups.push(piece.group);
  }
  if (inAppPurchases.length === 0 && subscriptionGroups.length === 0) return {};
  if (inAppPurchases.length === 0) return { subscriptionGroups };
  if (subscriptionGroups.length === 0) return { inAppPurchases };
  return { inAppPurchases, subscriptionGroups };
};
/** Serialize a `products` block (keyed by bundle id) as an indented, paste-ready TypeScript section. */
export const serializeProductsSection = (
  productsByBundleId: Record<string, AppProducts>,
): string => {
  const json = JSON.stringify(productsByBundleId, null, 2);
  // Shift every line but the first right by two spaces so the block nests under `products:` cleanly.
  const indented = json
    .split('\n')
    .map((line, index) => {
      if (index === 0) return line;
      return `  ${line}`;
    })
    .join('\n');
  return [
    '  // Imported from App Store Connect by `launch adopt` - review, then commit.',
    `  products: ${indented},`,
  ].join('\n');
};
/** Build a complete fresh `launch.config.ts` with the imported products pre-filled (extends `init`'s template). */
export const buildAdoptedConfig = (
  appRoot: string | null,
  productsByBundleId: Record<string, AppProducts>,
): string => {
  return configTemplate(appRoot, serializeProductsSection(productsByBundleId));
};
/** Render an `ios.entitlements` block for the developer to paste into a dynamic `app.config.{js,ts}`. */
export const renderEntitlementsBlock = (entitlements: Record<string, EntitlementValue>): string => {
  return JSON.stringify({ ios: { entitlements } }, null, 2);
};
