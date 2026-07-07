/**
 * Probe: does each iOS app declare an **account-deletion URL**? Apple requires one for any app that lets
 * users create an account (App Store Review Guideline 5.1.1(v)) — the link a user follows to delete their
 * account and data. A submission without it is rejected when the app offers sign-up, but the requirement is
 * conditional (an app with no accounts needs none), so a missing URL is an advisory `warn`, not a hard
 * blocker: this probe can't tell from outside whether the app offers account creation.
 *
 * Read-only: it reads the URL off the editable version's `appInfo` (Apple's `privacyChoicesUrl`, surfaced as
 * "Account Deletion" in App Store Connect) via the same readers `launch sync` uses, and never writes one. An
 * app with no record or no editable version can't be graded — those degrade to a `warn`, not a false finding.
 */

import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/index.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';

/** The App Store Connect account-deletion-URL readiness probe — a listing-completeness, conditionally-submit check. */
export const accountDeletionProbe = {
  id: 'apple-account-deletion',
  title: 'Account-deletion URL declared',
  store: 'appstore',
  categories: ['listing', 'submit'],
  /**
   * Verify that each selected iOS app has an account-deletion URL on editable App Store info.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with one account-deletion finding per selected app.
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
            const urls = yield* Effect.tryPromise({
              try: () => api.listAccountDeletionUrls(appInfoId),
              catch: (apiFailure) => apiFailure,
            });
            const declared = urls.filter((entry) => entry.url.length > 0);
            return declared.length > 0
              ? {
                  app: name,
                  identifier,
                  status: 'ok' as const,
                  detail: `account-deletion URL set in ${declared.length} locale(s)`,
                }
              : {
                  app: name,
                  identifier,
                  status: 'warn' as const,
                  detail: 'no account-deletion URL set',
                  hint: 'Apple requires it if your app lets users create an account — add it under App Store Connect → App Privacy → Account Deletion',
                };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
