/**
 * Probe: for each iOS app that declares one-time in-app purchases in `launch.config.ts`, does every declared
 * `productId` exist on App Store Connect **and** is it past `MISSING_METADATA`? A product the app references
 * at runtime but that doesn't exist (or was created and never completed) means the purchase fails in
 * production — the classic "the build is green but buying the thing crashes" gap. Read-only: it lists IAPs
 * via the same reader `launch sync` uses and grades each against {@link gradeDeclaredProduct}, one finding
 * per declared product. Tagged `submit` too, so an app selling IAP surfaces a broken product in `launch audit`.
 */

import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/index.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
import { gradeDeclaredProduct } from './iapReadiness.js';

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
      const apps = iosApps(readinessContext.apps).filter(
        ({ identifier }) =>
          (readinessContext.config.products?.[identifier]?.inAppPurchases?.length ?? 0) > 0,
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
            const declared = readinessContext.config.products?.[identifier]?.inAppPurchases ?? [];
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
            const livePurchases = yield* Effect.tryPromise({
              try: () => api.listInAppPurchases(appId),
              catch: (apiFailure) => apiFailure,
            });
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
