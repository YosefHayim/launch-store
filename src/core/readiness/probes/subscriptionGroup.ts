import type { ProbeResult, ReadinessContext, ReadinessProbe } from '@core/types/readiness.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.js';
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
      const apps = iosApps(readinessContext.apps).filter(({ identifier }) => {
        const groupCount =
          readinessContext.config.products?.[identifier]?.subscriptionGroups?.length;
        if (groupCount === undefined) return false;
        return groupCount > 0;
      });
      if (apps.length === 0) return OMITTED_PROBE;
      const api = yield* readinessContext.resolveAscApi();
      if (!api) return SKIPPED_NO_APPLE_ACCOUNT;
      const results = yield* Effect.forEach(
        apps,
        ({ name, identifier }) =>
          Effect.gen(function* () {
            let declared =
              readinessContext.config.products?.[identifier]?.subscriptionGroups?.length;
            if (declared === undefined) declared = 0;
            const appId = yield* api.getAppId(identifier);
            if (!appId) {
              return {
                app: name,
                identifier,
                status: 'warn' as const,
                detail: "can't verify - no app record yet",
                hint: 'create the app record first (see the app-record check)',
              };
            }
            const groups = yield* api.listSubscriptionGroups(appId);
            if (groups.length > 0)
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: `${groups.length} group(s) present`,
              };
            return {
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
