import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.js';
/** The App Store Connect account-deletion-URL readiness probe - a listing-completeness, conditionally-submit check. */
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
      if (apps.length === 0) return OMITTED_PROBE;
      const api = yield* readinessContext.resolveAscApi();
      if (!api) return SKIPPED_NO_APPLE_ACCOUNT;
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
            const urls = yield* api.listAccountDeletionUrls(appInfoId);
            const declared = urls.filter((entry) => entry.url.length > 0);
            if (declared.length > 0) {
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: `account-deletion URL set in ${declared.length} locale(s)`,
              };
            }
            return {
              app: name,
              identifier,
              status: 'warn' as const,
              detail: 'no account-deletion URL set',
              hint: 'Apple requires it if your app lets users create an account - add it under App Store Connect -> App Privacy -> Account Deletion',
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
