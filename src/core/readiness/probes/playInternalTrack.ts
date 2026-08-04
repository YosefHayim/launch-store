import type { ProbeResult, ReadinessContext, ReadinessProbe } from '@core/types/readiness.js';
import { errorMessage } from '@core/services/errorMessage.js';
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
      const api = yield* readinessContext.resolvePlayApi();
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
          api.listTracks(identifier).pipe(
            Effect.map((tracks) => {
              if (tracks.some((track) => track.track === INTERNAL_TRACK)) {
                return {
                  app: name,
                  identifier,
                  status: 'ok' as const,
                  detail: 'internal track available',
                };
              }
              return {
                app: name,
                identifier,
                status: 'warn' as const,
                detail: 'no internal testing track',
                hint: 'create an internal testing track in Play Console for the fastest tester rollout',
              };
            }),
            Effect.catchAll((apiFailure) =>
              Effect.succeed({
                app: name,
                identifier,
                status: 'warn' as const,
                detail: `could not read tracks: ${errorMessage(apiFailure)}`,
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
