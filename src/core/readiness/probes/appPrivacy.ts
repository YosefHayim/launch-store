import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { hasReleasedVersion } from '@core/release/appStoreRelease.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.js';
/**
 * The App Privacy readiness probe. Apple's public API can neither read nor set App Privacy, so an app
 * that has never been released gets it as a manual step: its first submission fails with
 * APP_DATA_USAGES_REQUIRED until the answers are published in the web UI.
 */
export const appPrivacyProbe = {
  id: 'apple-app-privacy',
  title: 'App Privacy published',
  store: 'appstore',
  categories: ['privacy', 'submit'],
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
            const storeVersions = yield* api.listAppStoreVersions(appId, 'IOS');
            if (hasReleasedVersion(storeVersions)) {
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: 'released before - App Privacy carries over to new versions',
              };
            }
            return {
              app: name,
              identifier,
              status: 'warn' as const,
              detail:
                "first version - App Privacy must be published by hand (Apple's API can't read it)",
              hint: 'publish the answers in App Store Connect -> App Privacy before submitting; Apple refuses the first submission until then',
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
