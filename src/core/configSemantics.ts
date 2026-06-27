/**
 * Semantic (cross-field) validation of a resolved `launch.config.ts` — the checks that go *beyond shape*.
 *
 * The generated JSON Schema ({@link import("./configSchema.js").validateConfig}) verifies structure, types,
 * and enums, but it can't express invariants that span fields or depend on a value's *meaning*: that a
 * `SCHEDULED` release actually carries a date, that a cloud storage provider has its bucket config, that a
 * rollout fraction is a probability. Those are this module's job. It is the config-level twin of
 * `core/configCheck.ts` (which preflights an app's *Expo* config); both are pure rule tables returning
 * findings, so the rules are trivially unit-testable and the I/O + presentation stay with the callers
 * (`launch config validate` and the `config_validate` MCP tool run schema validation first, then these).
 *
 * Every check assumes the value already passed schema validation, so it reads known-typed fields without
 * re-checking their base types — a semantic issue is never a shape issue in disguise.
 */

import type { LaunchConfig } from './types.js';

/**
 * One semantic finding: the dotted config path it concerns (matching the schema validator's path style,
 * so the two streams read uniformly) and a one-line explanation that names the invariant and the fix.
 */
export interface SemanticIssue {
  /** Dotted/bracketed path to the field, e.g. `release.earliestReleaseDate` or `profiles.production.rollout`. */
  path: string;
  /** What's wrong and how to resolve it, in one line. */
  message: string;
}

/** The cloud storage providers whose `storageConfig` (bucket/endpoint) is mandatory — `local` needs none. */
const CLOUD_STORAGE = new Set(['s3', 'supabase']);

/** Whether a string parses as a real calendar instant (not just any string the schema accepted). */
function isValidInstant(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

/** A cloud storage provider must carry its bucket/endpoint settings, or uploads have nowhere to go. */
function checkStorage(config: LaunchConfig): SemanticIssue[] {
  if (!CLOUD_STORAGE.has(config.storage) || config.storageConfig !== undefined) return [];
  return [
    {
      path: 'storageConfig',
      message: `storage is "${config.storage}" but no storageConfig is set — a cloud store needs its bucket/endpoint. Add storageConfig, or use storage: "local".`,
    },
  ];
}

/**
 * Release-policy invariants the schema can't express: a `SCHEDULED` release needs a valid future-or-past
 * instant to go live at, and per-locale release notes must include the primary locale (else that locale
 * ships with no "What's New").
 */
function checkRelease(config: LaunchConfig): SemanticIssue[] {
  const release = config.release;
  if (release === undefined) return [];
  const issues: SemanticIssue[] = [];

  if (release.releaseType === 'SCHEDULED' && release.earliestReleaseDate === undefined) {
    issues.push({
      path: 'release.earliestReleaseDate',
      message:
        'releaseType is "SCHEDULED" but earliestReleaseDate is missing — set the ISO-8601 instant to go live at.',
    });
  }
  if (release.earliestReleaseDate !== undefined && !isValidInstant(release.earliestReleaseDate)) {
    issues.push({
      path: 'release.earliestReleaseDate',
      message: `earliestReleaseDate "${release.earliestReleaseDate}" is not a valid ISO-8601 instant (e.g. 2026-01-31T09:00:00Z).`,
    });
  }

  const notes = release.releaseNotes;
  if (notes !== undefined && typeof notes !== 'string') {
    const primary = release.primaryLocale ?? 'en-US';
    if (!(primary in notes)) {
      issues.push({
        path: 'release.releaseNotes',
        message: `releaseNotes is per-locale but has no entry for the primary locale "${primary}" — that locale would ship with no release notes.`,
      });
    }
  }
  return issues;
}

/** A staged-rollout fraction is a probability: it must sit in the inclusive 0–1 range. */
function checkProfiles(config: LaunchConfig): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  for (const [name, profile] of Object.entries(config.profiles)) {
    if (profile.rollout !== undefined && (profile.rollout < 0 || profile.rollout > 1)) {
      issues.push({
        path: `profiles.${name}.rollout`,
        message: `rollout ${profile.rollout} is out of range — a staged-rollout fraction must be between 0 and 1.`,
      });
    }
  }
  return issues;
}

/** Retention days can't be negative — `0` disables the sweep, any positive value is a day count. */
function checkRetention(config: LaunchConfig): SemanticIssue[] {
  if (config.artifactRetentionDays === undefined || config.artifactRetentionDays >= 0) return [];
  return [
    {
      path: 'artifactRetentionDays',
      message: `artifactRetentionDays ${config.artifactRetentionDays} is negative — use 0 to disable auto-prune, or a positive day count.`,
    },
  ];
}

/**
 * Run every semantic check against a schema-valid config and return all findings (empty when the config is
 * sound). Order is stable — storage, release, profiles, retention — so output and tests don't depend on
 * object key order. Callers run this *after* {@link import("./configSchema.js").validateConfig}; a config
 * that fails the schema shouldn't reach here, but each check tolerates a missing field regardless.
 */
export function checkConfigSemantics(config: LaunchConfig): SemanticIssue[] {
  return [
    ...checkStorage(config),
    ...checkRelease(config),
    ...checkProfiles(config),
    ...checkRetention(config),
  ];
}
