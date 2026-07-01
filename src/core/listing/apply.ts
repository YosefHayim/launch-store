/**
 * Pure helpers that turn a generated {@link DraftListing} into something safe to write: clamp it to the
 * stores' length limits, build the per-locale {@link ListingBrief} a generator consumes, fold a draft
 * into a {@link StoreConfig} immutably, derive the Play fields from the App Store superset, and render a
 * review preview. No I/O and no network — the command (`cli/commands/aiListing.ts`) does the side
 * effects; everything decision-shaped lives here so it's unit-testable without a model.
 */

import type { AndroidLocaleInfo, AppleLocaleInfo, StoreConfig } from '../storeConfig.js';
import type { DraftListing, ListingBrief, LocaleDraft } from '../types.js';

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
function clampText(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max).trimEnd();
}

/** The comma-joined serialization Apple counts against the 100-char keyword limit. */
export function serializeKeywords(keywords: string[]): string {
  return keywords.join(', ');
}

/** Keep keywords from the front until adding the next would overflow the joined-string limit. */
function clampKeywords(keywords: string[], max: number): string[] {
  const kept: string[] = [];
  for (const keyword of keywords) {
    if (serializeKeywords([...kept, keyword]).length > max) break;
    kept.push(keyword);
  }
  return kept;
}

/**
 * Clamp every field of a draft to its App Store limit, returning the safe draft plus a warning per
 * field that had to be trimmed. A generator is asked to respect the limits, but this is the guarantee:
 * nothing over-length ever reaches the config, and the user sees exactly what was cut in the preview.
 */
export function clampDraft(draft: DraftListing): { draft: DraftListing; warnings: string[] } {
  const warnings: string[] = [];
  const clamped: DraftListing = {};

  /** Clamp one optional text field, recording a warning when it was over the limit. */
  const fit = (value: string | undefined, max: number, label: string): string | undefined => {
    if (value === undefined) return undefined;
    if (value.length > max) {
      warnings.push(`${label} was ${value.length} chars; trimmed to the ${max}-char limit.`);
      return clampText(value, max);
    }
    return value;
  };

  const title = fit(draft.title, APPLE_LIMITS.title, 'title');
  if (title !== undefined) clamped.title = title;
  const subtitle = fit(draft.subtitle, APPLE_LIMITS.subtitle, 'subtitle');
  if (subtitle !== undefined) clamped.subtitle = subtitle;
  const promotionalText = fit(
    draft.promotionalText,
    APPLE_LIMITS.promotionalText,
    'promotional text',
  );
  if (promotionalText !== undefined) clamped.promotionalText = promotionalText;
  const description = fit(draft.description, APPLE_LIMITS.description, 'description');
  if (description !== undefined) clamped.description = description;

  if (draft.keywords !== undefined) {
    const kept = clampKeywords(draft.keywords, APPLE_LIMITS.keywords);
    if (kept.length < draft.keywords.length) {
      warnings.push(
        `keywords exceeded the ${APPLE_LIMITS.keywords}-char limit; kept ${kept.length} of ${draft.keywords.length}.`,
      );
    }
    if (kept.length > 0) clamped.keywords = kept;
  }

  return { draft: clamped, warnings };
}

/**
 * Build the brief for one locale. The creative seed is `aboutOverride` (a `--about` flag) when given,
 * else the locale's existing promotional text or subtitle — so by default the model refines what's
 * already there rather than inventing from nothing. Existing keywords and the whole current listing are
 * passed through for the same reason.
 */
export function briefFor(
  locale: string,
  appName: string,
  current: AppleLocaleInfo | undefined,
  aboutOverride: string | undefined,
): ListingBrief {
  const brief: ListingBrief = { locale, appName };
  const about = aboutOverride ?? current?.promotionalText ?? current?.subtitle;
  if (about) brief.about = about;
  if (current?.keywords && current.keywords.length > 0) brief.keywords = current.keywords;
  if (current) brief.current = current;
  return brief;
}

/**
 * Derive a Play listing from the App Store draft: the Play short description has no Apple twin, so it
 * borrows the subtitle (falling back to the promotional text), clamped to Play's tighter limit. Title
 * and full description map straight across. Returns only the fields the draft actually supplies.
 */
export function deriveAndroidLocale(draft: DraftListing): AndroidLocaleInfo {
  const info: AndroidLocaleInfo = {};
  if (draft.title !== undefined) info.title = clampText(draft.title, ANDROID_LIMITS.title);
  const short = draft.subtitle ?? draft.promotionalText;
  if (short !== undefined)
    info.shortDescription = clampText(short, ANDROID_LIMITS.shortDescription);
  if (draft.description !== undefined)
    info.fullDescription = clampText(draft.description, ANDROID_LIMITS.fullDescription);
  return info;
}

/**
 * Fold a draft into a config for one locale, immutably: spread the draft over the locale's existing
 * fields (so untouched fields and other locales survive), per targeted platform. The App Store fields
 * map 1:1; the Play fields are derived via {@link deriveAndroidLocale}. Returns a new config.
 */
export function applyDraft(
  config: StoreConfig,
  locale: string,
  draft: DraftListing,
  targets: { ios: boolean; android: boolean },
): StoreConfig {
  const next: StoreConfig = { ...config };

  if (targets.ios) {
    const apple = config.apple ?? { info: {} };
    next.apple = {
      ...apple,
      info: { ...apple.info, [locale]: { ...apple.info[locale], ...draft } },
    };
  }
  if (targets.android) {
    const android = config.android ?? { info: {} };
    next.android = {
      ...android,
      info: {
        ...android.info,
        [locale]: { ...android.info[locale], ...deriveAndroidLocale(draft) },
      },
    };
  }
  return next;
}

/** Collapse a long field to a single trimmed line for the preview, with an ellipsis when cut. */
function previewValue(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

/** One aligned `  label   value   (len/limit)` preview row. */
function row(label: string, value: string, used: number, limit: number): string {
  return `    ${label.padEnd(13)} ${previewValue(value)}  (${used}/${limit})`;
}

/**
 * Render the drafts for confirmation: per locale, the App Store fields (and, when Android is targeted,
 * the derived Play fields), each with its character budget, followed by any clamp warnings. This is the
 * "review" half of the plan→confirm→apply loop — what the user reads before agreeing to write.
 */
export function renderDraftPreview(
  drafts: LocaleDraft[],
  targets: { ios: boolean; android: boolean },
): string {
  const blocks = drafts.map(({ locale, draft, warnings }) => {
    const lines = [`  ${locale}`];
    if (targets.ios) {
      if (draft.title !== undefined)
        lines.push(row('title', draft.title, draft.title.length, APPLE_LIMITS.title));
      if (draft.subtitle !== undefined)
        lines.push(row('subtitle', draft.subtitle, draft.subtitle.length, APPLE_LIMITS.subtitle));
      if (draft.keywords !== undefined) {
        const joined = serializeKeywords(draft.keywords);
        lines.push(row('keywords', joined, joined.length, APPLE_LIMITS.keywords));
      }
      if (draft.promotionalText !== undefined)
        lines.push(
          row(
            'promo text',
            draft.promotionalText,
            draft.promotionalText.length,
            APPLE_LIMITS.promotionalText,
          ),
        );
      if (draft.description !== undefined)
        lines.push(
          row('description', draft.description, draft.description.length, APPLE_LIMITS.description),
        );
    }
    if (targets.android) {
      const android = deriveAndroidLocale(draft);
      lines.push('    android');
      if (android.title !== undefined)
        lines.push(row('title', android.title, android.title.length, ANDROID_LIMITS.title));
      if (android.shortDescription !== undefined)
        lines.push(
          row(
            'short desc',
            android.shortDescription,
            android.shortDescription.length,
            ANDROID_LIMITS.shortDescription,
          ),
        );
      if (android.fullDescription !== undefined)
        lines.push(
          row(
            'full desc',
            android.fullDescription,
            android.fullDescription.length,
            ANDROID_LIMITS.fullDescription,
          ),
        );
    }
    for (const warning of warnings) lines.push(`    ▲ ${warning}`);
    return lines.join('\n');
  });

  return ['listing draft (nothing is written until you confirm):', '', ...blocks].join('\n');
}
