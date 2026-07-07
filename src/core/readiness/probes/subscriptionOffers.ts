/**
 * Probe: does every **offer-code campaign** a subscription declares actually exist on App Store Connect? An
 * offer code is a redeemable promo (a free month, an intro price); the config names them and `launch offers`
 * creates them, but a code that was declared yet never reconciled silently grants nothing when a customer
 * redeems it. This catches that drift from the config side. Findings are `warn`, never `blocker`: offer
 * codes are promotions, not a submission prerequisite — a missing one doesn't block shipping, it just means
 * a campaign you intended isn't live. Tagged `iap` only.
 *
 * Read-only: it resolves each declared subscription to its live resource id and lists that subscription's
 * offer codes, matching by `name` (the reconciler's natural key). A subscription not yet on App Store
 * Connect is a `warn` deferring to the subscriptions probe, which owns "create it first".
 */

import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
  SubscriptionConfig,
} from '../../types/index.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';

/**
 * Read declared subscriptions that carry at least one offer-code campaign.
 *
 * @param readinessContext - Loaded config and selected app scope for the readiness run.
 * @param bundleId - iOS bundle id whose subscription offer declarations should be read.
 * @returns Declared subscriptions with at least one offer-code campaign.
 */
function subscriptionsWithOfferCodes(
  readinessContext: ReadinessContext,
  bundleId: string,
): SubscriptionConfig[] {
  return (readinessContext.config.products?.[bundleId]?.subscriptionGroups ?? [])
    .flatMap((group) => group.subscriptions)
    .filter((subscription) => (subscription.offerCodes?.length ?? 0) > 0);
}

/** The App Store Connect subscription offer-code readiness probe. */
export const subscriptionOffersProbe = {
  id: 'apple-subscription-offers',
  title: 'Declared subscription offer codes exist',
  store: 'appstore',
  categories: ['iap'],
  /**
   * Verify that declared subscription offer-code campaigns exist on App Store Connect.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with one finding per declared offer-code campaign.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      const apps = iosApps(readinessContext.apps).filter(
        ({ identifier }) => subscriptionsWithOfferCodes(readinessContext, identifier).length > 0,
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
            const liveSubscriptionsByProductId = new Map(
              liveSubscriptionsByGroup
                .flat()
                .map((subscription) => [subscription.productId, subscription]),
            );
            const findingsBySubscription = yield* Effect.forEach(
              subscriptionsWithOfferCodes(readinessContext, identifier),
              (subscription): Effect.Effect<AppReadiness[], unknown> => {
                const liveSubscription = liveSubscriptionsByProductId.get(subscription.productId);
                if (!liveSubscription?.id) {
                  return Effect.succeed([
                    {
                      app: name,
                      identifier: subscription.productId,
                      status: 'warn',
                      detail: `${subscription.productId}: offers not verified — subscription not on App Store Connect yet`,
                      hint: 'create the subscription first (run `launch sync`)',
                    },
                  ]);
                }
                const liveSubscriptionId = liveSubscription.id;
                return Effect.tryPromise({
                  try: () => api.listSubscriptionOfferCodes(liveSubscriptionId),
                  catch: (apiFailure) => apiFailure,
                }).pipe(
                  Effect.map((liveOffers) => {
                    const liveNames = new Set(liveOffers.map((offer) => offer.name));
                    return (subscription.offerCodes ?? []).map((offer): AppReadiness => {
                      const subject = {
                        app: name,
                        identifier: `${subscription.productId}·${offer.name}`,
                      };
                      return liveNames.has(offer.name)
                        ? {
                            ...subject,
                            status: 'ok',
                            detail: `${subscription.productId} · ${offer.name}: offer code present`,
                          }
                        : {
                            ...subject,
                            status: 'warn',
                            detail: `${subscription.productId} · ${offer.name}: declared offer code missing`,
                            hint: 'run `launch offers` to create it',
                          };
                    });
                  }),
                );
              },
              { concurrency: 'unbounded' },
            );
            return findingsBySubscription.flat();
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: nested.flat() };
    });
  },
} satisfies ReadinessProbe;
