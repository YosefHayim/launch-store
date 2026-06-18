/**
 * Types for `launch ai listing` — AI-authored App Store / Play listing copy. These describe the
 * *generation seam and its inputs/outputs*, not a store shape (the listing config shape itself lives in
 * `core/storeConfig.ts`), so they sit here beside the generator and applier.
 *
 * The whole feature is made safe by an existing invariant, not a new one: a generated draft is only ever
 * written to the local `store.config.json`. Nothing reaches a store until the user reviews the diff with
 * `launch plan` and applies it with `launch sync` — exactly the plan → confirm → sync loop every other
 * config-as-code surface flows through. {@link ListingGenerator} is the swappable seam (Anthropic by
 * default), so the copy source is pluggable without touching the command.
 */

import type { AppleLocaleInfo } from "../storeConfig.js";

/**
 * Everything a generator needs to draft one locale's listing. Seeded from the app's own config so the
 * model refines what's there rather than inventing from nothing: `about` and `keywords` carry the
 * existing pitch/keywords (or a `--about` override), and `current` is the locale's existing listing.
 */
export interface ListingBrief {
  /** Apple/Play locale this draft targets, e.g. `en-US`. */
  locale: string;
  /** The app's display name, used verbatim in the prompt (never invented). */
  appName: string;
  /** A short description of what the app does — the creative seed. Absent when nothing seeds it. */
  about?: string;
  /** Existing keywords/themes to weave in. */
  keywords?: string[];
  /** The locale's current listing, so a generator can improve rather than overwrite blindly. */
  current?: AppleLocaleInfo;
}

/**
 * A drafted listing for one locale — the App Store copy fields a generator produces. This is the
 * superset; the Play (`android`) fields are derived from it when the user targets Android. Every field
 * is optional so a generator (or a length clamp) can omit what it can't produce within store limits.
 */
export interface DraftListing {
  /** App name shown on the product page (≤30 chars). */
  title?: string;
  /** One-line subtitle under the title (≤30 chars). */
  subtitle?: string;
  /** Full marketing description (≤4000 chars). */
  description?: string;
  /** Search keywords; serialized comma-joined, ≤100 chars total. */
  keywords?: string[];
  /** Short promotional blurb, updatable without a new build (≤170 chars). */
  promotionalText?: string;
}

/**
 * The generation seam: turn a {@link ListingBrief} into a {@link DraftListing}. Implemented by the
 * default Anthropic-backed generator and trivially by a test fake, so the command and the applier are
 * testable without a network. `name` is a stable label for logs/UX (e.g. `anthropic`, `fake`).
 */
export interface ListingGenerator {
  /** Stable identifier for the backing model/provider, shown in logs. */
  readonly name: string;
  /** Draft one locale's listing for the given brief. Throws on an unusable response. */
  generate(brief: ListingBrief): Promise<DraftListing>;
}

/**
 * One locale's generated-and-clamped draft, ready to preview and (on confirmation) apply. `warnings`
 * records what the length clamp had to trim, so the user sees it in the preview before anything is
 * written. Produced by the command, consumed by `renderDraftPreview` and `applyDraft`.
 */
export interface LocaleDraft {
  /** The locale this draft targets. */
  locale: string;
  /** The draft after clamping to store limits. */
  draft: DraftListing;
  /** Human-readable notes about any fields the clamp trimmed. Empty when nothing was trimmed. */
  warnings: string[];
}
