import { Effect } from 'effect';
import type { ListingLocalization } from '../types/appleCatalog.js';
import type { JsonValue, SnapshotAscApi } from '../types/snapshot.js';
import type { AppleLocaleInfo, AppleStoreConfig } from './storeConfig.js';

/** The App Store Connect reads needed to assemble one app's live listing. */
export type AppleListingReadApi = Pick<
  SnapshotAscApi,
  | 'getEditableAppInfoId'
  | 'getEditableVersionId'
  | 'listAppInfoLocalizations'
  | 'listVersionLocalizations'
>;

/** One locale's merged App Store field map, keyed by Apple's field names. */
export type AppleLocaleFields = Readonly<{
  locale: string;
  fields: Record<string, string>;
}>;

/**
 * Merge the app-level and version-level listing localizations into one record per locale. App-info fields
 * (name/subtitle/privacy URL) and version fields (description/keywords/...) are disjoint, so a plain spread by
 * locale composes the full listing; the result is sorted by locale for a deterministic capture.
 */
export const readAppleLocaleFields = (
  api: AppleListingReadApi,
  appId: string,
): Effect.Effect<AppleLocaleFields[], unknown> =>
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
      .map(([locale, fields]) => ({ locale, fields }));
  });

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
 * Invert one locale's Apple-named fields back into an {@link AppleLocaleInfo} - the mirror of
 * `ascSync.routeListing`. Only present fields are carried, and the comma-joined `keywords` string is split
 * back into the array shape `store.config.json` uses.
 */
export const toLocaleInfo = (fields: Readonly<{ [key: string]: JsonValue }>): AppleLocaleInfo => {
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

/** Read an app's live App Store listing as the `apple` section of store.config.json. */
export const readAppleListing = (
  api: AppleListingReadApi,
  appId: string,
): Effect.Effect<AppleStoreConfig, unknown> =>
  Effect.gen(function* () {
    const localeFields = yield* readAppleLocaleFields(api, appId);
    const localeInfoByLocale: Record<string, AppleLocaleInfo> = {};
    for (const { locale, fields } of localeFields) {
      const localeInfo = toLocaleInfo(fields);
      if (Object.keys(localeInfo).length > 0) localeInfoByLocale[locale] = localeInfo;
    }
    return { info: localeInfoByLocale };
  });
