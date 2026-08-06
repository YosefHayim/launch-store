import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
import { gradeDeclaredProduct } from './iapReadiness.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.js';
/** The App Store Connect one-time in-app-purchase readiness probe. */
export const iapProductsProbe = {
  id: 'apple-iap-products',
  title: 'In-app purchases shippable',
  store: 'appstore',
  categories: ['iap', 'submit'],
  /**
   * Verify that declared one-time IAPs exist on App Store Connect and are shippable.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with one finding per declared one-time IAP.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      const apps = iosApps(readinessContext.apps).filter(({ identifier }) => {
        const purchaseCount =
          readinessContext.config.products?.[identifier]?.inAppPurchases?.length;
        if (purchaseCount === undefined) return false;
        return purchaseCount > 0;
      });
      if (apps.length === 0) return OMITTED_PROBE;
      const api = yield* readinessContext.resolveAscApi();
      if (!api) return SKIPPED_NO_APPLE_ACCOUNT;
      const nested = yield* Effect.forEach(
        apps,
        ({ name, identifier }): Effect.Effect<AppReadiness[], unknown> =>
          Effect.gen(function* () {
            let declared = readinessContext.config.products?.[identifier]?.inAppPurchases;
            if (declared === undefined) declared = [];
            const appId = yield* api.getAppId(identifier);
            if (!appId) {
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
            const livePurchases = yield* api.listInAppPurchases(appId);
            const liveByProductId = new Map(
              livePurchases.map((inAppPurchase) => [inAppPurchase.productId, inAppPurchase]),
            );
            return declared.map((product) => {
              const grade = gradeDeclaredProduct(
                product.productId,
                liveByProductId.get(product.productId),
                'in-app purchase',
              );
              return { app: name, identifier: product.productId, ...grade };
            });
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: nested.flat() };
    });
  },
} satisfies ReadinessProbe;
