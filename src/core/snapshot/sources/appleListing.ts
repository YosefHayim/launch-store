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
  JsonValue,
  RestoreInput,
  RestoreReport,
  SnapshotAscApi,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
  SourceCapture,
} from '../../types.js';
import type { ListingLocalization } from '../../../apple/ascClient.js';
import type { PlannedAction } from '../../ascSync.js';
import type { AppleLocaleInfo, AppleStoreConfig } from '../../storeConfig.js';
import { reconcileAppListing } from '../../ascSync.js';
import { iosApps } from '../../readiness/appScopes.js';

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
      byLocale.set(localization.locale, {
        ...byLocale.get(localization.locale),
        ...localization.fields,
      });
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

/** Read a string-valued field from a captured listing's `fields` map, or undefined when absent/non-string. */
function fieldString(fields: Record<string, JsonValue>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Invert one captured locale's Apple-named fields back into an {@link AppleLocaleInfo} — the mirror of
 * `ascSync.routeListing`. Only present fields are carried, and the comma-joined `keywords` string is split
 * back into the array shape `store.config.json` uses.
 */
function toLocaleInfo(fields: Record<string, JsonValue>): AppleLocaleInfo {
  const info: AppleLocaleInfo = {};
  const title = fieldString(fields, 'name');
  if (title !== undefined) info.title = title;
  const subtitle = fieldString(fields, 'subtitle');
  if (subtitle !== undefined) info.subtitle = subtitle;
  const privacyPolicyUrl = fieldString(fields, 'privacyPolicyUrl');
  if (privacyPolicyUrl !== undefined) info.privacyPolicyUrl = privacyPolicyUrl;
  const description = fieldString(fields, 'description');
  if (description !== undefined) info.description = description;
  const keywords = fieldString(fields, 'keywords');
  if (keywords !== undefined) {
    const list = keywords
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean);
    if (list.length > 0) info.keywords = list;
  }
  const releaseNotes = fieldString(fields, 'whatsNew');
  if (releaseNotes !== undefined) info.releaseNotes = releaseNotes;
  const promotionalText = fieldString(fields, 'promotionalText');
  if (promotionalText !== undefined) info.promotionalText = promotionalText;
  const supportUrl = fieldString(fields, 'supportUrl');
  if (supportUrl !== undefined) info.supportUrl = supportUrl;
  const marketingUrl = fieldString(fields, 'marketingUrl');
  if (marketingUrl !== undefined) info.marketingUrl = marketingUrl;
  return info;
}

/** Rebuild the `AppleStoreConfig` listing from one app's captured per-locale entities (skips malformed ones). */
function toListing(saved: AppEntities): AppleStoreConfig {
  const info: Record<string, AppleLocaleInfo> = {};
  for (const entity of saved.entities) {
    const { data } = entity;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) continue;
    const locale = data['locale'];
    const fields = data['fields'];
    if (typeof locale !== 'string') continue;
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) continue;
    info[locale] = toLocaleInfo(fields);
  }
  return { info };
}

/** The App Store Connect store-listing snapshot source. */
export const appleListingSource: SnapshotSource = {
  id: 'apple-listing',
  title: 'App Store listing',
  store: 'appstore',
  async capture(ctx: SnapshotContext): Promise<SourceCapture> {
    const apps = iosApps(ctx.apps);
    if (apps.length === 0) return { state: 'omitted' };

    const api = await ctx.resolveAscApi();
    if (!api)
      return {
        state: 'skipped',
        reason: 'no active Apple account',
        hint: 'run `launch creds set-key`',
      };

    const captured = await Promise.all(
      apps.map(async ({ name, identifier }): Promise<AppEntities | null> => {
        const appId = await api.getAppId(identifier);
        if (!appId) return null; // no App Store Connect record yet — nothing to capture for this app
        return { app: name, identifier, entities: await captureListing(api, appId) };
      }),
    );
    return { state: 'captured', apps: captured.filter((app): app is AppEntities => app !== null) };
  },

  /**
   * Restore each app's captured listing copy back to App Store Connect, reusing the same per-locale
   * reconciler `launch sync` / `launch plan`'s listing surface uses. Additive: `reconcileAppListing`
   * creates/patches text and never removes it. Each app is isolated — a missing app-record precondition
   * is recorded as a skipped action rather than aborting the rest.
   */
  async restore({ ctx, saved, dryRun }: RestoreInput): Promise<RestoreReport> {
    const client = await ctx.resolveAscWriteClient();
    if (!client) {
      return {
        actions: [
          {
            description: 'App Store listing: skipped — no active Apple account',
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
      try {
        // biome-ignore lint/performance/noAwaitInLoops: serial App Store Connect writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
        const report = await reconcileAppListing(client, {
          bundleId: app.identifier,
          listing,
          dryRun,
        });
        actions.push(...report.actions);
      } catch (error) {
        actions.push({
          description: `App Store listing ${app.identifier}: ${error instanceof Error ? error.message : String(error)}`,
          destructive: false,
          status: 'skipped',
        });
      }
    }
    return { actions };
  },
};
