import { configTemplate } from '../config/configScaffold.js';
import type { EntitlementValue, ProductPiece } from '../types/adopt.js';
import type {
  AppProducts,
  InAppPurchaseConfig,
  SubscriptionGroupConfig,
} from '../types/catalog.js';

/** Fold one bundle's imported product pieces into a single AppProducts, dropping empty arms. */
export const aggregateProductPieces = (pieces: readonly ProductPiece[]): AppProducts => {
  const inAppPurchases: InAppPurchaseConfig[] = [];
  const subscriptionGroups: SubscriptionGroupConfig[] = [];
  for (const piece of pieces) {
    if (piece.type === 'iap') {
      inAppPurchases.push(piece.iap);
      continue;
    }
    subscriptionGroups.push(piece.group);
  }
  const products: AppProducts = {};
  if (inAppPurchases.length > 0) products.inAppPurchases = inAppPurchases;
  if (subscriptionGroups.length > 0) products.subscriptionGroups = subscriptionGroups;
  return products;
};

/** Serialize a products block keyed by bundle id as an indented, paste-ready TypeScript section. */
export const serializeProductsSection = (
  productsByBundleId: Readonly<Record<string, AppProducts>>,
): string => {
  const productsJson = JSON.stringify(productsByBundleId, null, 2);
  // Shift every line but the first right by two spaces so the block nests under `products:` cleanly.
  const indented = productsJson
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

/** Build a complete fresh launch.config.ts with imported products pre-filled. */
export const buildAdoptedConfig = (
  appRoot: string | null,
  productsByBundleId: Readonly<Record<string, AppProducts>>,
): string => configTemplate(appRoot, serializeProductsSection(productsByBundleId));

/** Render an ios.entitlements block for pasting into a dynamic app.config. */
export const renderEntitlementsBlock = (
  entitlements: Readonly<Record<string, EntitlementValue>>,
): string => JSON.stringify({ ios: { entitlements } }, null, 2);
