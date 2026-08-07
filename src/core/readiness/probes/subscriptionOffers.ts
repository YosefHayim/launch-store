import type { SubscriptionConfig } from '@core/types/catalog.js';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.js';
const subscriptionsWithOfferCodes = (
  readinessContext: ReadinessContext,
  bundleId: string,
): SubscriptionConfig[] => {
  const subscriptionGroups = readinessContext.config.products?.[bundleId]?.subscriptionGroups;
  if (subscriptionGroups === undefined) return [];
  const matchingSubscriptions: SubscriptionConfig[] = [];
  for (const subscriptionGroup of subscriptionGroups) {
    for (const subscription of subscriptionGroup.subscriptions) {
      if (subscription.offerCodes === undefined) continue;
      if (subscription.offerCodes.length === 0) continue;
      matchingSubscriptions.push(subscription);
    }
  }
  return matchingSubscriptions;
};

/** Check declared subscription offer codes against App Store Connect. */
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
      if (apps.length === 0) return OMITTED_PROBE;
      const appleStore = yield* readinessContext.resolveAscApi();
      if (appleStore === null) return SKIPPED_NO_APPLE_ACCOUNT;
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
                      detail: `${subscription.productId}: offers not verified - subscription not on App Store Connect yet`,
                      hint: 'create the subscription first (run `launch sync`)',
                    },
                  ]);
                }
                const liveSubscriptionId = liveSubscription.id;
                const declaredOffers = subscription.offerCodes;
                if (declaredOffers === undefined) return Effect.succeed([]);
                return appleStore.listSubscriptionOfferCodes(liveSubscriptionId).pipe(
                  Effect.map((liveOffers) => {
                    const liveNames = new Set(liveOffers.map((offer) => offer.name));
                    return declaredOffers.map((offer): AppReadiness => {
                      const subject = {
                        app: name,
                        identifier: `${subscription.productId}-${offer.name}`,
                      };
                      if (liveNames.has(offer.name)) {
                        return {
                          ...subject,
                          status: 'ok',
                          detail: `${subscription.productId} - ${offer.name}: offer code present`,
                        };
                      }
                      return {
                        ...subject,
                        status: 'warn',
                        detail: `${subscription.productId} - ${offer.name}: declared offer code missing`,
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
