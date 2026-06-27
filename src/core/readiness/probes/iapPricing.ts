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

import type { AppReadiness, ProbeResult, ReadinessContext, ReadinessProbe } from '../types.js';
import type { ProductPrice } from '../../types.js';
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

/** Every declared product (IAP or subscription) that carries a `price`, for one app's bundle id. */
function pricedDeclarations(ctx: ReadinessContext, bundleId: string): PricedDeclaration[] {
  const products = ctx.config.products?.[bundleId];
  const iaps = (products?.inAppPurchases ?? []).flatMap((iap) =>
    iap.price ? [{ productId: iap.productId, price: iap.price, kind: 'iap' as const }] : [],
  );
  const subs = (products?.subscriptionGroups ?? [])
    .flatMap((group) => group.subscriptions)
    .flatMap((sub) =>
      sub.price
        ? [{ productId: sub.productId, price: sub.price, kind: 'subscription' as const }]
        : [],
    );
  return [...iaps, ...subs];
}

/**
 * Grade one declared price against its live product's Apple price ladder.
 *
 * @param app         App handle, stamped onto the finding.
 * @param declaration The declared product + price being validated.
 * @param liveId      The product's App Store Connect resource id, or `undefined` when it isn't on ASC yet.
 * @param resolvePoint Looks up the matching price point for `liveId` (IAP vs subscription ladders differ).
 */
async function gradePrice(
  app: string,
  declaration: PricedDeclaration,
  liveId: string | undefined,
  resolvePoint: (
    liveId: string,
    territory: string,
    customerPrice: number,
  ) => Promise<{ id: string } | null>,
): Promise<AppReadiness> {
  const { productId, price } = declaration;
  const territory = price.baseTerritory ?? 'USA';
  if (!liveId) {
    return {
      app,
      identifier: productId,
      status: 'warn',
      detail: `${productId}: price not verified — not on App Store Connect yet`,
      hint: 'create the product first (run `launch sync`)',
    };
  }
  const point = await resolvePoint(liveId, territory, price.customerPrice);
  return point
    ? {
        app,
        identifier: productId,
        status: 'ok',
        detail: `${productId}: price ${price.customerPrice} (${territory}) valid`,
      }
    : {
        app,
        identifier: productId,
        status: 'blocker',
        detail: `${productId}: ${price.customerPrice} in ${territory} isn't an Apple price point`,
        hint: 'pick a price that matches an Apple price point (`launch sync` lists the nearby points)',
      };
}

/** The App Store Connect price-point validation probe. */
export const iapPricingProbe: ReadinessProbe = {
  id: 'apple-iap-pricing',
  title: 'Declared prices match Apple price points',
  store: 'appstore',
  categories: ['iap', 'submit'],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const apps = iosApps(ctx.apps).filter(
      ({ identifier }) => pricedDeclarations(ctx, identifier).length > 0,
    );
    if (apps.length === 0) return { state: 'omitted' };

    const api = await ctx.resolveAscApi();
    if (!api)
      return {
        state: 'skipped',
        reason: 'no active Apple account',
        hint: 'run `launch creds set-key`',
      };

    const nested = await Promise.all(
      apps.map(async ({ name, identifier }): Promise<AppReadiness[]> => {
        const appId = await api.getAppId(identifier);
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
        const liveIaps = new Map(
          (await api.listInAppPurchases(appId)).map((iap) => [iap.productId, iap]),
        );
        const groups = await api.listSubscriptionGroups(appId);
        const liveSubs = new Map(
          (await Promise.all(groups.map((group) => api.listSubscriptions(group.id))))
            .flat()
            .map((sub) => [sub.productId, sub]),
        );
        return Promise.all(
          pricedDeclarations(ctx, identifier).map((declaration) => {
            const isIap = declaration.kind === 'iap';
            const liveId = (isIap ? liveIaps : liveSubs).get(declaration.productId)?.id;
            const resolvePoint = isIap
              ? (id: string, territory: string, customerPrice: number) =>
                  api.findInAppPurchasePricePoint(id, territory, customerPrice)
              : (id: string, territory: string, customerPrice: number) =>
                  api.findSubscriptionPricePoint(id, territory, customerPrice);
            return gradePrice(name, declaration, liveId, resolvePoint);
          }),
        );
      }),
    );
    return { state: 'checked', apps: nested.flat() };
  },
};
