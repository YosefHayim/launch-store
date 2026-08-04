import type { Effect } from 'effect';
import type { AppleLocaleInfo } from '../store/storeConfig.js';
/**
 * Everything a generator needs to draft one locale's listing. Seeded from the app's own config so the
 * model refines what's there rather than inventing from nothing: `about` and `keywords` carry the
 * existing pitch/keywords (or a `--about` override), and `current` is the locale's existing listing.
 */
export type ListingBrief = Readonly<{
  locale: string;
  appName: string;
  about?: string;
  keywords?: readonly string[];
  current?: AppleLocaleInfo;
}>;
/**
 * A drafted listing for one locale - the App Store copy fields a generator produces. This is the
 * superset; the Play (`android`) fields are derived from it when the user targets Android. Every field
 * is optional so a generator (or a length clamp) can omit what it can't produce within store limits.
 */
export type DraftListing = Readonly<{
  title?: string;
  subtitle?: string;
  description?: string;
  keywords?: readonly string[];
  promotionalText?: string;
}>;
/**
 * The generation seam: turn a {@link ListingBrief} into a {@link DraftListing}. Implemented by the
 * default Anthropic-backed generator and trivially by a test fake, so the command and the applier are
 * testable without a network. `name` is a stable label for logs/UX (e.g. `anthropic`, `fake`).
 */
export type ListingGenerator<Requirements = never> = {
  readonly name: string;
  generate(brief: ListingBrief): Effect.Effect<DraftListing, unknown, Requirements>;
};
/**
 * One locale's generated-and-clamped draft, ready to preview and (on confirmation) apply. `warnings`
 * records what the length clamp had to trim, so the user sees it in the preview before anything is
 * written. Produced by the command, consumed by `renderDraftPreview` and `applyDraft`.
 */
export type LocaleDraft = Readonly<{
  locale: string;
  draft: DraftListing;
  warnings: readonly string[];
}>;
