/**
 * Probe: does each iOS app have an App Store Connect **app record**? It's the one thing Apple's API can't
 * create (there is no `POST /v1/apps`), so a missing record blocks every later upload/submit deep in the
 * pipeline. Catching it up front — read-only, via the same `getAppId` lookup `launch sync` uses — turns a
 * cryptic mid-build failure into one actionable line.
 */

import type { ProbeResult, ReadinessContext, ReadinessProbe } from '../../types/index.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';

/** The App Store Connect app-record readiness probe — both an account-onboarding and a submit blocker. */
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

      const results = yield* Effect.forEach(
        apps,
        ({ name, identifier }) =>
          Effect.gen(function* () {
            const appId = yield* Effect.tryPromise({
              try: () => api.getAppId(identifier),
              catch: (apiFailure) => apiFailure,
            });
            return appId
              ? { app: name, identifier, status: 'ok' as const, detail: 'record exists' }
              : {
                  app: name,
                  identifier,
                  status: 'blocker' as const,
                  detail: 'no app record on App Store Connect',
                  hint: "create the app once in App Store Connect — Apple's API can't (no POST /v1/apps)",
                };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
