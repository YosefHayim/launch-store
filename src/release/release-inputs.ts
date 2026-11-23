import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../path-exists.ts';
import type { ReleaseConfig, ReleaseType } from '../types/store-surface.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

/** The per-run CLI flags that override the configured release type for a single `launch-store */
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

function readLocaleReleaseNotes(localeListings: unknown): Record<string, string> {
  const localeListingsObject = readPlainObject(localeListings);

  if (localeListingsObject == null) {
    return {};
  }

  const releaseNotesByLocale: Record<string, string> = {};

  for (const locale of Object.keys(localeListingsObject)) {
    const localeListing = localeListingsObject[locale];

    const localeListingObject = readPlainObject(localeListing);

    if (localeListingObject == null) {
      continue;
    }

    const releaseNotes = localeListingObject['releaseNotes'];

    if (typeof releaseNotes != 'string') {
      continue;
    }

    releaseNotesByLocale[locale] = releaseNotes;
  }

  return releaseNotesByLocale;
}

/** Per-locale `releaseNotes` from the app's `store.config.json` */
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

  const storeDocumentObject = readPlainObject(storeDocument);

  if (storeDocumentObject == null) {
    throw new Error(`Could not read store.config.json at ${configPath}`);
  }

  const appleListing = storeDocumentObject['apple'];

  const appleListingObject = readPlainObject(appleListing);

  if (appleListingObject == null) {
    return {};
  }

  return readLocaleReleaseNotes(appleListingObject['info']);
}

/** The "What's New" to write, merging both sources Launch supports */
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
