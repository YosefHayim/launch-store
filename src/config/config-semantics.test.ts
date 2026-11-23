import { describe, expect, it } from 'vitest';
import type { LaunchConfig } from '../types/config.ts';
import { checkConfigSemantics } from './config-semantics.ts';

/** A schema-valid baseline config (local storage, one production profile); override a slice per case. */
function config(overrides: Partial<LaunchConfig> = {}): LaunchConfig {
  return {
    profiles: { production: { name: 'production' } },
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
    ...overrides,
  };
}

/** The flagged paths, in the order the checker emits them - terser to assert on than full messages. */
function paths(overrides: Partial<LaunchConfig> = {}): string[] {
  function readPath(issue: { path: string; message: string }) {
    return issue.path;
  }

  return checkConfigSemantics(config(overrides)).map(readPath);
}

function describeCheckPieceSemantics() {
  function returnsNothingForASoundPiece() {
    const checkSemantics = checkConfigSemantics(config());
    expect(checkSemantics).toEqual([]);
  }

  it('returns nothing for a sound config', returnsNothingForASoundPiece);

  function describeStorage() {
    function flagsACloudProviderWithNoStoragePiece() {
      expect(paths({ storage: 's3' })).toEqual(['storageConfig']);
      expect(paths({ storage: 'supabase' })).toEqual(['storageConfig']);
    }

    it('flags a cloud provider with no storageConfig', flagsACloudProviderWithNoStoragePiece);

    function acceptsACloudProviderOnceStoragePieceIsSet() {
      const storageConfig = { bucket: 'artifacts', publicBaseUrl: 'https://cdn.example.com' };
      expect(paths({ storage: 's3', storageConfig })).toEqual([]);
    }

    it(
      'accepts a cloud provider once storageConfig is set',
      acceptsACloudProviderOnceStoragePieceIsSet,
    );

    function neverRequiresStoragePieceForLocalStorage() {
      expect(paths({ storage: 'local' })).toEqual([]);
    }

    it('never requires storageConfig for local storage', neverRequiresStoragePieceForLocalStorage);
  }

  describe('storage', describeStorage);

  function describeRelease() {
    function requiresEarliestReleaseDateForASCHEDULEDRelease() {
      expect(paths({ release: { releaseType: 'SCHEDULED' } })).toEqual([
        'release.earliestReleaseDate',
      ]);
    }

    it(
      'requires earliestReleaseDate for a SCHEDULED release',
      requiresEarliestReleaseDateForASCHEDULEDRelease,
    );

    function acceptsASCHEDULEDReleaseWithAValidInstant() {
      expect(
        paths({
          release: { releaseType: 'SCHEDULED', earliestReleaseDate: '2026-01-31T09:00:00Z' },
        }),
      ).toEqual([]);
    }

    it(
      'accepts a SCHEDULED release with a valid instant',
      acceptsASCHEDULEDReleaseWithAValidInstant,
    );

    function rejectsAnUnparseableEarliestReleaseDate() {
      expect(paths({ release: { earliestReleaseDate: 'next tuesday' } })).toEqual([
        'release.earliestReleaseDate',
      ]);
    }

    it('rejects an unparseable earliestReleaseDate', rejectsAnUnparseableEarliestReleaseDate);

    function flagsPerLocaleReleaseNotesMissingThePrimaryLocale() {
      expect(paths({ release: { releaseNotes: { 'fr-FR': 'Corrections.' } } })).toEqual([
        'release.releaseNotes',
      ]);
    }

    it(
      'flags per-locale release notes missing the primary locale',
      flagsPerLocaleReleaseNotesMissingThePrimaryLocale,
    );

    function acceptsPerLocaleNotesThatIncludeThePrimaryLocale() {
      expect(paths({ release: { releaseNotes: { 'en-US': 'Bug fixes.' } } })).toEqual([]);
    }

    it(
      'accepts per-locale notes that include the primary locale',
      acceptsPerLocaleNotesThatIncludeThePrimaryLocale,
    );

    function honorsAnExplicitPrimaryLocaleWhenCheckingPerLocaleNotes() {
      expect(
        paths({ release: { primaryLocale: 'fr-FR', releaseNotes: { 'fr-FR': 'Corrections.' } } }),
      ).toEqual([]);
      expect(
        paths({ release: { primaryLocale: 'fr-FR', releaseNotes: { 'en-US': 'Bug fixes.' } } }),
      ).toEqual(['release.releaseNotes']);
    }

    it(
      'honors an explicit primaryLocale when checking per-locale notes',
      honorsAnExplicitPrimaryLocaleWhenCheckingPerLocaleNotes,
    );

    function acceptsABareStringReleaseNoteItAppliesToThePrimaryLocale() {
      expect(paths({ release: { releaseNotes: 'Bug fixes.' } })).toEqual([]);
    }

    it(
      'accepts a bare-string release note (it applies to the primary locale)',
      acceptsABareStringReleaseNoteItAppliesToThePrimaryLocale,
    );
  }

  describe('release', describeRelease);

  function describeProfiles() {
    function flagsARolloutFractionOutside0ExclusiveTo1() {
      expect(paths({ profiles: { production: { name: 'production', rollout: 1.5 } } })).toEqual([
        'profiles.production.rollout',
      ]);
      expect(paths({ profiles: { production: { name: 'production', rollout: 0 } } })).toEqual([
        'profiles.production.rollout',
      ]);
      expect(paths({ profiles: { production: { name: 'production', rollout: -0.1 } } })).toEqual([
        'profiles.production.rollout',
      ]);
    }

    it(
      'flags a rollout fraction outside 0 (exclusive) to 1',
      flagsARolloutFractionOutside0ExclusiveTo1,
    );

    function acceptsAFullRolloutAndAnInteriorFraction() {
      expect(paths({ profiles: { production: { name: 'production', rollout: 1 } } })).toEqual([]);
      expect(paths({ profiles: { production: { name: 'production', rollout: 0.25 } } })).toEqual(
        [],
      );
    }

    it('accepts a full rollout and an interior fraction', acceptsAFullRolloutAndAnInteriorFraction);
  }

  describe('profiles', describeProfiles);

  function describeRetention() {
    function flagsANegativeArtifactRetentionDays() {
      expect(paths({ artifactRetentionDays: -1 })).toEqual(['artifactRetentionDays']);
    }

    it('flags a negative artifactRetentionDays', flagsANegativeArtifactRetentionDays);

    function accepts0DisabledAndAnyPositiveDayCount() {
      expect(paths({ artifactRetentionDays: 0 })).toEqual([]);
      expect(paths({ artifactRetentionDays: 30 })).toEqual([]);
    }

    it('accepts 0 (disabled) and any positive day count', accepts0DisabledAndAnyPositiveDayCount);
  }

  describe('retention', describeRetention);

  function collectsMultipleFindingsInAStableOrderStorageReleaseProfilesRetention() {
    expect(
      paths({
        storage: 's3',
        release: { releaseType: 'SCHEDULED' },
        profiles: { production: { name: 'production', rollout: 2 } },
        artifactRetentionDays: -5,
      }),
    ).toEqual([
      'storageConfig',
      'release.earliestReleaseDate',
      'profiles.production.rollout',
      'artifactRetentionDays',
    ]);
  }

  it(
    'collects multiple findings in a stable order (storage, release, profiles, retention)',
    collectsMultipleFindingsInAStableOrderStorageReleaseProfilesRetention,
  );
}

describe('checkConfigSemantics', describeCheckPieceSemantics);
