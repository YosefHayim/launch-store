import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import type { ReleaseConfig, ReleaseType } from '../types/storeSurface.js';
import { loadStoreConfig } from '../store/storeConfig.js';
/**
 * The per-run CLI flags that override the configured release type for a single `launch release`.
 * `--scheduled` and `--manual` are mutually exclusive overrides; absent, the configured default wins.
 */
type ReleaseTypeOverrides = {
  scheduled?: string;
  manual?: boolean;
};
/** Resolve the per-run release type, with `--scheduled`/`--manual` overriding the config default. */
export const resolveReleaseType = (
  release: ReleaseConfig | undefined,
  overrides: ReleaseTypeOverrides,
): {
  releaseType: ReleaseType;
  earliestReleaseDate?: string;
} => {
  if (overrides.scheduled)
    return { releaseType: 'SCHEDULED', earliestReleaseDate: overrides.scheduled };
  if (overrides.manual) return { releaseType: 'MANUAL' };
  let releaseType: ReleaseType = 'AFTER_APPROVAL';
  if (release?.releaseType !== undefined) releaseType = release.releaseType;
  const releaseChoice: { releaseType: ReleaseType; earliestReleaseDate?: string } = {
    releaseType,
  };
  if (release?.earliestReleaseDate !== undefined) {
    releaseChoice.earliestReleaseDate = release.earliestReleaseDate;
  }
  return releaseChoice;
};
/** Normalize config release notes (a bare string targets the primary locale) into a per-locale map. */
export const resolveReleaseNotes = (
  release: ReleaseConfig | undefined,
  primaryLocale: string,
): Record<string, string> => {
  const notes = release?.releaseNotes;
  if (!notes) return {};
  if (typeof notes === 'string') return { [primaryLocale]: notes };
  return notes;
};
/**
 * Per-locale `releaseNotes` from the app's `store.config.json` - the same listing file `launch sync`
 * and `launch metadata` read - or `{}` when the file is absent. A malformed file fails loudly via
 * {@link loadStoreConfig}, consistent with those commands (the developer fixes the typo once).
 */
export const readStoreReleaseNotes = (
  appDirectory: string,
): Effect.Effect<Record<string, string>, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const configPath = pathService.join(appDirectory, 'store.config.json');
    if (!(yield* fileSystem.exists(configPath))) return {};
    const storeConfig = yield* loadStoreConfig(configPath);
    const localeListings = storeConfig.apple?.info;
    if (localeListings === undefined) return {};
    const releaseNotesByLocale: Record<string, string> = {};
    for (const [locale, localeListing] of Object.entries(localeListings)) {
      if (localeListing.releaseNotes !== undefined) {
        releaseNotesByLocale[locale] = localeListing.releaseNotes;
      }
    }
    return releaseNotesByLocale;
  });
/**
 * The "What's New" to write, merging both sources Launch supports: `release.releaseNotes` from
 * `launch.config.ts` as the base, with `store.config.json`'s per-locale `releaseNotes` taking precedence
 * (it's the richer, per-locale, EAS-compatible listing file). Empty leaves the version's notes untouched.
 */
export const resolveWhatsNew = (
  release: ReleaseConfig | undefined,
  appDirectory: string,
): Effect.Effect<Record<string, string>, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    let primaryLocale = 'en-US';
    if (release?.primaryLocale !== undefined) primaryLocale = release.primaryLocale;
    const storeReleaseNotes = yield* readStoreReleaseNotes(appDirectory);
    return {
      ...resolveReleaseNotes(release, primaryLocale),
      ...storeReleaseNotes,
    };
  });
