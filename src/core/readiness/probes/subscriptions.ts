/**
 * Probe: for each iOS app that declares auto-renewable subscriptions, does every declared `productId` exist
 * across the app's subscription groups on App Store Connect **and** is it past `MISSING_METADATA`? This is
 * the subscription counterpart to {@link import("./iapProducts.js").iapProductsProbe}, and a level deeper
 * than {@link import("./subscriptionGroup.js").subscriptionGroupProbe} (which only asserts the *group*
 * exists): a group can be present while an individual subscription is missing or unfinished. Read-only — it
 * lists each group's subscriptions and grades them via {@link gradeDeclaredProduct}. Tagged `submit` too, so
 * a broken subscription surfaces in `launch audit` for any app that sells one.
 */

import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/index.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
import { declaredSubscriptionIds, gradeDeclaredProduct } from './iapReadiness.js';

/** The App Store Connect subscription-level readiness probe. */
export const subscriptionsProbe = {
  id: 'apple-subscriptions',
  title: 'Subscriptions shippable',
  store: 'appstore',
  categories: ['iap', 'submit'],
  /**
   * Verify that declared subscriptions exist on App Store Connect and are shippable.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with one finding per declared subscription.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      const apps = iosApps(readinessContext.apps).filter(
        ({ identifier }) => declaredSubscriptionIds(readinessContext, identifier).length > 0,
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
            const liveByProductId = new Map(
              liveSubscriptionsByGroup
                .flat()
                .map((subscription) => [subscription.productId, subscription]),
            );
            return declaredSubscriptionIds(readinessContext, identifier).map((productId) => {
              const grade = gradeDeclaredProduct(
                productId,
                liveByProductId.get(productId),
                'subscription',
              );
              return { app: name, identifier: productId, ...grade };
            });
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: nested.flat() };
    });
  },
} satisfies ReadinessProbe;
