/**
 * Probe: is a Google Play **internal testing track** available for each Android app? The internal track is
 * the fastest path to get a build onto testers' devices and the usual first rollout target, so its absence
 * is worth flagging — but it's a recommendation, not a hard submission blocker, so a missing track is a
 * `warn`, not a `blocker`. Read-only via the same `listTracks` reader `launch play-tracks status` uses.
 */

import type { ProbeResult, ReadinessContext, ReadinessProbe } from '../../types/index.js';
import { Effect } from 'effect';
import { androidApps } from '../appScopes.js';

/** The track id Google Play always provisions for internal testing. */
const INTERNAL_TRACK = 'internal';

/** The Google Play internal-track readiness probe. */
export const playInternalTrackProbe = {
  id: 'play-internal-track',
  title: 'Internal testing track ready',
  store: 'play',
  categories: ['account'],
  /**
   * Verify that each selected Android app has an internal testing track.
   *
   * @param readinessContext - Loaded config, selected apps, and Google Play resolver.
   * @returns An Effect that succeeds with one internal-track finding per selected app.
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
            try: () => api.listTracks(identifier),
            catch: (apiFailure) => apiFailure,
          }).pipe(
            Effect.map((tracks) =>
              tracks.some((track) => track.track === INTERNAL_TRACK)
                ? {
                    app: name,
                    identifier,
                    status: 'ok' as const,
                    detail: 'internal track available',
                  }
                : {
                    app: name,
                    identifier,
                    status: 'warn' as const,
                    detail: 'no internal testing track',
                    hint: 'create an internal testing track in Play Console for the fastest tester rollout',
                  },
            ),
            Effect.catchAll((apiFailure) =>
              Effect.succeed({
                app: name,
                identifier,
                status: 'warn' as const,
                detail: `could not read tracks: ${apiFailure instanceof Error ? apiFailure.message : String(apiFailure)}`,
                hint: 'confirm the app exists and the service account has access (see the app-access check)',
              }),
            ),
          ),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
