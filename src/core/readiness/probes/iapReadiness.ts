import type { AppProducts } from '@core/types/catalog.js';
import type { ReadinessContext } from '@core/types/readiness.js';
export const declaredIapIds = (readinessContext: ReadinessContext, bundleId: string): string[] => {
  let inAppPurchases = readinessContext.config.products?.[bundleId]?.inAppPurchases;
  if (inAppPurchases === undefined) inAppPurchases = [];
  return inAppPurchases.map((inAppPurchase) => inAppPurchase.productId);
};
export const declaredSubscriptionIds = (
  readinessContext: ReadinessContext,
  bundleId: string,
): string[] => {
  let groups = readinessContext.config.products?.[bundleId]?.subscriptionGroups;
  if (groups === undefined) groups = [];
  return groups.flatMap((group) => group.subscriptions.map((sub) => sub.productId));
};
export const sellsProducts = (readinessContext: ReadinessContext, bundleId: string): boolean => {
  if (declaredIapIds(readinessContext, bundleId).length > 0) return true;
  return declaredSubscriptionIds(readinessContext, bundleId).length > 0;
};
export const declaredAppleProductIds = (products: AppProducts | undefined): string[] => {
  if (!products) return [];
  let inAppPurchases = products.inAppPurchases;
  if (inAppPurchases === undefined) inAppPurchases = [];
  const purchases = inAppPurchases.map((purchase) => purchase.productId);
  let subscriptionGroups = products.subscriptionGroups;
  if (subscriptionGroups === undefined) subscriptionGroups = [];
  const subscriptions = subscriptionGroups.flatMap((group) =>
    group.subscriptions.map((subscription) => subscription.productId),
  );
  return [...purchases, ...subscriptions];
};
/**
 * The lifecycle state Apple reports for a product still missing required metadata (a name, a price, or a
 * localization). It's the canonical "you started this product but never finished it" signal and the one
 * thing that silently keeps a product out of a submission, so it's the blocking state we grade on. Other
 * states (`READY_TO_SUBMIT`, `WAITING_FOR_REVIEW`, `APPROVED`, ...) mean the product is at least submittable
 * and pass through informationally.
 */
const MISSING_METADATA = 'MISSING_METADATA';
/** A `checked` finding's status + copy, without the per-app fields the probe stamps on. */
export type ProductGrade = {
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
  if (live.state === MISSING_METADATA) {
    return {
      status: 'blocker',
      detail: `${productId}: missing metadata (name, price, or localization)`,
      hint: 'run `launch sync` to fill it in, or complete it in App Store Connect',
    };
  }
  let productState = live.state;
  if (productState === undefined) productState = 'present';
  return { status: 'ok', detail: `${productId}: ${productState}` };
};
