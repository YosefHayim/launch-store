import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.js';
/** The App Store Connect demo-account readiness probe - a listing-completeness check and submit blocker. */
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
            const version = yield* api.findEditableAppStoreVersion(appId, 'IOS');
            if (!version) {
              return {
                app: name,
                identifier,
                status: 'warn' as const,
                detail: "can't verify - no editable app version",
                hint: 'create a new version in App Store Connect, then re-run',
              };
            }
            const detail = yield* api.getAppStoreReviewDetail(version.id);
            if (!detail) {
              return {
                app: name,
                identifier,
                status: 'warn' as const,
                detail: 'App Review details not set',
                hint: 'fill in App Store Connect -> App Review Information, including a demo account if your app requires sign-in',
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
            if (hasName) {
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: 'demo account provided for App Review',
              };
            }
            return {
              app: name,
              identifier,
              status: 'blocker' as const,
              detail: 'sign-in required but no demo account provided',
              hint: 'add demo credentials under App Store Connect -> App Review Information before submitting',
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
