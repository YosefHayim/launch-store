import type { AndroidLocaleInfo, AppleLocaleInfo, StoreConfig } from '../store/storeConfig.js';
import type { DraftListing, ListingBrief, LocaleDraft } from '../types/listing.js';
import type { MutableDeep } from '../types/mutable.js';
/**
 * App Store field limits, in characters. `keywords` is the limit on the *comma-joined* string (Apple
 * counts the serialized field, and `storeConfig` joins with `", "`), not the count of keywords.
 */
export const APPLE_LIMITS = {
  title: 30,
  subtitle: 30,
  keywords: 100,
  promotionalText: 170,
  description: 4000,
} as const;
/** Play Store field limits, in characters. The short description is far tighter than Apple's subtitle. */
export const ANDROID_LIMITS = {
  title: 30,
  shortDescription: 80,
  fullDescription: 4000,
} as const;
/** Hard-truncate to `max`, trimming a trailing partial word's whitespace so the cut reads cleanly. */
const clampText = (listingText: string, maxCharacters: number): string => {
  if (listingText.length <= maxCharacters) return listingText;
  return listingText.slice(0, maxCharacters).trimEnd();
};
/** The comma-joined serialization Apple counts against the 100-char keyword limit. */
export const serializeKeywords = (keywords: readonly string[]): string => {
  return keywords.join(', ');
};
/** Keep keywords from the front until adding the next would overflow the joined-string limit. */
const clampKeywords = (keywords: readonly string[], maxCharacters: number): string[] => {
  const keptKeywords: string[] = [];
  for (const keyword of keywords) {
    if (serializeKeywords([...keptKeywords, keyword]).length > maxCharacters) break;
    keptKeywords.push(keyword);
  }
  return keptKeywords;
};
/**
 * Clamp every field of a draft to its App Store limit, returning the safe draft plus a warning per
 * field that had to be trimmed. A generator is asked to respect the limits, but this is the guarantee:
 * nothing over-length ever reaches the config, and the user sees exactly what was cut in the preview.
 */
export const clampDraft = (
  listingDraft: DraftListing,
): {
  draft: DraftListing;
  warnings: string[];
} => {
  const warningMessages: string[] = [];
  const clampedDraft: MutableDeep<DraftListing> = {};
  /** Clamp one optional text field, recording a warning when it was over the limit. */
  const fitText = (
    listingText: string | undefined,
    maxCharacters: number,
    fieldLabel: string,
  ): string | undefined => {
    if (listingText === undefined) return undefined;
    if (listingText.length > maxCharacters) {
      warningMessages.push(
        `${fieldLabel} was ${listingText.length} chars; trimmed to the ${maxCharacters}-char limit.`,
      );
      return clampText(listingText, maxCharacters);
    }
    return listingText;
  };
  const title = fitText(listingDraft.title, APPLE_LIMITS.title, 'title');
  if (title !== undefined) clampedDraft.title = title;
  const subtitle = fitText(listingDraft.subtitle, APPLE_LIMITS.subtitle, 'subtitle');
  if (subtitle !== undefined) clampedDraft.subtitle = subtitle;
  const promotionalText = fitText(
    listingDraft.promotionalText,
    APPLE_LIMITS.promotionalText,
    'promotional text',
  );
  if (promotionalText !== undefined) clampedDraft.promotionalText = promotionalText;
  const description = fitText(listingDraft.description, APPLE_LIMITS.description, 'description');
  if (description !== undefined) clampedDraft.description = description;
  if (listingDraft.keywords !== undefined) {
    const keptKeywords = clampKeywords(listingDraft.keywords, APPLE_LIMITS.keywords);
    if (keptKeywords.length < listingDraft.keywords.length) {
      warningMessages.push(
        `keywords exceeded the ${APPLE_LIMITS.keywords}-char limit; kept ${keptKeywords.length} of ${listingDraft.keywords.length}.`,
      );
    }
    if (keptKeywords.length > 0) clampedDraft.keywords = keptKeywords;
  }
  return { draft: clampedDraft, warnings: warningMessages };
};
/**
 * Build the brief for one locale. The creative seed is `aboutOverride` (a `--about` flag) when given,
 * else the locale's existing promotional text or subtitle - so by default the model refines what's
 * already there rather than inventing from nothing. Existing keywords and the whole current listing are
 * passed through for the same reason.
 */
export const briefFor = (
  localeName: string,
  displayName: string,
  currentListing: AppleLocaleInfo | undefined,
  aboutOverride: string | undefined,
): ListingBrief => {
  const listingBrief: MutableDeep<ListingBrief> = { locale: localeName, appName: displayName };
  let aboutText = aboutOverride;
  if (aboutText === undefined && currentListing !== undefined)
    aboutText = currentListing.promotionalText;
  if (aboutText === undefined && currentListing !== undefined) aboutText = currentListing.subtitle;
  if (aboutText !== undefined && aboutText.length > 0) listingBrief.about = aboutText;
  if (currentListing?.keywords !== undefined && currentListing.keywords.length > 0)
    listingBrief.keywords = currentListing.keywords;
  if (currentListing !== undefined) listingBrief.current = currentListing;
  return listingBrief;
};
/**
 * Derive a Play listing from the App Store draft: the Play short description has no Apple twin, so it
 * borrows the subtitle (falling back to the promotional text), clamped to Play's tighter limit. Title
 * and full description map straight across. Returns only the fields the draft actually supplies.
 */
export const deriveAndroidLocale = (listingDraft: DraftListing): AndroidLocaleInfo => {
  const androidListing: AndroidLocaleInfo = {};
  if (listingDraft.title !== undefined)
    androidListing.title = clampText(listingDraft.title, ANDROID_LIMITS.title);
  let shortDescription = listingDraft.subtitle;
  if (shortDescription === undefined) shortDescription = listingDraft.promotionalText;
  if (shortDescription !== undefined) {
    androidListing.shortDescription = clampText(shortDescription, ANDROID_LIMITS.shortDescription);
  }
  if (listingDraft.description !== undefined)
    androidListing.fullDescription = clampText(
      listingDraft.description,
      ANDROID_LIMITS.fullDescription,
    );
  return androidListing;
};
/**
 * Fold a draft into a config for one locale, immutably: spread the draft over the locale's existing
 * fields (so untouched fields and other locales survive), per targeted platform. The App Store fields
 * map 1:1; the Play fields are derived via {@link deriveAndroidLocale}. Returns a new config.
 */
/** Merge a draft over one locale's existing App Store listing, copying keywords into a mutable array. */
const mergeAppleLocale = (
  existingLocale: AppleLocaleInfo | undefined,
  listingDraft: DraftListing,
): AppleLocaleInfo => {
  const mergedLocale: MutableDeep<AppleLocaleInfo> = {};
  if (existingLocale !== undefined) {
    if (existingLocale.title !== undefined) mergedLocale.title = existingLocale.title;
    if (existingLocale.subtitle !== undefined) mergedLocale.subtitle = existingLocale.subtitle;
    if (existingLocale.description !== undefined)
      mergedLocale.description = existingLocale.description;
    if (existingLocale.keywords !== undefined) mergedLocale.keywords = [...existingLocale.keywords];
    if (existingLocale.releaseNotes !== undefined)
      mergedLocale.releaseNotes = existingLocale.releaseNotes;
    if (existingLocale.promotionalText !== undefined)
      mergedLocale.promotionalText = existingLocale.promotionalText;
    if (existingLocale.marketingUrl !== undefined)
      mergedLocale.marketingUrl = existingLocale.marketingUrl;
    if (existingLocale.supportUrl !== undefined)
      mergedLocale.supportUrl = existingLocale.supportUrl;
    if (existingLocale.privacyPolicyUrl !== undefined)
      mergedLocale.privacyPolicyUrl = existingLocale.privacyPolicyUrl;
  }
  if (listingDraft.title !== undefined) mergedLocale.title = listingDraft.title;
  if (listingDraft.subtitle !== undefined) mergedLocale.subtitle = listingDraft.subtitle;
  if (listingDraft.description !== undefined) mergedLocale.description = listingDraft.description;
  if (listingDraft.promotionalText !== undefined)
    mergedLocale.promotionalText = listingDraft.promotionalText;
  if (listingDraft.keywords !== undefined) mergedLocale.keywords = [...listingDraft.keywords];
  return mergedLocale;
};

export const applyDraft = (
  storeConfiguration: StoreConfig,
  localeName: string,
  listingDraft: DraftListing,
  listingTargets: {
    ios: boolean;
    android: boolean;
  },
): StoreConfig => {
  const updatedStoreConfiguration: StoreConfig = { ...storeConfiguration };
  if (listingTargets.ios) {
    let appleListing = storeConfiguration.apple;
    if (appleListing === undefined) appleListing = { info: {} };
    const localeInfo: Record<string, AppleLocaleInfo> = { ...appleListing.info };
    localeInfo[localeName] = mergeAppleLocale(appleListing.info[localeName], listingDraft);
    updatedStoreConfiguration.apple = {
      ...appleListing,
      info: localeInfo,
    };
  }
  if (listingTargets.android) {
    let androidListing = storeConfiguration.android;
    if (androidListing === undefined) androidListing = { info: {} };
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
};
/** Collapse a long field to a single trimmed line for the preview, with an ellipsis when cut. */
const previewText = (listingText: string): string => {
  const singleLineText = listingText.replace(/\s+/g, ' ').trim();
  if (singleLineText.length > 60) return `${singleLineText.slice(0, 57)}...`;
  return singleLineText;
};
/** Format one aligned preview line with its character budget. */
const previewLine = (
  fieldLabel: string,
  listingText: string,
  usedCharacters: number,
  characterLimit: number,
): string => {
  return `    ${fieldLabel.padEnd(13)} ${previewText(listingText)}  (${usedCharacters}/${characterLimit})`;
};
/**
 * Render the drafts for confirmation: per locale, the App Store fields (and, when Android is targeted,
 * the derived Play fields), each with its character budget, followed by any clamp warnings. This is the
 * "review" half of the plan->confirm->apply loop - what the user reads before agreeing to write.
 */
export const renderDraftPreview = (
  listingDrafts: LocaleDraft[],
  listingTargets: {
    ios: boolean;
    android: boolean;
  },
): string => {
  const localePreviews = listingDrafts.map(({ locale, draft, warnings }) => {
    const lines = [`  ${locale}`];
    if (listingTargets.ios) {
      if (draft.title !== undefined)
        lines.push(previewLine('title', draft.title, draft.title.length, APPLE_LIMITS.title));
      if (draft.subtitle !== undefined)
        lines.push(
          previewLine('subtitle', draft.subtitle, draft.subtitle.length, APPLE_LIMITS.subtitle),
        );
      if (draft.keywords !== undefined) {
        const joined = serializeKeywords(draft.keywords);
        lines.push(previewLine('keywords', joined, joined.length, APPLE_LIMITS.keywords));
      }
      if (draft.promotionalText !== undefined)
        lines.push(
          previewLine(
            'promo text',
            draft.promotionalText,
            draft.promotionalText.length,
            APPLE_LIMITS.promotionalText,
          ),
        );
      if (draft.description !== undefined)
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
      if (android.title !== undefined)
        lines.push(previewLine('title', android.title, android.title.length, ANDROID_LIMITS.title));
      if (android.shortDescription !== undefined)
        lines.push(
          previewLine(
            'short desc',
            android.shortDescription,
            android.shortDescription.length,
            ANDROID_LIMITS.shortDescription,
          ),
        );
      if (android.fullDescription !== undefined)
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
  });
  return ['listing draft (nothing is written until you confirm):', '', ...localePreviews].join(
    '\n',
  );
};
