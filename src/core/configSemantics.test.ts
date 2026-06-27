import { describe, expect, it } from 'vitest';
import type { LaunchConfig } from './types.js';
import { checkConfigSemantics } from './configSemantics.js';

/** A schema-valid baseline config (local storage, one production profile); override a slice per case. */
function config(overrides: Partial<LaunchConfig> = {}): LaunchConfig {
  return {
    profiles: { production: { name: 'production' } },
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    ...overrides,
  };
}

/** The flagged paths, in the order the checker emits them — terser to assert on than full messages. */
function paths(overrides: Partial<LaunchConfig> = {}): string[] {
  return checkConfigSemantics(config(overrides)).map((issue) => issue.path);
}

describe('checkConfigSemantics', () => {
  it('returns nothing for a sound config', () => {
    expect(checkConfigSemantics(config())).toEqual([]);
  });

  describe('storage', () => {
    it('flags a cloud provider with no storageConfig', () => {
      expect(paths({ storage: 's3' })).toEqual(['storageConfig']);
      expect(paths({ storage: 'supabase' })).toEqual(['storageConfig']);
    });

    it('accepts a cloud provider once storageConfig is set', () => {
      const storageConfig = { bucket: 'artifacts', publicBaseUrl: 'https://cdn.example.com' };
      expect(paths({ storage: 's3', storageConfig })).toEqual([]);
    });

    it('never requires storageConfig for local storage', () => {
      expect(paths({ storage: 'local' })).toEqual([]);
    });
  });

  describe('release', () => {
    it('requires earliestReleaseDate for a SCHEDULED release', () => {
      expect(paths({ release: { releaseType: 'SCHEDULED' } })).toEqual([
        'release.earliestReleaseDate',
      ]);
    });

    it('accepts a SCHEDULED release with a valid instant', () => {
      expect(
        paths({
          release: { releaseType: 'SCHEDULED', earliestReleaseDate: '2026-01-31T09:00:00Z' },
        }),
      ).toEqual([]);
    });

    it('rejects an unparseable earliestReleaseDate', () => {
      expect(paths({ release: { earliestReleaseDate: 'next tuesday' } })).toEqual([
        'release.earliestReleaseDate',
      ]);
    });

    it('flags per-locale release notes missing the primary locale', () => {
      expect(paths({ release: { releaseNotes: { 'fr-FR': 'Corrections.' } } })).toEqual([
        'release.releaseNotes',
      ]);
    });

    it('accepts per-locale notes that include the primary locale', () => {
      expect(paths({ release: { releaseNotes: { 'en-US': 'Bug fixes.' } } })).toEqual([]);
    });

    it('honors an explicit primaryLocale when checking per-locale notes', () => {
      expect(
        paths({ release: { primaryLocale: 'fr-FR', releaseNotes: { 'fr-FR': 'Corrections.' } } }),
      ).toEqual([]);
      expect(
        paths({ release: { primaryLocale: 'fr-FR', releaseNotes: { 'en-US': 'Bug fixes.' } } }),
      ).toEqual(['release.releaseNotes']);
    });

    it('accepts a bare-string release note (it applies to the primary locale)', () => {
      expect(paths({ release: { releaseNotes: 'Bug fixes.' } })).toEqual([]);
    });
  });

  describe('profiles', () => {
    it('flags a rollout fraction outside 0–1', () => {
      expect(paths({ profiles: { production: { name: 'production', rollout: 1.5 } } })).toEqual([
        'profiles.production.rollout',
      ]);
      expect(paths({ profiles: { production: { name: 'production', rollout: -0.1 } } })).toEqual([
        'profiles.production.rollout',
      ]);
    });

    it('accepts the inclusive bounds and an interior fraction', () => {
      expect(paths({ profiles: { production: { name: 'production', rollout: 0 } } })).toEqual([]);
      expect(paths({ profiles: { production: { name: 'production', rollout: 1 } } })).toEqual([]);
      expect(paths({ profiles: { production: { name: 'production', rollout: 0.25 } } })).toEqual(
        [],
      );
    });
  });

  describe('retention', () => {
    it('flags a negative artifactRetentionDays', () => {
      expect(paths({ artifactRetentionDays: -1 })).toEqual(['artifactRetentionDays']);
    });

    it('accepts 0 (disabled) and any positive day count', () => {
      expect(paths({ artifactRetentionDays: 0 })).toEqual([]);
      expect(paths({ artifactRetentionDays: 30 })).toEqual([]);
    });
  });

  it('collects multiple findings in a stable order (storage, release, profiles, retention)', () => {
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
  });
});
