import { Effect } from 'effect';
import type {
  AppEntities,
  JsonValue,
  RestoreInput,
  SnapshotAscApi,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
} from '@core/types/snapshot.js';
import type { PlannedAction } from '@core/types/reconcile.js';
import { readAppleLocaleFields, toLocaleInfo } from '@core/store/appleListingRead.js';
import type { AppleLocaleInfo, AppleStoreConfig } from '@core/store/storeConfig.js';
import { reconcileAppListing } from '@core/store/ascSync.js';
import { iosApps } from '@core/readiness/appScopes.js';
/** One locale's merged listing fields -> a snapshot entity keyed by the locale (its natural, stable id). */
const toEntity = (locale: string, fields: Record<string, string>): SnapshotEntity => {
  return {
    key: locale,
    summary: `listing ${locale} (${Object.keys(fields).length} field(s))`,
    data: { locale, fields },
  };
};
/** One app's live listing -> one snapshot entity per locale. */
const captureListing = (
  api: SnapshotAscApi,
  appId: string,
): Effect.Effect<SnapshotEntity[], unknown> =>
  Effect.gen(function* () {
    const localeFields = yield* readAppleLocaleFields(api, appId);
    return localeFields.map(({ locale, fields }) => toEntity(locale, fields));
  });
/** Narrow a captured {@link JsonValue} to a plain object (rejecting arrays and null). */
const isJsonObject = (
  capturedNode: JsonValue,
): capturedNode is Readonly<{ [key: string]: JsonValue }> => {
  if (typeof capturedNode !== 'object') return false;
  if (capturedNode === null) return false;
  if (Array.isArray(capturedNode)) return false;
  return true;
};
/** Rebuild the `AppleStoreConfig` listing from one app's captured per-locale entities (skips malformed ones). */
const toListing = (saved: AppEntities): AppleStoreConfig => {
  const localeInfoByLocale: Record<string, AppleLocaleInfo> = {};
  for (const entity of saved.entities) {
    const capturedListing = entity.data;
    if (!isJsonObject(capturedListing)) continue;
    const locale = capturedListing['locale'];
    const fields = capturedListing['fields'];
    if (typeof locale !== 'string') continue;
    if (fields === undefined) continue;
    if (!isJsonObject(fields)) continue;
    localeInfoByLocale[locale] = toLocaleInfo(fields);
  }
  return { info: localeInfoByLocale };
};
/** The App Store Connect store-listing snapshot source. */
export const appleListingSource: SnapshotSource = {
  id: 'apple-listing',
  title: 'App Store listing',
  store: 'appstore',
  capture(snapshotContext: SnapshotContext) {
    return Effect.gen(function* () {
      const apps = iosApps(snapshotContext.apps);
      if (apps.length === 0) return { state: 'omitted' };
      const api = yield* snapshotContext.resolveAscApi();
      if (!api)
        return {
          state: 'skipped',
          reason: 'no active Apple account',
          hint: 'run `launch creds set-key`',
        };
      const captured = yield* Effect.forEach(
        apps,
        ({ name, identifier }) =>
          Effect.gen(function* () {
            const appId = yield* api.getAppId(identifier);
            if (!appId) return null; // no App Store Connect record yet - nothing to capture for this app
            return { app: name, identifier, entities: yield* captureListing(api, appId) };
          }),
        { concurrency: 'unbounded' },
      );
      return {
        state: 'captured',
        apps: captured.flatMap((app) => {
          if (app === null) return [];
          return [app];
        }),
      };
    });
  },
  /**
   * Restore each app's captured listing copy back to App Store Connect, reusing the same per-locale
   * reconciler `launch sync` / `launch plan`'s listing surface uses. Additive: `reconcileAppListing`
   * creates/patches text and never removes it. Each app is isolated - a missing app-record precondition
   * is recorded as a skipped action rather than aborting the rest.
   */
  restore({ ctx: restoreContext, saved, dryRun }: RestoreInput) {
    return Effect.gen(function* () {
      const client = yield* restoreContext.resolveAscWriteClient();
      if (!client) {
        return {
          actions: [
            {
              description: 'App Store listing: skipped - no active Apple account',
              destructive: false,
              status: 'skipped',
            },
          ],
        };
      }
      const actions: PlannedAction[] = [];
      for (const app of saved) {
        const listing = toListing(app);
        if (Object.keys(listing.info).length === 0) continue;
        const reconciliation = yield* reconcileAppListing(client, {
          bundleId: app.identifier,
          listing,
          dryRun,
        }).pipe(
          Effect.match({
            onFailure: (reconciliationFailure) => {
              let failureMessage = String(reconciliationFailure);
              if (reconciliationFailure instanceof Error)
                failureMessage = reconciliationFailure.message;
              return {
                actions: [
                  {
                    description: `App Store listing ${app.identifier}: ${failureMessage}`,
                    destructive: false,
                    status: 'skipped',
                  } satisfies PlannedAction,
                ],
              };
            },
            onSuccess: (reconciliationReport) => reconciliationReport,
          }),
        );
        actions.push(...reconciliation.actions);
      }
      return { actions };
    });
  },
};
