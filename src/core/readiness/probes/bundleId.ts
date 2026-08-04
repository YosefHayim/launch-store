import type { ProbeResult, ReadinessContext, ReadinessProbe } from '@core/types/readiness.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
/** The Apple Bundle ID (App ID) registration readiness probe. */
export const bundleIdProbe = {
  id: 'apple-bundle-id',
  title: 'Apple Bundle ID registered',
  store: 'appstore',
  categories: ['signing', 'submit'],
  /**
   * Verify that every selected iOS app has a registered Apple Bundle ID.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with one Bundle ID finding per selected app.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      const apps = iosApps(readinessContext.apps);
      if (apps.length === 0) return { state: 'omitted' };
      const api = yield* readinessContext.resolveAscApi();
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
            const bundleId = yield* api.findBundleId(identifier);
            if (bundleId) {
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: 'registered in the Developer portal',
              };
            }
            return {
              app: name,
              identifier,
              status: 'blocker' as const,
              detail: 'Bundle ID not registered in the Developer portal',
              hint: 'run `launch sync` to register the App ID before building for distribution',
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
