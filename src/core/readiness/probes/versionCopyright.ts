import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.js';
/** The editable-version copyright readiness probe - Apple refuses to submit a version without one. */
export const versionCopyrightProbe = {
  id: 'apple-version-copyright',
  title: 'Version copyright set',
  store: 'appstore',
  categories: ['listing', 'submit'],
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      const apps = iosApps(readinessContext.apps);
      if (apps.length === 0) return OMITTED_PROBE;
      const api = yield* readinessContext.resolveAscApi();
      if (!api) return SKIPPED_NO_APPLE_ACCOUNT;
      const configuredCopyright = readinessContext.config.release?.copyright;
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
            if (version.copyright.length > 0) {
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: `copyright set ("${version.copyright}")`,
              };
            }
            if (configuredCopyright !== undefined && configuredCopyright.length > 0) {
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: `copyright empty on App Store Connect - \`launch release\` sets "${configuredCopyright}"`,
              };
            }
            return {
              app: name,
              identifier,
              status: 'blocker' as const,
              detail: 'no copyright on the editable version',
              hint: 'set `release.copyright` in launch.config.ts (sent by `launch release`), or fill Copyright in App Store Connect -> the version -> General',
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
