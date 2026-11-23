import type { LaunchConfig } from '../types/config.ts';

export interface StoreProduct {
  productId: string;
}

export interface StoreSnapshot {
  products: readonly StoreProduct[];
}

export const DRIFT_MESSAGE = 'The live store has drifted from launch.config.ts';

type StoreAction = 'create' | 'update' | 'leave';

export interface StoreChange {
  topic: 'product';
  action: StoreAction;
  detail: string;
}

export function planStore(desired: StoreSnapshot, live: StoreSnapshot): StoreChange[] {
  const changes: StoreChange[] = [];

  for (const product of desired.products) {
    function isThisProduct(liveProduct: StoreProduct): boolean {
      return liveProduct.productId == product.productId;
    }

    const liveProduct = live.products.find(isThisProduct);

    const isNew = liveProduct == null;

    if (isNew) {
      changes.push({ topic: 'product', action: 'create', detail: product.productId });
    }
  }

  return changes;
}

export function desiredProducts(launchFile: LaunchConfig): StoreProduct[] {
  const products = launchFile.products;

  const isMissing = products == null;

  if (isMissing) {
    return [];
  }

  const listed: StoreProduct[] = [];
  const appNames = Object.keys(products);

  for (const appName of appNames) {
    const appProducts = products[appName];

    const isAppMissing = appProducts == null;

    if (isAppMissing) {
      continue;
    }

    const purchases = appProducts.inAppPurchases;
    const hasPurchases = purchases != null;

    if (hasPurchases == false) {
      continue;
    }

    for (const purchase of purchases) {
      listed.push({ productId: purchase.productId });
    }
  }

  return listed;
}
