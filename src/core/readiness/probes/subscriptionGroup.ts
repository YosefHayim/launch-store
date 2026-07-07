/**
 * Probe: for each iOS app that declares auto-renewable subscriptions in `launch.config.ts`, does a
 * **subscription group** exist on App Store Connect? Subscriptions can't be created or reviewed without
 * their group, so a config that declares subscriptions against an account with no group is a silent
 * blocker. Tagged for both `account` (store doctor) and `iap` (iap doctor) since it matters to each.
 *
 * Read-only: it lists groups via the same reader `launch sync` uses and never creates one. Apps that
 * declare no subscriptions are out of scope (the probe omits itself when none do).
 */

import type { ProbeResult, ReadinessContext, ReadinessProbe } from '../../types/index.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';

/** The App Store Connect subscription-group readiness probe. */
export const subscriptionGroupProbe = {
  id: 'apple-subscription-group',
  title: 'Subscription group ready',
  store: 'appstore',
  categories: ['account', 'iap'],
  /**
   * Verify that each subscription-selling iOS app has at least one ASC subscription group.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with one subscription-group finding per in-scope app.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      const apps = iosApps(readinessContext.apps).filter(
        ({ identifier }) =>
          (readinessContext.config.products?.[identifier]?.subscriptionGroups?.length ?? 0) > 0,
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

      const results = yield* Effect.forEach(
        apps,
        ({ name, identifier }) =>
          Effect.gen(function* () {
            const declared =
              readinessContext.config.products?.[identifier]?.subscriptionGroups?.length ?? 0;
            const appId = yield* Effect.tryPromise({
              try: () => api.getAppId(identifier),
              catch: (apiFailure) => apiFailure,
            });
            if (!appId) {
              return {
                app: name,
                identifier,
                status: 'warn' as const,
                detail: "can't verify — no app record yet",
                hint: 'create the app record first (see the app-record check)',
              };
            }
            const groups = yield* Effect.tryPromise({
              try: () => api.listSubscriptionGroups(appId),
              catch: (apiFailure) => apiFailure,
            });
            return groups.length > 0
              ? {
                  app: name,
                  identifier,
                  status: 'ok' as const,
                  detail: `${groups.length} group(s) present`,
                }
              : {
                  app: name,
                  identifier,
                  status: 'blocker' as const,
                  detail: `config declares ${declared} subscription group(s), none exist on App Store Connect`,
                  hint: 'run `launch sync` to create the declared subscription group(s)',
                };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
