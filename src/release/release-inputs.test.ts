import { describe, expect, it } from 'vitest';
import type { LaunchConfig } from '../types/config.ts';
import { resolveReleaseNotes, resolveReleaseType, resolveWhatsNew } from './release-inputs.ts';

function launchFile(
  listing?: LaunchConfig['listing'],
  release?: LaunchConfig['release'],
): LaunchConfig {
  const launchConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };
  let withSections = launchConfig;

  if (release != null) {
    withSections = { ...withSections, release };
  }

  if (listing != null) {
    withSections = { ...withSections, listing };
  }

  return withSections;
}

const releaseApp = { dir: '/no/such/app', bundleId: 'com.acme.app' };

function describeResolveReleaseTypeCLIFlagsOverrideTheConfiguredDefault() {
  function defaultsToAFTERAPPROVALWithNoPieceAndNoOverrides() {
    const releaseType = resolveReleaseType(undefined, {});
    expect(releaseType).toEqual({ releaseType: 'AFTER_APPROVAL' });
  }

  it(
    'defaults to AFTER_APPROVAL with no config and no overrides',
    defaultsToAFTERAPPROVALWithNoPieceAndNoOverrides,
  );

  function passesTheConfiguredReleaseTypeAndEarliestReleaseDateThrough() {
    expect(
      resolveReleaseType(
        { releaseType: 'SCHEDULED', earliestReleaseDate: '2026-07-01T00:00:00Z' },
        {},
      ),
    ).toEqual({
      releaseType: 'SCHEDULED',
      earliestReleaseDate: '2026-07-01T00:00:00Z',
    });
  }

  it(
    'passes the configured releaseType and earliestReleaseDate through',
    passesTheConfiguredReleaseTypeAndEarliestReleaseDateThrough,
  );

  function scheduledForcesSCHEDULEDAtTheGivenInstant() {
    const releaseType = resolveReleaseType(undefined, { scheduled: '2026-08-01T12:00:00Z' });

    expect(releaseType).toEqual({
      releaseType: 'SCHEDULED',
      earliestReleaseDate: '2026-08-01T12:00:00Z',
    });
  }

  it(
    '--scheduled forces SCHEDULED at the given instant',
    scheduledForcesSCHEDULEDAtTheGivenInstant,
  );

  function manualForcesMANUAL() {
    expect(resolveReleaseType({ releaseType: 'AFTER_APPROVAL' }, { manual: true })).toEqual({
      releaseType: 'MANUAL',
    });
  }

  it('--manual forces MANUAL', manualForcesMANUAL);

  function scheduledBeatsManualWhenBothAreSet() {
    const releaseType = resolveReleaseType(undefined, {
      scheduled: '2026-08-01T12:00:00Z',
      manual: true,
    });

    expect(releaseType).toEqual({
      releaseType: 'SCHEDULED',
      earliestReleaseDate: '2026-08-01T12:00:00Z',
    });
  }

  it('--scheduled beats --manual when both are set', scheduledBeatsManualWhenBothAreSet);
}

describe(
  'resolveReleaseType - CLI flags override the configured default',
  describeResolveReleaseTypeCLIFlagsOverrideTheConfiguredDefault,
);

function describeResolveReleaseNotesPieceNotesPerLocaleMap() {
  function returnsWhenNoNotesAreConfigured() {
    const releaseNotes = resolveReleaseNotes(undefined, 'en-US');
    expect(releaseNotes).toEqual({});
  }

  it('returns {} when no notes are configured', returnsWhenNoNotesAreConfigured);

  function targetsThePrimaryLocaleForABareString() {
    expect(resolveReleaseNotes({ releaseNotes: 'Bug fixes.' }, 'en-GB')).toEqual({
      'en-GB': 'Bug fixes.',
    });
  }

  it('targets the primary locale for a bare string', targetsThePrimaryLocaleForABareString);

  function passesAPerLocaleMapThroughUnchanged() {
    const notes = { 'en-US': 'A', 'fr-FR': 'B' };

    expect(resolveReleaseNotes({ releaseNotes: notes }, 'en-US')).toEqual(notes);
  }

  it('passes a per-locale map through unchanged', passesAPerLocaleMapThroughUnchanged);
}

describe(
  'resolveReleaseNotes - config notes -> per-locale map',
  describeResolveReleaseNotesPieceNotesPerLocaleMap,
);

function describeListingReleaseNotes() {
  async function returnsAnEmptyMapWhenTheListingHasNoReleaseNotes() {
    const whatsNew = await resolveWhatsNew(launchFile(), releaseApp);

    expect(whatsNew).toEqual({});
  }

  it(
    'returns an empty map when the listing has no release notes',
    returnsAnEmptyMapWhenTheListingHasNoReleaseNotes,
  );

  async function readsEachLocaleAndSkipsLocalesWithoutReleaseNotes() {
    const whatsNew = await resolveWhatsNew(
      launchFile({
        'com.acme.app': {
          apple: {
            info: { 'en-US': { releaseNotes: 'Hello' }, 'de-DE': { title: 'no notes here' } },
          },
        },
      }),
      releaseApp,
    );

    expect(whatsNew).toEqual({ 'en-US': 'Hello' });
  }

  it(
    'reads each locale and skips locales without release notes',
    readsEachLocaleAndSkipsLocalesWithoutReleaseNotes,
  );
}

describe('listing release notes', describeListingReleaseNotes);

function describeResolveWhatsNew() {
  async function letsListingReleaseNotesOverrideReleaseReleaseNotesPerLocale() {
    const merged = await resolveWhatsNew(
      launchFile(
        {
          'com.acme.app': {
            apple: { info: { 'en-US': { releaseNotes: 'From the listing' } } },
          },
        },
        { releaseNotes: { 'en-US': 'From release', 'fr-FR': 'Release only' } },
      ),
      releaseApp,
    );

    expect(merged).toEqual({ 'en-US': 'From the listing', 'fr-FR': 'Release only' });
  }

  it(
    'lets listing release notes override release.releaseNotes per locale',
    letsListingReleaseNotesOverrideReleaseReleaseNotesPerLocale,
  );

  async function usesReleaseReleaseNotesWhenTheListingHasNone() {
    const whatsNew = await resolveWhatsNew(
      launchFile(undefined, { releaseNotes: 'Just the config.' }),
      releaseApp,
    );

    expect(whatsNew).toEqual({ 'en-US': 'Just the config.' });
  }

  it(
    'uses release.releaseNotes when the listing has none',
    usesReleaseReleaseNotesWhenTheListingHasNone,
  );
}

describe('resolveWhatsNew', describeResolveWhatsNew);
