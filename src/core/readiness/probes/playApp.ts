/**
 * Probe: does each Android app exist on Google Play **and** can the configured service account reach it?
 * `assertAppExists` opens (and immediately abandons) a read edit, so a success proves both the app is
 * created and the service account has API access — the two account-level prerequisites Play submission
 * needs. A thrown {@link import("../../../google/playClient.js").PlayAppNotFoundError} is the expected
 * "not ready" signal, mapped to a blocker rather than allowed to error the run.
 */

import type { ProbeResult, ReadinessContext, ReadinessProbe } from '../../types/index.js';
import { Effect } from 'effect';
import { androidApps } from '../appScopes.js';

/** The Google Play app-exists / service-account-access readiness probe — an account and a submit blocker. */
export const playAppProbe = {
  id: 'play-app-access',
  title: 'Play app exists & service account authorized',
  store: 'play',
  categories: ['account', 'submit'],
  /**
   * Verify that each selected Android app exists and is reachable by the Play service account.
   *
   * @param readinessContext - Loaded config, selected apps, and Google Play resolver.
   * @returns An Effect that succeeds with one Play app-access finding per selected app.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      const apps = androidApps(readinessContext.apps);
      if (apps.length === 0) return { state: 'omitted' };

      const api = yield* Effect.tryPromise({
        try: () => readinessContext.resolvePlayApi(),
        catch: (resolverFailure) => resolverFailure,
      });
      if (!api) {
        return {
          state: 'skipped',
          reason: 'no Play service account',
          hint: 'configure a Play service account',
        };
      }

      const results = yield* Effect.forEach(
        apps,
        ({ name, identifier }) =>
          Effect.tryPromise({
            try: () => api.assertAppExists(identifier),
            catch: (apiFailure) => apiFailure,
          }).pipe(
            Effect.as({
              app: name,
              identifier,
              status: 'ok' as const,
              detail: 'app reachable; service account authorized',
            }),
            Effect.catchAll((apiFailure) =>
              Effect.succeed({
                app: name,
                identifier,
                status: 'blocker' as const,
                detail: apiFailure instanceof Error ? apiFailure.message : String(apiFailure),
                hint: 'create the app in Play Console and grant the service account access to it',
              }),
            ),
          ),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
