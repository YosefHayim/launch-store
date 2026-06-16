/**
 * Probe: for each iOS app that declares one-time in-app purchases in `launch.config.ts`, does every declared
 * `productId` exist on App Store Connect **and** is it past `MISSING_METADATA`? A product the app references
 * at runtime but that doesn't exist (or was created and never completed) means the purchase fails in
 * production — the classic "the build is green but buying the thing crashes" gap. Read-only: it lists IAPs
 * via the same reader `launch sync` uses and grades each against {@link gradeDeclaredProduct}, one finding
 * per declared product. Tagged `submit` too, so an app selling IAP surfaces a broken product in `launch audit`.
 */

import type { AppReadiness, ProbeResult, ReadinessContext, ReadinessProbe } from "../types.js";
import { iosApps } from "../appScopes.js";
import { gradeDeclaredProduct } from "./iapReadiness.js";

/** The App Store Connect one-time in-app-purchase readiness probe. */
export const iapProductsProbe: ReadinessProbe = {
  id: "apple-iap-products",
  title: "In-app purchases shippable",
  store: "appstore",
  categories: ["iap", "submit"],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const apps = iosApps(ctx.apps).filter(
      ({ identifier }) => (ctx.config.products?.[identifier]?.inAppPurchases?.length ?? 0) > 0,
    );
    if (apps.length === 0) return { state: "omitted" };

    const api = await ctx.resolveAscApi();
    if (!api) return { state: "skipped", reason: "no active Apple account", hint: "run `launch creds set-key`" };

    const nested = await Promise.all(
      apps.map(async ({ name, identifier }): Promise<AppReadiness[]> => {
        const declared = ctx.config.products?.[identifier]?.inAppPurchases ?? [];
        const appId = await api.getAppId(identifier);
        if (!appId) {
          return [
            {
              app: name,
              identifier,
              status: "warn",
              detail: "can't verify — no app record yet",
              hint: "create the app record first (see the app-record check)",
            },
          ];
        }
        const live = new Map((await api.listInAppPurchases(appId)).map((iap) => [iap.productId, iap]));
        return declared.map((product) => {
          const grade = gradeDeclaredProduct(product.productId, live.get(product.productId), "in-app purchase");
          return { app: name, identifier: product.productId, ...grade };
        });
      }),
    );
    return { state: "checked", apps: nested.flat() };
  },
};
