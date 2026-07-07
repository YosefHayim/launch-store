/**
 * Probe: has each Android app received its **first build upload**? Google Play blocks API-driven
 * submission until at least one build has been uploaded (historically a manual Play Console upload), so a
 * brand-new app with valid credentials still can't be released by `launch` until this is satisfied.
 * `getLatestVersionCode` returns `0` when no bundle has been uploaded — the blocker signal — reusing the
 * same reader `launch status` uses. A read failure here is mapped to a `warn` (the app-access probe owns
 * the "app missing" blocker) so it never double-reports or errors the run.
 */

import type { ProbeResult, ReadinessContext, ReadinessProbe } from '../../types/index.js';
import { Effect } from 'effect';
import { androidApps } from '../appScopes.js';

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
            try: () => api.getLatestVersionCode(identifier),
            catch: (apiFailure) => apiFailure,
          }).pipe(
            Effect.map((versionCode) =>
              versionCode > 0
                ? {
                    app: name,
                    identifier,
                    status: 'ok' as const,
                    detail: `latest uploaded versionCode ${versionCode}`,
                  }
                : {
                    app: name,
                    identifier,
                    status: 'blocker' as const,
                    detail:
                      'no uploaded build — Play blocks API submission until the first build is uploaded',
                    hint: 'upload the first build once in Play Console (a manual AAB upload satisfies this)',
                  },
            ),
            Effect.catchAll((apiFailure) =>
              Effect.succeed({
                app: name,
                identifier,
                status: 'warn' as const,
                detail: `could not read uploads: ${apiFailure instanceof Error ? apiFailure.message : String(apiFailure)}`,
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
