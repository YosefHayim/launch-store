import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../path-exists.ts';
import type { ReleaseConfig, ReleaseType } from '../types/storeSurface.ts';

/**
 * The per-run CLI flags that override the configured release type for a single `launch release`.
 * `--scheduled` and `--manual` are mutually exclusive overrides; absent, the configured default wins.
 */
type ReleaseTypeOverrides = {
  scheduled?: string;
  manual?: boolean;
};

function readScheduledInstant(scheduled: string | undefined): string | null {
  if (scheduled == null) {
    return null;
  }

  if (scheduled == '') {
    return null;
  }

  return scheduled;
}

/** Resolve the per-run release type, with `--scheduled`/`--manual` overriding the config default. */
export function resolveReleaseType(
  release: ReleaseConfig | undefined,
  overrides: ReleaseTypeOverrides,
): {
  releaseType: ReleaseType;
  earliestReleaseDate?: string;
} {
  const scheduledInstant = readScheduledInstant(overrides.scheduled);

  if (scheduledInstant != null) {
    return { releaseType: 'SCHEDULED', earliestReleaseDate: scheduledInstant };
  }

  if (overrides.manual) {
    return { releaseType: 'MANUAL' };
  }

  let releaseType: ReleaseType = 'AFTER_APPROVAL';

  if (release?.releaseType != null) {
    releaseType = release.releaseType;
  }

  const releaseChoice: { releaseType: ReleaseType; earliestReleaseDate?: string } = {
    releaseType,
  };

  if (release?.earliestReleaseDate != null) {
    releaseChoice.earliestReleaseDate = release.earliestReleaseDate;
  }

  return releaseChoice;
}

/** Normalize config release notes (a bare string targets the primary locale) into a per-locale map. */
export function resolveReleaseNotes(
  release: ReleaseConfig | undefined,
  primaryLocale: string,
): Record<string, string> {
  const notes = release?.releaseNotes;
  const hasNotes = notes != null;

  if (hasNotes == false) {
    return {};
  }

  if (typeof notes == 'string') {
    const isBlank = notes == '';

    if (isBlank) {
      return {};
    }

    return { [primaryLocale]: notes };
  }

  return notes;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (typeof candidate != 'object') {
    return false;
  }

  return candidate != null;
}

function readLocaleReleaseNotes(localeListings: unknown): Record<string, string> {
  if (isRecord(localeListings) == false) {
    return {};
  }

  const releaseNotesByLocale: Record<string, string> = {};

  for (const locale of Object.keys(localeListings)) {
    const localeListing = localeListings[locale];

    if (isRecord(localeListing) == false) {
      continue;
    }

    const releaseNotes = localeListing['releaseNotes'];

    if (typeof releaseNotes != 'string') {
      continue;
    }

    releaseNotesByLocale[locale] = releaseNotes;
  }

  return releaseNotesByLocale;
}

/**
 * Per-locale `releaseNotes` from the app's `store.config.json` - the same listing file `launch sync`
 * and `launch metadata` read - or `{}` when the file is absent. A malformed file fails loudly, the
 * same way those commands do (the developer fixes the typo once).
 */
export async function readStoreReleaseNotes(appDirectory: string): Promise<Record<string, string>> {
  const configPath = join(appDirectory, 'store.config.json');
  const isConfigPresent = await pathExists(configPath);

  if (isConfigPresent == false) {
    return {};
  }

  try {
    var configText = await readFile(configPath, 'utf8');
    var storeDocument: unknown = JSON.parse(configText);
  } catch (error) {
    throw new Error(`Could not read store.config.json at ${configPath}`, { cause: error });
  }

  if (isRecord(storeDocument) == false) {
    throw new Error(`Could not read store.config.json at ${configPath}`);
  }

  const appleListing = storeDocument['apple'];

  if (isRecord(appleListing) == false) {
    return {};
  }

  return readLocaleReleaseNotes(appleListing['info']);
}

/**
 * The "What's New" to write, merging both sources Launch supports: `release.releaseNotes` from
 * `launch.config.ts` as the base, with `store.config.json`'s per-locale `releaseNotes` taking precedence
 * (it's the richer, per-locale, EAS-compatible listing file). Empty leaves the version's notes untouched.
 */
export async function resolveWhatsNew(
  release: ReleaseConfig | undefined,
  appDirectory: string,
): Promise<Record<string, string>> {
  let primaryLocale = 'en-US';

  if (release?.primaryLocale != null) {
    primaryLocale = release.primaryLocale;
  }

  const storeReleaseNotes = await readStoreReleaseNotes(appDirectory);

  return {
    ...resolveReleaseNotes(release, primaryLocale),
    ...storeReleaseNotes,
  };
}
