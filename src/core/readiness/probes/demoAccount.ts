/**
 * Probe: if an iOS app requires sign-in to use, has it given App Review a **demo account**? When a build's
 * App Review details set `demoAccountRequired`, Apple's reviewer needs working credentials to get past the
 * login wall — a build that demands sign-in without a demo account name is rejected on first contact
 * (Guideline 2.1). The probe surfaces that gap before submission instead of after a multi-day round-trip.
 *
 * Read-only: it reads the editable version's App Review detail via the same readers `launch sync` uses and
 * never writes one. The demo password is write-only on Apple's side and never returned, so the probe grades
 * only the readable `demoAccountRequired` / `demoAccountName` pair. An app with no record, no editable
 * version, or no App Review detail yet can't be graded — those degrade to a `warn`, not a false blocker.
 */

import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/index.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';

/** The App Store Connect demo-account readiness probe — a listing-completeness check and submit blocker. */
export const demoAccountProbe = {
  id: 'apple-demo-account',
  title: 'Demo account provided when sign-in is required',
  store: 'appstore',
  categories: ['listing', 'submit'],
  /**
   * Verify that App Review has demo credentials when an app requires sign-in.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with one demo-account finding per selected app.
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
            const version = yield* Effect.tryPromise({
              try: () => api.findEditableAppStoreVersion(appId, 'IOS'),
              catch: (apiFailure) => apiFailure,
            });
            if (!version) {
              return {
                app: name,
                identifier,
                status: 'warn' as const,
                detail: "can't verify — no editable app version",
                hint: 'create a new version in App Store Connect, then re-run',
              };
            }
            const detail = yield* Effect.tryPromise({
              try: () => api.getAppStoreReviewDetail(version.id),
              catch: (apiFailure) => apiFailure,
            });
            if (!detail) {
              return {
                app: name,
                identifier,
                status: 'warn' as const,
                detail: 'App Review details not set',
                hint: 'fill in App Store Connect → App Review Information, including a demo account if your app requires sign-in',
              };
            }
            const required = detail.attributes['demoAccountRequired'] === true;
            const demoName = detail.attributes['demoAccountName'];
            const hasName = typeof demoName === 'string' && demoName.length > 0;
            if (!required) {
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: 'no sign-in required for App Review',
              };
            }
            return hasName
              ? {
                  app: name,
                  identifier,
                  status: 'ok' as const,
                  detail: 'demo account provided for App Review',
                }
              : {
                  app: name,
                  identifier,
                  status: 'blocker' as const,
                  detail: 'sign-in required but no demo account provided',
                  hint: 'add demo credentials under App Store Connect → App Review Information before submitting',
                };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
