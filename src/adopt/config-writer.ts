import { configTemplate } from '../config/config-scaffold.ts';
import type { EntitlementValue, ProductPiece } from '../types/adopt.ts';
import type {
  AppProducts,
  InAppPurchaseConfig,
  SubscriptionGroupConfig,
} from '../types/catalog.ts';

/** Fold one bundle's imported product pieces into a single AppProducts, dropping empty arms. */
export function aggregateProductPieces(pieces: readonly ProductPiece[]): AppProducts {
  const inAppPurchases: InAppPurchaseConfig[] = [];
  const subscriptionGroups: SubscriptionGroupConfig[] = [];

  for (const piece of pieces) {
    if (piece.type == 'iap') {
      inAppPurchases.push(piece.iap);
      continue;
    }

    subscriptionGroups.push(piece.group);
  }

  if (inAppPurchases.length > 0 && subscriptionGroups.length > 0) {
    return { inAppPurchases, subscriptionGroups };
  }

  if (inAppPurchases.length > 0) return { inAppPurchases };

  if (subscriptionGroups.length > 0) return { subscriptionGroups };

  return {};
}

/** Serialize a products block keyed by bundle id as an indented, paste-ready TypeScript section. */
export function serializeProductsSection(
  productsByBundleId: Readonly<Record<string, AppProducts>>,
): string {
  const productsJson = JSON.stringify(productsByBundleId, null, 2);

  function indentWrappedLine(line: string, index: number) {
    if (index == 0) return line;

    return `  ${line}`;
  }

  // Shift every line but the first right by two spaces so the block nests under `products:` cleanly.
  const indented = productsJson.split('\n').map(indentWrappedLine).join('\n');

  return [
    '  // Imported from App Store Connect by `launch-store adopt` - review, then commit.',
    `  products: ${indented},`,
  ].join('\n');
}

/** Build a complete fresh launch.config.ts with imported products pre-filled. */
export function buildAdoptedConfig(
  appRoot: string | null,
  productsByBundleId: Readonly<Record<string, AppProducts>>,
): string {
  const productsSection = serializeProductsSection(productsByBundleId);
  return configTemplate(appRoot, productsSection);
}

/** Render an ios.entitlements block for pasting into a dynamic app.config. */
export function renderEntitlementsBlock(
  entitlements: Readonly<Record<string, EntitlementValue>>,
): string {
  return JSON.stringify({ ios: { entitlements } }, null, 2);
}
