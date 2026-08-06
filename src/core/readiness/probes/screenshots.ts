import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { REQUIRED_APPLE_SCREENSHOT_DISPLAY_TYPES } from '@core/listing/screenshots/specs.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.js';
/** Apple's display-type prefix for every iPhone screenshot class (e.g. `APP_IPHONE_67`, `APP_IPHONE_65`). */
const IPHONE_DISPLAY_PREFIX = 'APP_IPHONE';
const populatedIphoneDisplayTypes = (
  api: AscReadinessApi,
  versionId: string,
): Effect.Effect<Set<string>, unknown> => {
  return Effect.gen(function* () {
    const localizations = yield* api.listAppStoreVersionLocalizations(versionId);
    const setsPerLocale = yield* Effect.forEach(
      localizations,
      (localization) => api.listScreenshotSets(localization.id),
      { concurrency: 'unbounded' },
    );
    const iphoneSets = setsPerLocale
      .flat()
      .filter((set) => set.screenshotDisplayType.startsWith(IPHONE_DISPLAY_PREFIX));
    const populatedDisplayTypes = yield* Effect.forEach(
      iphoneSets,
      (screenshotSet) =>
        api.listScreenshots(screenshotSet.id).pipe(
          Effect.map((screenshots) => {
            if (screenshots.length > 0) return screenshotSet.screenshotDisplayType;
            return undefined;
          }),
        ),
      { concurrency: 'unbounded' },
    );
    return new Set(
      populatedDisplayTypes.filter(
        (displayType): displayType is string => displayType !== undefined,
      ),
    );
  });
};
/** The App Store Connect iPhone-screenshot readiness probe - a listing-completeness check and submit blocker. */
export const screenshotsProbe = {
  id: 'apple-screenshots',
  title: 'iPhone screenshots uploaded',
  store: 'appstore',
  categories: ['listing', 'submit'],
  /**
   * Verify that each selected iOS app has required iPhone screenshots uploaded.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with one screenshot finding per selected app.
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
            const populated = yield* populatedIphoneDisplayTypes(api, version.id);
            if (
              REQUIRED_APPLE_SCREENSHOT_DISPLAY_TYPES.every((displayType) =>
                populated.has(displayType),
              )
            ) {
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: '6.7" iPhone screenshots uploaded',
              };
            }
            if (populated.size > 0)
              return {
                app: name,
                identifier,
                status: 'warn' as const,
                detail: 'iPhone screenshots present, but none for the required 6.7" class',
                hint: 'upload at least one 6.7" iPhone screenshot (App Store Connect -> the version -> Previews and Screenshots)',
              };
            return {
              app: name,
              identifier,
              status: 'blocker' as const,
              detail: 'no iPhone screenshots uploaded',
              hint: 'add iPhone screenshots (App Store Connect -> the version -> Previews and Screenshots) before submitting',
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
