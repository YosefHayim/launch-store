import type { AppProducts } from '../../types/catalog.ts';
import type { ReadinessContext } from '../../types/readiness.ts';
const declaredIapIds = (readinessContext: ReadinessContext, bundleId: string): string[] => {
  let inAppPurchases = readinessContext.config.products?.[bundleId]?.inAppPurchases;
  if (inAppPurchases == null) inAppPurchases = [];
  return inAppPurchases.map((inAppPurchase) => inAppPurchase.productId);
};
export const declaredSubscriptionIds = (
  readinessContext: ReadinessContext,
  bundleId: string,
): string[] => {
  let groups = readinessContext.config.products?.[bundleId]?.subscriptionGroups;
  if (groups == null) groups = [];
  return groups.flatMap((group) => group.subscriptions.map((sub) => sub.productId));
};
export const sellsProducts = (readinessContext: ReadinessContext, bundleId: string): boolean => {
  if (declaredIapIds(readinessContext, bundleId).length > 0) return true;
  return declaredSubscriptionIds(readinessContext, bundleId).length > 0;
};
export const declaredAppleProductIds = (products: AppProducts | undefined): string[] => {
  if (!products) return [];
  let inAppPurchases = products.inAppPurchases;
  if (inAppPurchases == null) inAppPurchases = [];
  const purchases = inAppPurchases.map((purchase) => purchase.productId);
  let subscriptionGroups = products.subscriptionGroups;
  if (subscriptionGroups == null) subscriptionGroups = [];
  const subscriptions = subscriptionGroups.flatMap((group) =>
    group.subscriptions.map((subscription) => subscription.productId),
  );
  return [...purchases, ...subscriptions];
};
/** A `checked` finding's status + copy, without the per-app fields the probe stamps on. */
type ProductGrade = {
  status: 'ok' | 'blocker';
  detail: string;
  hint?: string;
};
export const gradeDeclaredProduct = (
  productId: string,
  live:
    | {
        state?: string | undefined;
      }
    | undefined,
  kind: 'in-app purchase' | 'subscription',
): ProductGrade => {
  if (!live) {
    return {
      status: 'blocker',
      detail: `${productId}: declared but not on App Store Connect`,
      hint: `run \`launch sync\` to create the ${kind}`,
    };
  }
  if (live.state == 'MISSING_METADATA') {
    return {
      status: 'blocker',
      detail: `${productId}: missing metadata (name, price, or localization)`,
      hint: 'run `launch sync` to fill it in, or complete it in App Store Connect',
    };
  }
  let productState = live.state;
  if (productState == null) productState = 'present';
  return { status: 'ok', detail: `${productId}: ${productState}` };
};
