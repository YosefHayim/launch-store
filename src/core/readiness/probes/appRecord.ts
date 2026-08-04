import type { ProbeResult, ReadinessContext, ReadinessProbe } from '@core/types/readiness.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
/** The App Store Connect app-record readiness probe - both an account-onboarding and a submit blocker. */
export const appRecordProbe = {
  id: 'apple-app-record',
  title: 'App Store Connect app record',
  store: 'appstore',
  categories: ['account', 'submit'],
  /**
   * Verify that every selected iOS app has an App Store Connect app record.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with one app-record finding per selected app.
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
            const appId = yield* api.getAppId(identifier);
            if (appId) {
              return { app: name, identifier, status: 'ok' as const, detail: 'record exists' };
            }
            return {
              app: name,
              identifier,
              status: 'blocker' as const,
              detail: 'no app record on App Store Connect',
              hint: "create the app once in App Store Connect - Apple's API can't (no POST /v1/apps)",
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
