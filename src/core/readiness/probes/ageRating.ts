import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
/** The App Store Connect age-rating-declaration readiness probe - a listing-completeness and submit blocker. */
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
      const api = yield* readinessContext.resolveAscApi();
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
            const appInfoId = yield* api.getEditableAppInfoId(appId);
            if (!appInfoId) {
              return {
                app: name,
                identifier,
                status: 'warn' as const,
                detail: "can't verify - no editable app version",
                hint: 'create a new version in App Store Connect, then re-run',
              };
            }
            const declaration = yield* api.getAgeRatingDeclaration(appInfoId);
            if (declaration && Object.keys(declaration.attributes).length > 0) {
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: 'age-rating questionnaire completed',
              };
            }
            return {
              app: name,
              identifier,
              status: 'blocker' as const,
              detail: 'age-rating questionnaire not completed',
              hint: 'answer it in App Store Connect -> App Information -> Age Rating before submitting',
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
