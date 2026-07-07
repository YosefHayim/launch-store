/**
 * Probe: does every declared product price actually resolve to an Apple **price point**? Apple doesn't take
 * arbitrary amounts — each price must be one rung on a fixed ladder, per territory. A config that declares
 * `9.99` where the nearest points are `9.99`'s neighbours is fine; one that declares `9.95` is not, and
 * `launch sync` would reject it at apply time. This probe surfaces that mismatch *before* a sync run, the
 * same way {@link import("./iapProducts.js").iapProductsProbe} surfaces a missing product — so a misconfigured
 * price is a `blocker`, and it's tagged `submit` so `launch audit` catches it for any app that sells a priced
 * product.
 *
 * Read-only: it resolves each declared product to its live App Store Connect resource id, then asks Apple
 * whether the declared amount is a valid price point for it (the price ladder is product-specific). A product
 * not yet on App Store Connect is a `warn`, not a blocker — the products probe already owns "create it first".
 */

import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
  ProductPrice,
} from '../../types/index.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';

/** A declared product carrying a price — the unit this probe grades, flattened across IAPs and subscriptions. */
interface PricedDeclaration {
  /** Apple product id the config declares. */
  productId: string;
  /** The declared baseline price to validate against Apple's ladder. */
  price: ProductPrice;
  /** Whether to resolve the live resource (and its price ladder) as an IAP or a subscription. */
  kind: 'iap' | 'subscription';
}

/**
 * Read every declared product that carries a price for one app.
 *
 * @param readinessContext - Loaded config and selected app scope for the readiness run.
 * @param bundleId - iOS bundle id whose priced catalog declarations should be read.
 * @returns Priced IAP and subscription declarations for the app.
 */
function pricedDeclarations(
  readinessContext: ReadinessContext,
  bundleId: string,
): PricedDeclaration[] {
  const products = readinessContext.config.products?.[bundleId];
  const inAppPurchases = (products?.inAppPurchases ?? []).flatMap((inAppPurchase) =>
    inAppPurchase.price
      ? [
          {
            productId: inAppPurchase.productId,
            price: inAppPurchase.price,
            kind: 'iap' as const,
          },
        ]
      : [],
  );
  const subscriptions = (products?.subscriptionGroups ?? [])
    .flatMap((group) => group.subscriptions)
    .flatMap((subscription) =>
      subscription.price
        ? [
            {
              productId: subscription.productId,
              price: subscription.price,
              kind: 'subscription' as const,
            },
          ]
        : [],
    );
  return [...inAppPurchases, ...subscriptions];
}

/**
 * Grade one declared price against its live product's Apple price ladder.
 *
 * @param app         App handle, stamped onto the finding.
 * @param declaration The declared product + price being validated.
 * @param liveId      The product's App Store Connect resource id, or `undefined` when it isn't on ASC yet.
 * @param resolvePoint Looks up the matching price point for `liveId` (IAP vs subscription ladders differ).
 * @returns An Effect that succeeds with the price readiness finding for the declaration.
 */
function gradePrice(
  app: string,
  declaration: PricedDeclaration,
  liveId: string | undefined,
  resolvePoint: (
    liveId: string,
    territory: string,
    customerPrice: number,
  ) => Effect.Effect<{ id: string } | null, unknown>,
): Effect.Effect<AppReadiness, unknown> {
  const { productId, price } = declaration;
  const territory = price.baseTerritory ?? 'USA';
  if (!liveId) {
    return Effect.succeed({
      app,
      identifier: productId,
      status: 'warn',
      detail: `${productId}: price not verified — not on App Store Connect yet`,
      hint: 'create the product first (run `launch sync`)',
    });
  }
  return resolvePoint(liveId, territory, price.customerPrice).pipe(
    Effect.map((point) =>
      point
        ? {
            app,
            identifier: productId,
            status: 'ok' as const,
            detail: `${productId}: price ${price.customerPrice} (${territory}) valid`,
          }
        : {
            app,
            identifier: productId,
            status: 'blocker' as const,
            detail: `${productId}: ${price.customerPrice} in ${territory} isn't an Apple price point`,
            hint: 'pick a price that matches an Apple price point (`launch sync` lists the nearby points)',
          },
    ),
  );
}

/** The App Store Connect price-point validation probe. */
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

      const api = yield* Effect.tryPromise({
        try: () => readinessContext.resolveAscApi(),
        catch: (resolverFailure) => resolverFailure,
      });
      if (!api)
        return {
          state: 'skipped',
          reason: 'no active Apple account',
          hint: 'run `launch creds set-key`',
        };

      const nested = yield* Effect.forEach(
        apps,
        ({ name, identifier }): Effect.Effect<AppReadiness[], unknown> =>
          Effect.gen(function* () {
            const appId = yield* Effect.tryPromise({
              try: () => api.getAppId(identifier),
              catch: (apiFailure) => apiFailure,
            });
            if (!appId) {
              return [
                {
                  app: name,
                  identifier,
                  status: 'warn',
                  detail: "can't verify — no app record yet",
                  hint: 'create the app record first (see the app-record check)',
                },
              ];
            }
            const liveInAppPurchases = yield* Effect.tryPromise({
              try: () => api.listInAppPurchases(appId),
              catch: (apiFailure) => apiFailure,
            });
            const liveInAppPurchasesByProductId = new Map(
              liveInAppPurchases.map((inAppPurchase) => [inAppPurchase.productId, inAppPurchase]),
            );
            const groups = yield* Effect.tryPromise({
              try: () => api.listSubscriptionGroups(appId),
              catch: (apiFailure) => apiFailure,
            });
            const liveSubscriptionsByGroup = yield* Effect.forEach(
              groups,
              (group) =>
                Effect.tryPromise({
                  try: () => api.listSubscriptions(group.id),
                  catch: (apiFailure) => apiFailure,
                }),
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
                const liveId = (
                  isInAppPurchase ? liveInAppPurchasesByProductId : liveSubscriptionsByProductId
                ).get(declaration.productId)?.id;
                const resolvePoint = isInAppPurchase
                  ? (id: string, territory: string, customerPrice: number) =>
                      Effect.tryPromise({
                        try: () => api.findInAppPurchasePricePoint(id, territory, customerPrice),
                        catch: (apiFailure) => apiFailure,
                      })
                  : (id: string, territory: string, customerPrice: number) =>
                      Effect.tryPromise({
                        try: () => api.findSubscriptionPricePoint(id, territory, customerPrice),
                        catch: (apiFailure) => apiFailure,
                      });
                return gradePrice(name, declaration, liveId, resolvePoint);
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
