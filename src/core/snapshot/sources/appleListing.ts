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
import type { ListingLocalization } from '@core/types/appleCatalog.js';
import type { PlannedAction } from '@core/types/reconcile.js';
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
/**
 * Merge the app-level and version-level listing localizations into one record per locale. App-info fields
 * (name/subtitle/privacy URL) and version fields (description/keywords/...) are disjoint, so a plain spread by
 * locale composes the full listing; the result is sorted by locale for a deterministic capture.
 */
const captureListing = (
  api: SnapshotAscApi,
  appId: string,
): Effect.Effect<SnapshotEntity[], unknown> =>
  Effect.gen(function* () {
    const byLocale = new Map<string, Record<string, string>>();
    const merge = (localizations: readonly ListingLocalization[]): void => {
      for (const localization of localizations) {
        byLocale.set(localization.locale, {
          ...byLocale.get(localization.locale),
          ...localization.fields,
        });
      }
    };
    const appInfoId = yield* api.getEditableAppInfoId(appId);
    if (appInfoId) merge(yield* api.listAppInfoLocalizations(appInfoId));
    const versionId = yield* api.getEditableVersionId(appId);
    if (versionId) merge(yield* api.listVersionLocalizations(versionId));
    return [...byLocale.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([locale, fields]) => toEntity(locale, fields));
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
/** Read a string-valued field from a captured listing's `fields` map, or undefined when absent/non-string. */
const fieldString = (
  fields: Readonly<{ [key: string]: JsonValue }>,
  key: string,
): string | undefined => {
  const listingField = fields[key];
  if (typeof listingField === 'string') return listingField;
  return undefined;
};
/**
 * Invert one captured locale's Apple-named fields back into an {@link AppleLocaleInfo} - the mirror of
 * `ascSync.routeListing`. Only present fields are carried, and the comma-joined `keywords` string is split
 * back into the array shape `store.config.json` uses.
 */
const toLocaleInfo = (fields: Readonly<{ [key: string]: JsonValue }>): AppleLocaleInfo => {
  const localeInfo: AppleLocaleInfo = {};
  const title = fieldString(fields, 'name');
  if (title !== undefined) localeInfo.title = title;
  const subtitle = fieldString(fields, 'subtitle');
  if (subtitle !== undefined) localeInfo.subtitle = subtitle;
  const privacyPolicyUrl = fieldString(fields, 'privacyPolicyUrl');
  if (privacyPolicyUrl !== undefined) localeInfo.privacyPolicyUrl = privacyPolicyUrl;
  const description = fieldString(fields, 'description');
  if (description !== undefined) localeInfo.description = description;
  const keywords = fieldString(fields, 'keywords');
  if (keywords !== undefined) {
    const list = keywords
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean);
    if (list.length > 0) localeInfo.keywords = list;
  }
  const releaseNotes = fieldString(fields, 'whatsNew');
  if (releaseNotes !== undefined) localeInfo.releaseNotes = releaseNotes;
  const promotionalText = fieldString(fields, 'promotionalText');
  if (promotionalText !== undefined) localeInfo.promotionalText = promotionalText;
  const supportUrl = fieldString(fields, 'supportUrl');
  if (supportUrl !== undefined) localeInfo.supportUrl = supportUrl;
  const marketingUrl = fieldString(fields, 'marketingUrl');
  if (marketingUrl !== undefined) localeInfo.marketingUrl = marketingUrl;
  return localeInfo;
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
