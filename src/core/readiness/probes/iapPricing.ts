import type { ProductPrice } from '@core/types/catalog.js';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
type PricedDeclaration = {
  productId: string;
  price: ProductPrice;
  kind: 'iap' | 'subscription';
};

type PricePointResolver = (
  liveProductId: string,
  territory: string,
  customerPrice: number,
) => Effect.Effect<{ id: string } | null, unknown>;

/** Collect every priced in-app purchase and subscription declared for one app. */
const pricedDeclarations = (
  readinessContext: ReadinessContext,
  bundleId: string,
): PricedDeclaration[] => {
  const products = readinessContext.config.products?.[bundleId];
  const declarations: PricedDeclaration[] = [];
  if (products?.inAppPurchases !== undefined) {
    for (const inAppPurchase of products.inAppPurchases) {
      if (inAppPurchase.price === undefined) continue;
      declarations.push({
        productId: inAppPurchase.productId,
        price: inAppPurchase.price,
        kind: 'iap',
      });
    }
  }
  if (products?.subscriptionGroups !== undefined) {
    for (const subscriptionGroup of products.subscriptionGroups) {
      for (const subscription of subscriptionGroup.subscriptions) {
        if (subscription.price === undefined) continue;
        declarations.push({
          productId: subscription.productId,
          price: subscription.price,
          kind: 'subscription',
        });
      }
    }
  }
  return declarations;
};

/** Grade one declared price against its corresponding live Apple price point. */
const gradePrice = (
  appName: string,
  declaration: PricedDeclaration,
  liveProductId: string | undefined,
  resolvePricePoint: PricePointResolver,
): Effect.Effect<AppReadiness, unknown> => {
  const { productId, price } = declaration;
  let territory = 'USA';
  if (price.baseTerritory !== undefined) territory = price.baseTerritory;
  if (liveProductId === undefined) {
    return Effect.succeed({
      app: appName,
      identifier: productId,
      status: 'warn',
      detail: `${productId}: price not verified - not on App Store Connect yet`,
      hint: 'create the product first (run `launch sync`)',
    });
  }
  return resolvePricePoint(liveProductId, territory, price.customerPrice).pipe(
    Effect.map((matchedPricePoint): AppReadiness => {
      if (matchedPricePoint !== null) {
        return {
          app: appName,
          identifier: productId,
          status: 'ok',
          detail: `${productId}: price ${price.customerPrice} (${territory}) valid`,
        };
      }
      return {
        app: appName,
        identifier: productId,
        status: 'blocker',
        detail: `${productId}: ${price.customerPrice} in ${territory} isn't an Apple price point`,
        hint: 'pick a price that matches an Apple price point (`launch sync` lists the nearby points)',
      };
    }),
  );
};

/** Validate declared prices against App Store Connect price points. */
export const iapPricingProbe = {
  id: 'apple-iap-pricing',
  title: 'Declared prices match Apple price points',
  store: 'appstore',
  categories: ['iap', 'submit'],
  /**
   * Verify that declared product prices match Apple price points.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with one price finding per priced declaration.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      const apps = iosApps(readinessContext.apps).filter(
        ({ identifier }) => pricedDeclarations(readinessContext, identifier).length > 0,
      );
      if (apps.length === 0) return { state: 'omitted' };
      const appleStore = yield* readinessContext.resolveAscApi();
      if (appleStore === null)
        return {
          state: 'skipped',
          reason: 'no active Apple account',
          hint: 'run `launch creds set-key`',
        };
      const nested = yield* Effect.forEach(
        apps,
        ({ name, identifier }): Effect.Effect<AppReadiness[], unknown> =>
          Effect.gen(function* () {
            const appId = yield* appleStore.getAppId(identifier);
            if (appId === null) {
              return [
                {
                  app: name,
                  identifier,
                  status: 'warn',
                  detail: "can't verify - no app record yet",
                  hint: 'create the app record first (see the app-record check)',
                },
              ];
            }
            const liveInAppPurchases = yield* appleStore.listInAppPurchases(appId);
            const liveInAppPurchasesByProductId = new Map(
              liveInAppPurchases.map((inAppPurchase) => [inAppPurchase.productId, inAppPurchase]),
            );
            const subscriptionGroups = yield* appleStore.listSubscriptionGroups(appId);
            const liveSubscriptionsByGroup = yield* Effect.forEach(
              subscriptionGroups,
              (subscriptionGroup) => appleStore.listSubscriptions(subscriptionGroup.id),
              { concurrency: 'unbounded' },
            );
            const liveSubscriptionsByProductId = new Map(
              liveSubscriptionsByGroup
                .flat()
                .map((subscription) => [subscription.productId, subscription]),
            );
            return yield* Effect.forEach(
              pricedDeclarations(readinessContext, identifier),
              (declaration) => {
                const isInAppPurchase = declaration.kind === 'iap';
                let liveProductId: string | undefined;
                let resolvePricePoint: PricePointResolver;
                if (isInAppPurchase) {
                  liveProductId = liveInAppPurchasesByProductId.get(declaration.productId)?.id;
                  resolvePricePoint = (productId, territory, customerPrice) =>
                    appleStore.findInAppPurchasePricePoint(productId, territory, customerPrice);
                } else {
                  liveProductId = liveSubscriptionsByProductId.get(declaration.productId)?.id;
                  resolvePricePoint = (productId, territory, customerPrice) =>
                    appleStore.findSubscriptionPricePoint(productId, territory, customerPrice);
                }
                return gradePrice(name, declaration, liveProductId, resolvePricePoint);
              },
              { concurrency: 'unbounded' },
            );
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: nested.flat() };
    });
  },
} satisfies ReadinessProbe;
