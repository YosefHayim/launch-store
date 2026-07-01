/**
 * Probe: for each iOS app that declares auto-renewable subscriptions, does every declared `productId` exist
 * across the app's subscription groups on App Store Connect **and** is it past `MISSING_METADATA`? This is
 * the subscription counterpart to {@link import("./iapProducts.js").iapProductsProbe}, and a level deeper
 * than {@link import("./subscriptionGroup.js").subscriptionGroupProbe} (which only asserts the *group*
 * exists): a group can be present while an individual subscription is missing or unfinished. Read-only — it
 * lists each group's subscriptions and grades them via {@link gradeDeclaredProduct}. Tagged `submit` too, so
 * a broken subscription surfaces in `launch audit` for any app that sells one.
 */

import type { AppReadiness, ProbeResult, ReadinessContext, ReadinessProbe } from '../../types.js';
import { iosApps } from '../appScopes.js';
import { declaredSubscriptionIds, gradeDeclaredProduct } from './iapReadiness.js';

/** The App Store Connect subscription-level readiness probe. */
export const subscriptionsProbe: ReadinessProbe = {
  id: 'apple-subscriptions',
  title: 'Subscriptions shippable',
  store: 'appstore',
  categories: ['iap', 'submit'],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const apps = iosApps(ctx.apps).filter(
      ({ identifier }) => declaredSubscriptionIds(ctx, identifier).length > 0,
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
        const liveSubs = (
          await Promise.all(groups.map((group) => api.listSubscriptions(group.id)))
        ).flat();
        const live = new Map(liveSubs.map((sub) => [sub.productId, sub]));
        return declaredSubscriptionIds(ctx, identifier).map((productId) => {
          const grade = gradeDeclaredProduct(productId, live.get(productId), 'subscription');
          return { app: name, identifier: productId, ...grade };
        });
      }),
    );
    return { state: 'checked', apps: nested.flat() };
  },
};
