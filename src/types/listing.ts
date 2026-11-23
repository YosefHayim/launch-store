import type { AppleLocaleInfo } from '../store/shared/store-config.ts';

/** Everything a generator needs to draft one locale's listing. */
export type ListingBrief = Readonly<{
  locale: string;
  appName: string;
  about?: string;
  keywords?: readonly string[];
  current?: AppleLocaleInfo;
}>;

/** A drafted listing for one locale - the App Store copy fields a generator produces. */
export type DraftListing = Readonly<{
  title?: string;
  subtitle?: string;
  description?: string;
  keywords?: readonly string[];
  promotionalText?: string;
}>;

/** One locale's generated-and-clamped draft, ready to preview and (on confirmation) apply. */
export type LocaleDraft = Readonly<{
  locale: string;
  draft: DraftListing;
  warnings: readonly string[];
}>;
