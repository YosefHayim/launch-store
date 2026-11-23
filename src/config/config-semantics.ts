// Checks Launch config rules that JSON Schema cannot express, such as rollout size.

import type { LaunchConfig } from '../types/config.ts';

/** One semantic finding: the dotted config path it concerns (matching the schema validator's */
type SemanticIssue = {
  path: string;
  message: string;
};
/** The cloud storage providers whose `storageConfig` (bucket/endpoint) is mandatory - `local` needs none. */
const cloudStorage = new Set(['s3', 'supabase']);

/** Whether a string parses as a real calendar instant (not just any string the schema accepted). */
function isValidInstant(instantText: string): boolean {
  return !Number.isNaN(Date.parse(instantText));
}

/** A cloud storage provider must carry its bucket/endpoint settings, or uploads have nowhere to go. */
function checkStorage(config: LaunchConfig): SemanticIssue[] {
  if (!cloudStorage.has(config.storage)) return [];

  if (config.storageConfig != null) return [];

  return [
    {
      path: 'storageConfig',
      message: `storage is "${config.storage}" but no storageConfig is set - a cloud store needs its bucket/endpoint. Add storageConfig, or use storage: "local".`,
    },
  ];
}

/** Release-policy invariants the schema can't express */
function checkRelease(config: LaunchConfig): SemanticIssue[] {
  const release = config.release;

  if (release == null) return [];

  const issues: SemanticIssue[] = [];

  if (release.releaseType == 'SCHEDULED' && release.earliestReleaseDate == null) {
    issues.push({
      path: 'release.earliestReleaseDate',
      message:
        'releaseType is "SCHEDULED" but earliestReleaseDate is missing - set the ISO-8601 instant to go live at.',
    });
  }

  if (release.earliestReleaseDate != null && !isValidInstant(release.earliestReleaseDate)) {
    issues.push({
      path: 'release.earliestReleaseDate',
      message: `earliestReleaseDate "${release.earliestReleaseDate}" is not a valid ISO-8601 instant (e.g. 2026-01-31T09:00:00Z).`,
    });
  }

  const notes = release.releaseNotes;

  if (notes != null && typeof notes != 'string') {
    let primary = release.primaryLocale;

    if (primary == null) primary = 'en-US';

    if (!(primary in notes)) {
      issues.push({
        path: 'release.releaseNotes',
        message: `releaseNotes is per-locale but has no entry for the primary locale "${primary}" - that locale would ship with no release notes.`,
      });
    }
  }

  return issues;
}

/** A staged-rollout fraction must be above 0 and at most 1 - Play rejects a 0% staged release. */
function checkProfiles(config: LaunchConfig): SemanticIssue[] {
  const issues: SemanticIssue[] = [];

  for (const [name, profile] of Object.entries(config.profiles)) {
    let rolloutInvalid = false;

    if (profile.rollout != null && profile.rollout <= 0) rolloutInvalid = true;

    if (profile.rollout != null && profile.rollout > 1) rolloutInvalid = true;

    if (rolloutInvalid) {
      issues.push({
        path: `profiles.${name}.rollout`,
        message: `rollout ${profile.rollout} is out of range - a staged-rollout fraction must be between 0 (exclusive) and 1.`,
      });
    }
  }

  return issues;
}

/** Retention days can't be negative - `0` disables the sweep, any positive value is a day count. */
function checkRetention(config: LaunchConfig): SemanticIssue[] {
  if (config.artifactRetentionDays == null) return [];

  if (config.artifactRetentionDays >= 0) return [];

  return [
    {
      path: 'artifactRetentionDays',
      message: `artifactRetentionDays ${config.artifactRetentionDays} is negative - use 0 to disable auto-prune, or a positive day count.`,
    },
  ];
}

/** Run every semantic check and return all findings. */
export function checkConfigSemantics(config: LaunchConfig): SemanticIssue[] {
  return [
    ...checkStorage(config),
    ...checkRelease(config),
    ...checkProfiles(config),
    ...checkRetention(config),
  ];
}
