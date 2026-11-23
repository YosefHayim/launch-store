// Clamps a listing draft to App Store Connect and Google Play limits and merges it into config.

import type {
  AndroidLocaleInfo,
  AppleLocaleInfo,
  StoreConfig,
} from '../store/shared/store-config.ts';
import type { DraftListing, ListingBrief, LocaleDraft } from '../types/listing.ts';
import type { MutableDeep } from '../types/mutable.ts';
/** App Store field limits, in characters. */
export const APPLE_LIMITS = {
  title: 30,
  subtitle: 30,
  keywords: 100,
  promotionalText: 170,
  description: 4000,
} as const;
/** Play Store field limits, in characters. The short description is far tighter than Apple's subtitle. */
const ANDROID_LIMITS = {
  title: 30,
  shortDescription: 80,
  fullDescription: 4000,
} as const;

/** Hard-truncate to `max`, trimming a trailing partial word's whitespace so the cut reads cleanly. */
function clampText(listingText: string, maxCharacters: number): string {
  if (listingText.length <= maxCharacters) return listingText;

  return listingText.slice(0, maxCharacters).trimEnd();
}

/** The comma-joined serialization Apple counts against the 100-char keyword limit. */
export function serializeKeywords(keywords: readonly string[]): string {
  return keywords.join(', ');
}

/** Keep keywords from the front until adding the next would overflow the joined-string limit. */
function clampKeywords(keywords: readonly string[], maxCharacters: number): string[] {
  const keptKeywords: string[] = [];

  for (const keyword of keywords) {
    if (serializeKeywords([...keptKeywords, keyword]).length > maxCharacters) break;

    keptKeywords.push(keyword);
  }

  return keptKeywords;
}

/** Clamp every field of a draft to its App Store limit */
export function clampDraft(listingDraft: DraftListing): {
  draft: DraftListing;
  warnings: string[];
} {
  const warningMessages: string[] = [];
  const clampedDraft: MutableDeep<DraftListing> = {};

  /** Clamp one optional text field, recording a warning when it was over the limit. */
  function fitText(
    listingText: string | undefined,
    maxCharacters: number,
    fieldLabel: string,
  ): string | undefined {
    if (listingText == null) return undefined;

    if (listingText.length > maxCharacters) {
      warningMessages.push(
        `${fieldLabel} was ${listingText.length} chars; trimmed to the ${maxCharacters}-char limit.`,
      );
      return clampText(listingText, maxCharacters);
    }

    return listingText;
  }

  const title = fitText(listingDraft.title, APPLE_LIMITS.title, 'title');

  if (title != null) clampedDraft.title = title;

  const subtitle = fitText(listingDraft.subtitle, APPLE_LIMITS.subtitle, 'subtitle');

  if (subtitle != null) clampedDraft.subtitle = subtitle;

  const promotionalText = fitText(
    listingDraft.promotionalText,
    APPLE_LIMITS.promotionalText,
    'promotional text',
  );

  if (promotionalText != null) clampedDraft.promotionalText = promotionalText;

  const description = fitText(listingDraft.description, APPLE_LIMITS.description, 'description');

  if (description != null) clampedDraft.description = description;

  if (listingDraft.keywords != null) {
    const keptKeywords = clampKeywords(listingDraft.keywords, APPLE_LIMITS.keywords);

    if (keptKeywords.length < listingDraft.keywords.length) {
      warningMessages.push(
        `keywords exceeded the ${APPLE_LIMITS.keywords}-char limit; kept ${keptKeywords.length} of ${listingDraft.keywords.length}.`,
      );
    }

    if (keptKeywords.length > 0) clampedDraft.keywords = keptKeywords;
  }

  return { draft: clampedDraft, warnings: warningMessages };
}

/** Build the brief for one locale. */
export function briefFor(
  localeName: string,
  displayName: string,
  currentListing: AppleLocaleInfo | undefined,
  aboutOverride: string | undefined,
): ListingBrief {
  const listingBrief: MutableDeep<ListingBrief> = { locale: localeName, appName: displayName };
  let aboutText = aboutOverride;

  if (aboutText == null && currentListing != null) aboutText = currentListing.promotionalText;

  if (aboutText == null && currentListing != null) aboutText = currentListing.subtitle;

  if (aboutText != null && aboutText.length > 0) listingBrief.about = aboutText;

  if (currentListing?.keywords != null && currentListing.keywords.length > 0)
    listingBrief.keywords = currentListing.keywords;

  if (currentListing != null) listingBrief.current = currentListing;

  return listingBrief;
}

/** Derive a Play listing from the App Store draft */
export function deriveAndroidLocale(listingDraft: DraftListing): AndroidLocaleInfo {
  const androidListing: AndroidLocaleInfo = {};

  if (listingDraft.title != null)
    androidListing.title = clampText(listingDraft.title, ANDROID_LIMITS.title);

  let shortDescription = listingDraft.subtitle;

  if (shortDescription == null) shortDescription = listingDraft.promotionalText;

  if (shortDescription != null) {
    androidListing.shortDescription = clampText(shortDescription, ANDROID_LIMITS.shortDescription);
  }

  if (listingDraft.description != null)
    androidListing.fullDescription = clampText(
      listingDraft.description,
      ANDROID_LIMITS.fullDescription,
    );

  return androidListing;
}

/** Fold a draft into a config for one locale, immutably */
/** Merge a draft over one locale's existing App Store listing, copying keywords into a mutable array. */
function mergeAppleLocale(
  existingLocale: AppleLocaleInfo | undefined,
  listingDraft: DraftListing,
): AppleLocaleInfo {
  const mergedLocale: MutableDeep<AppleLocaleInfo> = {};

  if (existingLocale != null) {
    if (existingLocale.title != null) mergedLocale.title = existingLocale.title;

    if (existingLocale.subtitle != null) mergedLocale.subtitle = existingLocale.subtitle;

    if (existingLocale.description != null) mergedLocale.description = existingLocale.description;

    if (existingLocale.keywords != null) mergedLocale.keywords = [...existingLocale.keywords];

    if (existingLocale.releaseNotes != null)
      mergedLocale.releaseNotes = existingLocale.releaseNotes;

    if (existingLocale.promotionalText != null)
      mergedLocale.promotionalText = existingLocale.promotionalText;

    if (existingLocale.marketingUrl != null)
      mergedLocale.marketingUrl = existingLocale.marketingUrl;

    if (existingLocale.supportUrl != null) mergedLocale.supportUrl = existingLocale.supportUrl;

    if (existingLocale.privacyPolicyUrl != null)
      mergedLocale.privacyPolicyUrl = existingLocale.privacyPolicyUrl;
  }

  if (listingDraft.title != null) mergedLocale.title = listingDraft.title;

  if (listingDraft.subtitle != null) mergedLocale.subtitle = listingDraft.subtitle;

  if (listingDraft.description != null) mergedLocale.description = listingDraft.description;

  if (listingDraft.promotionalText != null)
    mergedLocale.promotionalText = listingDraft.promotionalText;

  if (listingDraft.keywords != null) mergedLocale.keywords = [...listingDraft.keywords];

  return mergedLocale;
}

export function applyDraft(
  storeConfiguration: StoreConfig,
  localeName: string,
  listingDraft: DraftListing,
  listingTargets: {
    ios: boolean;
    android: boolean;
  },
): StoreConfig {
  const updatedStoreConfiguration: StoreConfig = { ...storeConfiguration };

  if (listingTargets.ios) {
    let appleListing = storeConfiguration.apple;

    if (appleListing == null) appleListing = { info: {} };

    const localeInfo: Record<string, AppleLocaleInfo> = { ...appleListing.info };

    localeInfo[localeName] = mergeAppleLocale(appleListing.info[localeName], listingDraft);
    updatedStoreConfiguration.apple = {
      ...appleListing,
      info: localeInfo,
    };
  }

  if (listingTargets.android) {
    let androidListing = storeConfiguration.android;

    if (androidListing == null) androidListing = { info: {} };

    updatedStoreConfiguration.android = {
      ...androidListing,
      info: {
        ...androidListing.info,
        [localeName]: {
          ...androidListing.info[localeName],
          ...deriveAndroidLocale(listingDraft),
        },
      },
    };
  }

  return updatedStoreConfiguration;
}

/** Collapse a long field to a single trimmed line for the preview, with an ellipsis when cut. */
function previewText(listingText: string): string {
  const singleLineText = listingText.replace(/\s+/g, ' ').trim();

  if (singleLineText.length > 60) return `${singleLineText.slice(0, 57)}...`;

  return singleLineText;
}

/** Format one aligned preview line with its character budget. */
function previewLine(
  fieldLabel: string,
  listingText: string,
  usedCharacters: number,
  characterLimit: number,
): string {
  return `    ${fieldLabel.padEnd(13)} ${previewText(listingText)}  (${usedCharacters}/${characterLimit})`;
}

/** Render the drafts for confirmation */
export function renderDraftPreview(
  listingDrafts: LocaleDraft[],
  listingTargets: {
    ios: boolean;
    android: boolean;
  },
): string {
  function writeLocaleDraft({
    locale,
    draft,
    warnings,
  }: {
    readonly locale: string;
    readonly draft: DraftListing;
    readonly warnings: readonly string[];
  }) {
    const lines = [`  ${locale}`];

    if (listingTargets.ios) {
      if (draft.title != null)
        lines.push(previewLine('title', draft.title, draft.title.length, APPLE_LIMITS.title));

      if (draft.subtitle != null)
        lines.push(
          previewLine('subtitle', draft.subtitle, draft.subtitle.length, APPLE_LIMITS.subtitle),
        );

      if (draft.keywords != null) {
        const joined = serializeKeywords(draft.keywords);
        lines.push(previewLine('keywords', joined, joined.length, APPLE_LIMITS.keywords));
      }

      if (draft.promotionalText != null)
        lines.push(
          previewLine(
            'promo text',
            draft.promotionalText,
            draft.promotionalText.length,
            APPLE_LIMITS.promotionalText,
          ),
        );

      if (draft.description != null)
        lines.push(
          previewLine(
            'description',
            draft.description,
            draft.description.length,
            APPLE_LIMITS.description,
          ),
        );
    }

    if (listingTargets.android) {
      const android = deriveAndroidLocale(draft);

      lines.push('    android');

      if (android.title != null)
        lines.push(previewLine('title', android.title, android.title.length, ANDROID_LIMITS.title));

      if (android.shortDescription != null)
        lines.push(
          previewLine(
            'short desc',
            android.shortDescription,
            android.shortDescription.length,
            ANDROID_LIMITS.shortDescription,
          ),
        );

      if (android.fullDescription != null)
        lines.push(
          previewLine(
            'full desc',
            android.fullDescription,
            android.fullDescription.length,
            ANDROID_LIMITS.fullDescription,
          ),
        );
    }

    for (const warning of warnings) lines.push(`    WARN ${warning}`);

    return lines.join('\n');
  }

  const localePreviews = listingDrafts.map(writeLocaleDraft);

  return ['listing draft (nothing is written until you confirm):', '', ...localePreviews].join(
    '\n',
  );
}
