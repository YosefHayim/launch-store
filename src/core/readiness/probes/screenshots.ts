/**
 * Probe: has each iOS app uploaded the **iPhone screenshots** App Review requires? Apple won't accept a
 * submission without at least one screenshot for the 6.7" iPhone display class (`APP_IPHONE_67`) — the size
 * that backstops every smaller iPhone in the listing. A missing or empty screenshot set is a hard blocker
 * that's easy to miss because it lives per-locale on the editable version, not the app record.
 *
 * Read-only: it walks the editable version's localizations → screenshot sets → screenshots via the same
 * readers `launch sync` uses, confirming a set actually holds an image rather than merely existing. It never
 * uploads one. Whether the *exact* pixel dimensions are right is left to Apple's upload-time validation —
 * the codebase deliberately avoids re-deriving display classes from pixels (see `screenshotAssets.ts`). An
 * app with no record or no editable version can't be graded — those degrade to a `warn`, not a false blocker.
 */

import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
  AscReadinessApi,
} from '../../types/index.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';

/** Apple's display-type prefix for every iPhone screenshot class (e.g. `APP_IPHONE_67`, `APP_IPHONE_65`). */
const IPHONE_DISPLAY_PREFIX = 'APP_IPHONE';
/** The 6.7" iPhone class App Store Connect requires at least one screenshot for. */
const REQUIRED_IPHONE_DISPLAY_TYPE = 'APP_IPHONE_67';

/**
 * Read the iPhone screenshot display types that have at least one uploaded image.
 *
 * @param api - Read-only App Store Connect surface for readiness checks.
 * @param versionId - Editable App Store version id whose localizations should be inspected.
 * @returns An Effect that succeeds with populated iPhone display types across locales.
 */
function populatedIphoneDisplayTypes(
  api: AscReadinessApi,
  versionId: string,
): Effect.Effect<Set<string>, unknown> {
  return Effect.gen(function* () {
    const localizations = yield* Effect.tryPromise({
      try: () => api.listAppStoreVersionLocalizations(versionId),
      catch: (apiFailure) => apiFailure,
    });
    const setsPerLocale = yield* Effect.forEach(
      localizations,
      (localization) =>
        Effect.tryPromise({
          try: () => api.listScreenshotSets(localization.id),
          catch: (apiFailure) => apiFailure,
        }),
      { concurrency: 'unbounded' },
    );
    const iphoneSets = setsPerLocale
      .flat()
      .filter((set) => set.screenshotDisplayType.startsWith(IPHONE_DISPLAY_PREFIX));
    const populatedDisplayTypes = yield* Effect.forEach(
      iphoneSets,
      (screenshotSet) =>
        Effect.tryPromise({
          try: () => api.listScreenshots(screenshotSet.id),
          catch: (apiFailure) => apiFailure,
        }).pipe(
          Effect.map((screenshots) =>
            screenshots.length > 0 ? screenshotSet.screenshotDisplayType : undefined,
          ),
        ),
      { concurrency: 'unbounded' },
    );
    return new Set(
      populatedDisplayTypes.filter(
        (displayType): displayType is string => displayType !== undefined,
      ),
    );
  });
}

/** The App Store Connect iPhone-screenshot readiness probe — a listing-completeness check and submit blocker. */
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
            const populated = yield* populatedIphoneDisplayTypes(api, version.id);
            if (populated.has(REQUIRED_IPHONE_DISPLAY_TYPE)) {
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: '6.7" iPhone screenshots uploaded',
              };
            }
            return populated.size > 0
              ? {
                  app: name,
                  identifier,
                  status: 'warn' as const,
                  detail: 'iPhone screenshots present, but none for the required 6.7" class',
                  hint: 'upload at least one 6.7" iPhone screenshot (App Store Connect → the version → Previews and Screenshots)',
                }
              : {
                  app: name,
                  identifier,
                  status: 'blocker' as const,
                  detail: 'no iPhone screenshots uploaded',
                  hint: 'add iPhone screenshots (App Store Connect → the version → Previews and Screenshots) before submitting',
                };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
