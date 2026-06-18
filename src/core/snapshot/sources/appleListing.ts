/**
 * Source: capture each iOS app's App Store listing copy from App Store Connect — the per-locale store text
 * (name/subtitle/privacy URL from the app-level `appInfo`, plus description/keywords/whatsNew/… from the
 * editable version), merged into one entity per locale. This is the textual surface `launch sync` rewrites
 * from each app's `store.config.json`, so a pre-sync snapshot of it is the "before" a listing change is
 * diffed and (later) restored against.
 *
 * Read-only: it reads through the same `AppStoreConnectClient` listing methods `launch sync` uses, dropping
 * the volatile per-locale portal ids so re-capturing unchanged copy yields an identical record. An app with
 * no editable appInfo *and* no editable version (e.g. a live app mid-cycle) captures as an empty listing.
 */

import type {
  AppEntities,
  SnapshotAscApi,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
  SourceCapture,
} from "../types.js";
import type { ListingLocalization } from "../../../apple/ascClient.js";
import { iosApps } from "../../readiness/appScopes.js";

/** One locale's merged listing fields → a snapshot entity keyed by the locale (its natural, stable id). */
function toEntity(locale: string, fields: Record<string, string>): SnapshotEntity {
  return {
    key: locale,
    summary: `listing ${locale} (${Object.keys(fields).length} field(s))`,
    data: { locale, fields },
  };
}

/**
 * Merge the app-level and version-level listing localizations into one record per locale. App-info fields
 * (name/subtitle/privacy URL) and version fields (description/keywords/…) are disjoint, so a plain spread by
 * locale composes the full listing; the result is sorted by locale for a deterministic capture.
 */
async function captureListing(api: SnapshotAscApi, appId: string): Promise<SnapshotEntity[]> {
  const byLocale = new Map<string, Record<string, string>>();
  const merge = (localizations: ListingLocalization[]): void => {
    for (const localization of localizations) {
      byLocale.set(localization.locale, { ...byLocale.get(localization.locale), ...localization.fields });
    }
  };

  const appInfoId = await api.getEditableAppInfoId(appId);
  if (appInfoId) merge(await api.listAppInfoLocalizations(appInfoId));
  const versionId = await api.getEditableVersionId(appId);
  if (versionId) merge(await api.listVersionLocalizations(versionId));

  return [...byLocale.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([locale, fields]) => toEntity(locale, fields));
}

/** The App Store Connect store-listing snapshot source. */
export const appleListingSource: SnapshotSource = {
  id: "apple-listing",
  title: "App Store listing",
  store: "appstore",
  async capture(ctx: SnapshotContext): Promise<SourceCapture> {
    const apps = iosApps(ctx.apps);
    if (apps.length === 0) return { state: "omitted" };

    const api = await ctx.resolveAscApi();
    if (!api) return { state: "skipped", reason: "no active Apple account", hint: "run `launch creds set-key`" };

    const captured = await Promise.all(
      apps.map(async ({ name, identifier }): Promise<AppEntities | null> => {
        const appId = await api.getAppId(identifier);
        if (!appId) return null; // no App Store Connect record yet — nothing to capture for this app
        return { app: name, identifier, entities: await captureListing(api, appId) };
      }),
    );
    return { state: "captured", apps: captured.filter((app): app is AppEntities => app !== null) };
  },
};
