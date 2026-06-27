/**
 * Pure helpers behind `launch play-tracks`: validate and assemble the Play **track release** payload
 * (versionCodes + status + staged-rollout fraction + per-language release notes), and parse the rollout
 * fraction and the release-notes file. Track promotion is imperative — "ship build X to track Y" — so
 * (unlike the Play reconcilers) there's no plan/apply diff; these are the validated building blocks the
 * command sends through the Play client's edit lifecycle.
 *
 * Keeping the validation here (not in the command) means a junior reader sees every rule about Play's
 * release-status / rollout combinations in one place, and it's unit-testable without touching the network.
 */

import type { PlayRelease } from '../google/playClient.js';

/** The Play release statuses, mirroring the `status` field on a track release. */
export const RELEASE_STATUSES = ['draft', 'inProgress', 'halted', 'completed'] as const;

/** A Play release status: `draft` (saved, not live), `inProgress` (staged rollout), `halted`, `completed` (full). */
export type PlayReleaseStatus = (typeof RELEASE_STATUSES)[number];

/** Type guard: is the string one of Play's release statuses? */
export function isReleaseStatus(value: string): value is PlayReleaseStatus {
  return (RELEASE_STATUSES as readonly string[]).includes(value);
}

/** One per-language "What's new" note. */
export interface ReleaseNote {
  language: string;
  text: string;
}

/** Inputs to {@link buildRelease}: the build(s) to ship, the target status, and optional rollout/notes. */
export interface ReleaseInput {
  /** Version codes to ship in this release (usually one). */
  versionCodes: string[];
  /** Target release status. */
  status: PlayReleaseStatus;
  /** Staged-rollout fraction (0–1, exclusive). Required for `inProgress`, optional for `halted`. */
  userFraction?: number;
  /** Human release name; Play derives one from the version when omitted. */
  name?: string;
  /** Per-language release notes. */
  releaseNotes?: ReleaseNote[];
}

/**
 * Assemble a validated {@link PlayRelease}, enforcing Play's status/rollout rules so a bad combination
 * fails locally with a clear message instead of as an opaque API rejection: an `inProgress` rollout
 * requires a fraction in (0, 1); `draft`/`completed` can't carry one; `halted` may.
 */
export function buildRelease(input: ReleaseInput): PlayRelease {
  if (input.versionCodes.length === 0) {
    throw new Error('A release needs at least one version code.');
  }
  const allowsFraction = input.status === 'inProgress' || input.status === 'halted';
  if (input.status === 'inProgress' && input.userFraction === undefined) {
    throw new Error(
      'An "inProgress" staged rollout needs a rollout fraction (--rollout, 0–1 exclusive).',
    );
  }
  if (!allowsFraction && input.userFraction !== undefined) {
    throw new Error(
      `A "${input.status}" release can't carry a rollout fraction (only "inProgress" or "halted" can).`,
    );
  }
  if (input.userFraction !== undefined && (input.userFraction <= 0 || input.userFraction >= 1)) {
    throw new Error(
      `The rollout fraction must be between 0 and 1 (exclusive); got ${input.userFraction}.`,
    );
  }

  const release: PlayRelease = { status: input.status, versionCodes: input.versionCodes };
  if (input.name) release.name = input.name;
  if (input.userFraction !== undefined) release.userFraction = input.userFraction;
  if (input.releaseNotes && input.releaseNotes.length > 0)
    release.releaseNotes = input.releaseNotes;
  return release;
}

/** Parse + validate a `--rollout` fraction: a number strictly between 0 and 1. */
export function parseRollout(value: string): number {
  const fraction = Number(value);
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) {
    throw new Error(`--rollout must be a number between 0 and 1 (exclusive); got "${value}".`);
  }
  return fraction;
}

/**
 * Parse release notes from a JSON object mapping BCP-47 language codes to text
 * (e.g. `{ "en-US": "Bug fixes", "de-DE": "Fehlerbehebungen" }`) into the API's array shape.
 */
export function parseReleaseNotes(raw: unknown): ReleaseNote[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(
      'Release notes must be a JSON object mapping language codes to text, e.g. { "en-US": "…" }.',
    );
  }
  const notes: ReleaseNote[] = [];
  for (const [language, text] of Object.entries(raw)) {
    if (typeof text !== 'string') throw new Error(`Release note for ${language} must be a string.`);
    notes.push({ language, text });
  }
  return notes;
}
