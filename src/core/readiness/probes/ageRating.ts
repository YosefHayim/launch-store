/**
 * Probe: has each iOS app completed its **age-rating questionnaire** on App Store Connect? Apple won't
 * accept a submission until the age-rating declaration exists and is answered — an untouched questionnaire
 * is a hard App Review blocker that's easy to forget because it lives on the version's `appInfo`, not the
 * app record. This surfaces it before submission instead of at rejection.
 *
 * Read-only: it reads the editable version's declaration via the same readers `launch sync` uses and never
 * writes an answer. The declaration hangs off the editable (unpublished) version's `appInfo`, so an app
 * with no editable version or no app record can't be graded — those degrade to a `warn`, not a false
 * blocker. Per-app over the iOS scope; omits itself when no iOS app is in scope.
 */

import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/index.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';

/** The App Store Connect age-rating-declaration readiness probe — a listing-completeness and submit blocker. */
export const ageRatingProbe = {
  id: 'apple-age-rating',
  title: 'Age rating completed',
  store: 'appstore',
  categories: ['listing', 'submit'],
  /**
   * Verify that each selected iOS app has completed its age-rating questionnaire.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with one age-rating finding per selected app.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      const apps = iosApps(readinessContext.apps);
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

      const results: AppReadiness[] = yield* Effect.forEach(
        apps,
        ({ name, identifier }) =>
          Effect.gen(function* () {
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
            const appInfoId = yield* Effect.tryPromise({
              try: () => api.getEditableAppInfoId(appId),
              catch: (apiFailure) => apiFailure,
            });
            if (!appInfoId) {
              return {
                app: name,
                identifier,
                status: 'warn' as const,
                detail: "can't verify — no editable app version",
                hint: 'create a new version in App Store Connect, then re-run',
              };
            }
            const declaration = yield* Effect.tryPromise({
              try: () => api.getAgeRatingDeclaration(appInfoId),
              catch: (apiFailure) => apiFailure,
            });
            return declaration && Object.keys(declaration.attributes).length > 0
              ? {
                  app: name,
                  identifier,
                  status: 'ok' as const,
                  detail: 'age-rating questionnaire completed',
                }
              : {
                  app: name,
                  identifier,
                  status: 'blocker' as const,
                  detail: 'age-rating questionnaire not completed',
                  hint: 'answer it in App Store Connect → App Information → Age Rating before submitting',
                };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
