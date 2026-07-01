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
} from '../../types.js';
import { iosApps } from '../appScopes.js';

/** The declared subscriptions, for one app's bundle id, that carry at least one offer-code campaign. */
function subscriptionsWithOfferCodes(
  ctx: ReadinessContext,
  bundleId: string,
): SubscriptionConfig[] {
  return (ctx.config.products?.[bundleId]?.subscriptionGroups ?? [])
    .flatMap((group) => group.subscriptions)
    .filter((sub) => (sub.offerCodes?.length ?? 0) > 0);
}

/** The App Store Connect subscription offer-code readiness probe. */
export const subscriptionOffersProbe: ReadinessProbe = {
  id: 'apple-subscription-offers',
  title: 'Declared subscription offer codes exist',
  store: 'appstore',
  categories: ['iap'],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const apps = iosApps(ctx.apps).filter(
      ({ identifier }) => subscriptionsWithOfferCodes(ctx, identifier).length > 0,
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
        const groups = await api.listSubscriptionGroups(appId);
        const liveSubs = new Map(
          (await Promise.all(groups.map((group) => api.listSubscriptions(group.id))))
            .flat()
            .map((sub) => [sub.productId, sub]),
        );
        const perSub = await Promise.all(
          subscriptionsWithOfferCodes(ctx, identifier).map(async (sub): Promise<AppReadiness[]> => {
            const live = liveSubs.get(sub.productId);
            if (!live?.id) {
              return [
                {
                  app: name,
                  identifier: sub.productId,
                  status: 'warn',
                  detail: `${sub.productId}: offers not verified — subscription not on App Store Connect yet`,
                  hint: 'create the subscription first (run `launch sync`)',
                },
              ];
            }
            const liveNames = new Set(
              (await api.listSubscriptionOfferCodes(live.id)).map((offer) => offer.name),
            );
            return (sub.offerCodes ?? []).map((offer): AppReadiness => {
              const subject = { app: name, identifier: `${sub.productId}·${offer.name}` };
              return liveNames.has(offer.name)
                ? {
                    ...subject,
                    status: 'ok',
                    detail: `${sub.productId} · ${offer.name}: offer code present`,
                  }
                : {
                    ...subject,
                    status: 'warn',
                    detail: `${sub.productId} · ${offer.name}: declared offer code missing`,
                    hint: 'run `launch offers` to create it',
                  };
            });
          }),
        );
        return perSub.flat();
      }),
    );
    return { state: 'checked', apps: nested.flat() };
  },
};
