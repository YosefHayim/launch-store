// Chooses the release type and the What's New text a store submission will write.

import { launchConfigForApp } from '../config/config.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { LaunchConfig } from '../types/config.ts';
import type { ReleaseConfig, ReleaseType } from '../types/store-surface.ts';

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

function readListingReleaseNotes(
  launchFile: LaunchConfig,
  app: Pick<AppDescriptor, 'bundleId' | 'packageName'>,
): Record<string, string> {
  const listings = launchFile.listing;

  if (listings == null) {
    return {};
  }

  let listingKey: string | null = null;

  if (app.bundleId != null) {
    listingKey = app.bundleId;
  }

  if (listingKey == null) {
    listingKey = app.packageName ?? null;
  }

  if (listingKey == null) {
    return {};
  }

  const storeListing = listings[listingKey];

  if (storeListing == null) {
    return {};
  }

  const appleListing = storeListing.apple;

  if (appleListing == null) {
    return {};
  }

  return readLocaleReleaseNotes(appleListing.info);
}

/** What's New for one app. Listing release notes override `release.releaseNotes` per locale. */
export async function resolveWhatsNew(
  launchFile: LaunchConfig,
  app: Pick<AppDescriptor, 'dir' | 'bundleId' | 'packageName'>,
): Promise<Record<string, string>> {
  const appLaunch = await launchConfigForApp(launchFile, app.dir);
  const release = appLaunch.release;
  let primaryLocale = 'en-US';

  if (release?.primaryLocale != null) {
    primaryLocale = release.primaryLocale;
  }

  const listingReleaseNotes = readListingReleaseNotes(appLaunch, app);

  return {
    ...resolveReleaseNotes(release, primaryLocale),
    ...listingReleaseNotes,
  };
}
