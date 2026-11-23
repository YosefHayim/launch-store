// Reads one app's live App Store Connect listing into the Launch store config.

import type { ListingLocalization } from '@/types/apple-catalog.js';
import type { JsonValue } from '@/types/snapshot.js';
import type { AppleLocaleInfo, AppleStoreConfig } from '@/store/shared/store-config.js';

/** The App Store Connect reads needed to assemble one app's live listing. */
type AppleListingReadApi = Readonly<{
  getCurrentAppInfoId: (appId: string) => Promise<string | null>;
  getCurrentVersionId: (appId: string) => Promise<string | null>;
  listAppInfoLocalizations: (appInfoId: string) => Promise<readonly ListingLocalization[]>;
  listVersionLocalizations: (versionId: string) => Promise<readonly ListingLocalization[]>;
}>;

/** One locale's merged App Store field map, keyed by Apple's field names. */
type AppleLocaleFields = Readonly<{
  locale: string;
  fields: Record<string, string>;
}>;

function compareLocaleNames(
  leftLocale: readonly [string, Record<string, string>],
  rightLocale: readonly [string, Record<string, string>],
): number {
  return leftLocale[0].localeCompare(rightLocale[0]);
}

function readLocaleFields(
  localeEntry: readonly [string, Record<string, string>],
): AppleLocaleFields {
  return { locale: localeEntry[0], fields: localeEntry[1] };
}

/** Merge the app-level and version-level listing localizations into one record per locale. */
export async function readAppleLocaleFields(
  api: AppleListingReadApi,
  appId: string,
): Promise<AppleLocaleFields[]> {
  const byLocale = new Map<string, Record<string, string>>();

  function merge(localizations: readonly ListingLocalization[]): void {
    for (const localization of localizations) {
      const existingFields = byLocale.get(localization.locale);

      byLocale.set(localization.locale, {
        ...existingFields,
        ...localization.fields,
      });
    }
  }

  const appInfoId = await api.getCurrentAppInfoId(appId);

  const isAppInfoMissing = appInfoId == null;

  if (isAppInfoMissing) {
    // App-info localizations are optional for this capture.
  } else {
    const appInfoLocalizations = await api.listAppInfoLocalizations(appInfoId);
    merge(appInfoLocalizations);
  }

  const versionId = await api.getCurrentVersionId(appId);

  const isVersionMissing = versionId == null;

  if (isVersionMissing) {
    // Version localizations are optional for this capture.
  } else {
    const versionLocalizations = await api.listVersionLocalizations(versionId);
    merge(versionLocalizations);
  }

  const localeEntries = [...byLocale.entries()];
  const sortedLocaleEntries = localeEntries.sort(compareLocaleNames);

  return sortedLocaleEntries.map(readLocaleFields);
}

/** Read a string-valued field from a captured listing's `fields` map, or undefined when absent/non-string. */
function fieldString(
  fields: Readonly<{ [key: string]: JsonValue }>,
  key: string,
): string | undefined {
  const listingField = fields[key];

  if (typeof listingField == 'string') {
    return listingField;
  }

  return undefined;
}

/** Invert one locale's Apple-named fields back into an {@link AppleLocaleInfo} */
export function readLocaleInfo(fields: Readonly<{ [key: string]: JsonValue }>): AppleLocaleInfo {
  const localeInfo: AppleLocaleInfo = {};
  const title = fieldString(fields, 'name');

  if (title != null) localeInfo.title = title;

  const subtitle = fieldString(fields, 'subtitle');

  if (subtitle != null) localeInfo.subtitle = subtitle;

  const privacyPolicyUrl = fieldString(fields, 'privacyPolicyUrl');

  if (privacyPolicyUrl != null) localeInfo.privacyPolicyUrl = privacyPolicyUrl;

  const description = fieldString(fields, 'description');

  if (description != null) localeInfo.description = description;

  const keywords = fieldString(fields, 'keywords');

  if (keywords != null) {
    function trimKeyword(keyword: string) {
      return keyword.trim();
    }

    const list = keywords.split(',').map(trimKeyword).filter(Boolean);

    if (list.length > 0) localeInfo.keywords = list;
  }

  const releaseNotes = fieldString(fields, 'whatsNew');

  if (releaseNotes != null) localeInfo.releaseNotes = releaseNotes;

  const promotionalText = fieldString(fields, 'promotionalText');

  if (promotionalText != null) localeInfo.promotionalText = promotionalText;

  const supportUrl = fieldString(fields, 'supportUrl');

  if (supportUrl != null) localeInfo.supportUrl = supportUrl;

  const marketingUrl = fieldString(fields, 'marketingUrl');

  if (marketingUrl != null) localeInfo.marketingUrl = marketingUrl;

  return localeInfo;
}

/** Read an app's live App Store listing as the `apple` section of `listing` in launch.config.ts. */
export async function readAppleListing(
  api: AppleListingReadApi,
  appId: string,
): Promise<AppleStoreConfig> {
  const localeFields = await readAppleLocaleFields(api, appId);
  const localeInfoByLocale: Record<string, AppleLocaleInfo> = {};

  for (const { locale, fields } of localeFields) {
    const localeInfo = readLocaleInfo(fields);

    const hasLocaleFields = Object.keys(localeInfo).length > 0;

    if (hasLocaleFields) {
      localeInfoByLocale[locale] = localeInfo;
    }
  }

  return { info: localeInfoByLocale };
}
