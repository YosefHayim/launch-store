// Grades declared in-app purchases and subscriptions against what App Store Connect has.

import type { AppProducts } from '@/types/catalog.js';
import type { ReadinessContext } from '@/types/readiness.js';

function declaredIapIds(readinessContext: ReadinessContext, bundleId: string): string[] {
  let inAppPurchases = readinessContext.config.products?.[bundleId]?.inAppPurchases;

  if (inAppPurchases == null) inAppPurchases = [];

  return inAppPurchases.map(readProductId);
}

function readProductId(product: { productId: string }): string {
  return product.productId;
}

export function declaredSubscriptionIds(
  readinessContext: ReadinessContext,
  bundleId: string,
): string[] {
  let groups = readinessContext.config.products?.[bundleId]?.subscriptionGroups;

  if (groups == null) groups = [];

  function readSubscriptionId(subscription: { productId: string }): string {
    return subscription.productId;
  }

  function readGroupIds(group: { subscriptions: readonly { productId: string }[] }): string[] {
    return group.subscriptions.map(readSubscriptionId);
  }

  return groups.flatMap(readGroupIds);
}

export function sellsProducts(readinessContext: ReadinessContext, bundleId: string): boolean {
  if (declaredIapIds(readinessContext, bundleId).length > 0) return true;

  return declaredSubscriptionIds(readinessContext, bundleId).length > 0;
}

export function declaredAppleProductIds(products: AppProducts | undefined): string[] {
  if (products == null) {
    return [];
  }

  let inAppPurchases = products.inAppPurchases;

  if (inAppPurchases == null) {
    inAppPurchases = [];
  }

  const purchases = inAppPurchases.map(readProductId);
  let subscriptionGroups = products.subscriptionGroups;

  if (subscriptionGroups == null) {
    subscriptionGroups = [];
  }

  function readSubscriptionId(subscription: { productId: string }): string {
    return subscription.productId;
  }

  function readGroupIds(group: { subscriptions: readonly { productId: string }[] }): string[] {
    return group.subscriptions.map(readSubscriptionId);
  }

  const subscriptions = subscriptionGroups.flatMap(readGroupIds);

  return [...purchases, ...subscriptions];
}

/** A `checked` finding's status + copy, without the per-app fields the probe stamps on. */
type ProductGrade = {
  status: 'ok' | 'blocker';
  detail: string;
  hint?: string;
};

export function gradeDeclaredProduct(
  productId: string,
  live:
    | {
        state?: string | undefined;
      }
    | undefined,
  kind: 'in-app purchase' | 'subscription',
): ProductGrade {
  if (!live) {
    return {
      status: 'blocker',
      detail: `${productId}: declared but not on App Store Connect`,
      hint: `run \`launch-store sync\` to create the ${kind}`,
    };
  }

  if (live.state == 'MISSING_METADATA') {
    return {
      status: 'blocker',
      detail: `${productId}: missing metadata (name, price, or localization)`,
      hint: 'run `launch-store sync` to fill it in, or complete it in App Store Connect',
    };
  }

  let productState = live.state;

  if (productState == null) productState = 'present';

  return { status: 'ok', detail: `${productId}: ${productState}` };
}
