import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readStoreReleaseNotes,
  resolveReleaseNotes,
  resolveReleaseType,
  resolveWhatsNew,
} from './release-inputs.ts';
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
function describeReadStoreReleaseNotesPerLocaleReleaseNotesFromStorePiecePiece() {
  async function returnsWhenTheAppHasNoStorePiecePiece() {
    const systemTemporaryDirectory = tmpdir();
    const launchReleasePath = join(systemTemporaryDirectory, 'launch-release-');
    const appDirectory = mkdtempSync(launchReleasePath);

    const storeReleaseNotes = await readStoreReleaseNotes(appDirectory);

    expect(storeReleaseNotes).toEqual({});
  }

  it('returns {} when the app has no store.config.json', returnsWhenTheAppHasNoStorePiecePiece);

  async function readsEachLocaleSReleaseNotesAndSkipsLocalesWithoutThem() {
    const systemTemporaryDirectory = tmpdir();
    const launchReleasePath = join(systemTemporaryDirectory, 'launch-release-');
    const appDirectory = mkdtempSync(launchReleasePath);
    const storePath = join(appDirectory, 'store.config.json');
    const serialized = JSON.stringify({
      apple: {
        info: { 'en-US': { releaseNotes: 'Hello' }, 'de-DE': { title: 'no notes here' } },
      },
    });

    writeFileSync(storePath, serialized);

    const storeReleaseNotes = await readStoreReleaseNotes(appDirectory);

    expect(storeReleaseNotes).toEqual({ 'en-US': 'Hello' });
  }

  it(
    "reads each locale's releaseNotes and skips locales without them",
    readsEachLocaleSReleaseNotesAndSkipsLocalesWithoutThem,
  );
}

describe(
  'readStoreReleaseNotes - per-locale releaseNotes from store.config.json',
  describeReadStoreReleaseNotesPerLocaleReleaseNotesFromStorePiecePiece,
);
function describeResolveWhatsNewStorePiecePieceOverridesReleaseReleaseNotesPerLocale() {
  async function mergesBothSourcesStorePiecePieceWinningForASharedLocale() {
    const systemTemporaryDirectory = tmpdir();
    const launchReleasePath = join(systemTemporaryDirectory, 'launch-release-');
    const appDirectory = mkdtempSync(launchReleasePath);
    const storePath = join(appDirectory, 'store.config.json');
    const serialized = JSON.stringify({
      apple: { info: { 'en-US': { releaseNotes: 'From the store config' } } },
    });

    writeFileSync(storePath, serialized);

    const merged = await resolveWhatsNew(
      { releaseNotes: { 'en-US': 'From launch.config', 'fr-FR': 'Config only' } },
      appDirectory,
    );

    expect(merged).toEqual({ 'en-US': 'From the store config', 'fr-FR': 'Config only' });
  }

  it(
    'merges both sources, store.config.json winning for a shared locale',
    mergesBothSourcesStorePiecePieceWinningForASharedLocale,
  );

  async function fallsBackToReleaseReleaseNotesWhenThereSNoStorePiecePiece() {
    const systemTemporaryDirectory = tmpdir();
    const launchReleasePath = join(systemTemporaryDirectory, 'launch-release-');
    const appDirectory = mkdtempSync(launchReleasePath);

    const whatsNew = await resolveWhatsNew({ releaseNotes: 'Just the config.' }, appDirectory);

    expect(whatsNew).toEqual({
      'en-US': 'Just the config.',
    });
  }

  it(
    "falls back to release.releaseNotes when there's no store.config.json",
    fallsBackToReleaseReleaseNotesWhenThereSNoStorePiecePiece,
  );
}

describe(
  'resolveWhatsNew - store.config.json overrides release.releaseNotes per locale',
  describeResolveWhatsNewStorePiecePieceOverridesReleaseReleaseNotesPerLocale,
);
