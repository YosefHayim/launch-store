import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
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
      const api = yield* readinessContext.resolveAscApi();
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
            const groups = yield* api.listSubscriptionGroups(appId);
            const liveSubscriptionsByGroup = yield* Effect.forEach(
              groups,
              (group) => api.listSubscriptions(group.id),
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
