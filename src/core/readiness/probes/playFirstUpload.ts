import type { ProbeResult, ReadinessContext, ReadinessProbe } from '@core/types/readiness.js';
import { errorMessage } from '@core/services/errorMessage.js';
import { Effect } from 'effect';
import { androidApps } from '../appScopes.js';
import { OMITTED_PROBE, SKIPPED_NO_PLAY_ACCOUNT } from './credentialsSkip.js';
/** The Google Play first-upload readiness probe. */
export const playFirstUploadProbe = {
  id: 'play-first-upload',
  title: 'First build uploaded to Play',
  store: 'play',
  categories: ['account'],
  /**
   * Verify that each selected Android app has at least one uploaded Play build.
   *
   * @param readinessContext - Loaded config, selected apps, and Google Play resolver.
   * @returns An Effect that succeeds with one first-upload finding per selected app.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      const apps = androidApps(readinessContext.apps);
      if (apps.length === 0) return OMITTED_PROBE;
      const api = yield* readinessContext.resolvePlayApi();
      if (!api) {
        return SKIPPED_NO_PLAY_ACCOUNT;
      }
      const results = yield* Effect.forEach(
        apps,
        ({ name, identifier }) =>
          api.getLatestVersionCode(identifier).pipe(
            Effect.map((versionCode) => {
              if (versionCode > 0) {
                return {
                  app: name,
                  identifier,
                  status: 'ok' as const,
                  detail: `latest uploaded versionCode ${versionCode}`,
                };
              }
              return {
                app: name,
                identifier,
                status: 'blocker' as const,
                detail:
                  'no uploaded build - Play blocks API submission until the first build is uploaded',
                hint: 'upload the first build once in Play Console (a manual AAB upload satisfies this)',
              };
            }),
            Effect.catchAll((apiFailure) =>
              Effect.succeed({
                app: name,
                identifier,
                status: 'warn' as const,
                detail: `could not read uploads: ${errorMessage(apiFailure)}`,
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
