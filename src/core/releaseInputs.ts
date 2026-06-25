/**
 * Resolve the inputs a PUBLIC release needs from the three sources Launch reads: `launch.config.ts`
 * (`release.*`), the per-run CLI flags, and the app's `store.config.json` listing file. Two concerns live
 * here — the release **type/schedule** (immediate, after-approval, manual, or scheduled) and the per-locale
 * **"What's New"** notes — kept as pure functions (only {@link readStoreReleaseNotes} touches the
 * filesystem, reading the same listing file `launch sync` / `launch metadata` use). They feed
 * {@link import("./appStoreRelease.js").releaseApp} and are shared by `launch release` and the release
 * train, so both derive the same submission inputs from one place rather than each re-deriving them.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ReleaseConfig, ReleaseType } from "./types.js";
import { loadStoreConfig } from "./storeConfig.js";

/**
 * The per-run CLI flags that override the configured release type for a single `launch release`.
 * `--scheduled` and `--manual` are mutually exclusive overrides; absent, the configured default wins.
 */
interface ReleaseTypeOverrides {
  /** `--scheduled <iso>`: go live at this ISO-8601 instant (SCHEDULED). Takes precedence over `manual`. */
  scheduled?: string;
  /** `--manual`: hold the approved build for manual release (MANUAL). */
  manual?: boolean;
}

/** Resolve the per-run release type, with `--scheduled`/`--manual` overriding the config default. */
export function resolveReleaseType(
  release: ReleaseConfig | undefined,
  overrides: ReleaseTypeOverrides,
): { releaseType: ReleaseType; earliestReleaseDate?: string } {
  if (overrides.scheduled) return { releaseType: "SCHEDULED", earliestReleaseDate: overrides.scheduled };
  if (overrides.manual) return { releaseType: "MANUAL" };
  return {
    releaseType: release?.releaseType ?? "AFTER_APPROVAL",
    ...(release?.earliestReleaseDate ? { earliestReleaseDate: release.earliestReleaseDate } : {}),
  };
}

/** Normalize config release notes (a bare string targets the primary locale) into a per-locale map. */
export function resolveReleaseNotes(release: ReleaseConfig | undefined, primaryLocale: string): Record<string, string> {
  const notes = release?.releaseNotes;
  if (!notes) return {};
  return typeof notes === "string" ? { [primaryLocale]: notes } : notes;
}

/**
 * Per-locale `releaseNotes` from the app's `store.config.json` — the same listing file `launch sync`
 * and `launch metadata` read — or `{}` when the file is absent. A malformed file fails loudly via
 * {@link loadStoreConfig}, consistent with those commands (the developer fixes the typo once).
 */
export function readStoreReleaseNotes(appDir: string): Record<string, string> {
  const path = join(appDir, "store.config.json");
  if (!existsSync(path)) return {};
  const info = loadStoreConfig(path).apple?.info ?? {};
  const notes: Record<string, string> = {};
  for (const [locale, localeInfo] of Object.entries(info)) {
    if (localeInfo.releaseNotes) notes[locale] = localeInfo.releaseNotes;
  }
  return notes;
}

/**
 * The "What's New" to write, merging both sources Launch supports: `release.releaseNotes` from
 * `launch.config.ts` as the base, with `store.config.json`'s per-locale `releaseNotes` taking precedence
 * (it's the richer, per-locale, EAS-compatible listing file). Empty leaves the version's notes untouched.
 */
export function resolveWhatsNew(release: ReleaseConfig | undefined, appDir: string): Record<string, string> {
  return { ...resolveReleaseNotes(release, release?.primaryLocale ?? "en-US"), ...readStoreReleaseNotes(appDir) };
}
