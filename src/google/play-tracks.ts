// Checks rollout, notes, and status, then builds one Google Play track release.

import type { PlayRelease } from '../types/google-play.ts';
import type { MutableDeep } from '../types/mutable.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

/** Play release statuses accepted by the Android Publisher API. */
export const RELEASE_STATUSES = ['draft', 'inProgress', 'halted', 'completed'] as const;

/** A validated Play track release status. */
export type PlayReleaseStatus = (typeof RELEASE_STATUSES)[number];

/** One localized Play release note. */
export type ReleaseNote = Readonly<{
  readonly language: string;
  readonly text: string;
}>;

/** Inputs needed to build one Play track release. */
export type ReleaseInput = Readonly<{
  readonly versionCodes: readonly string[];
  readonly status: PlayReleaseStatus;
  readonly userFraction?: number;
  readonly name?: string;
  readonly releaseNotes?: readonly ReleaseNote[];
}>;

function releaseNoteFromEntry(languageAndText: [string, string]): ReleaseNote {
  const [language, noteText] = languageAndText;

  return { language, text: noteText };
}

function releaseNotesFromDocument(
  releaseNotesDocument: Readonly<Record<string, string>>,
): readonly ReleaseNote[] {
  return Object.entries(releaseNotesDocument).map(releaseNoteFromEntry);
}

function releaseNotesFailure(cause: unknown): never {
  throw new Error(
    'Release notes must be a JSON object mapping language codes to text, e.g. { "en-US": "..." }.',
    { cause },
  );
}

function decodeReleaseNotesDocument(
  releaseNotesDocument: unknown,
): Readonly<Record<string, string>> {
  const releaseNotesDocumentObject = readPlainObject(releaseNotesDocument);

  if (releaseNotesDocumentObject == null) {
    throw releaseNotesFailure(releaseNotesDocument);
  }

  const notes: Record<string, string> = {};

  for (const [language, noteText] of Object.entries(releaseNotesDocumentObject)) {
    if (typeof noteText != 'string') {
      throw releaseNotesFailure(releaseNotesDocumentObject);
    }

    notes[language] = noteText;
  }

  return notes;
}

export function isReleaseStatus(releaseStatusText: string): releaseStatusText is PlayReleaseStatus {
  return RELEASE_STATUSES.some(function statusMatches(releaseStatus: PlayReleaseStatus) {
    return releaseStatus == releaseStatusText;
  });
}

function allowsRolloutFraction(releaseStatus: PlayReleaseStatus): boolean {
  if (releaseStatus == 'inProgress') {
    return true;
  }

  return releaseStatus == 'halted';
}

function copyReleaseNote(releaseNote: ReleaseNote): ReleaseNote {
  return { ...releaseNote };
}

function requireStagedFraction(releaseInput: ReleaseInput): void {
  const isStagedRollout = releaseInput.status == 'inProgress';

  if (isStagedRollout == false) {
    return;
  }

  if (releaseInput.userFraction != null) {
    return;
  }

  throw new Error(
    'An "inProgress" staged rollout needs a rollout fraction (--rollout, 0-1 exclusive).',
    { cause: releaseInput },
  );
}

function rejectForbiddenFraction(releaseInput: ReleaseInput): void {
  const rolloutIsAllowed = allowsRolloutFraction(releaseInput.status);

  if (rolloutIsAllowed) {
    return;
  }

  if (releaseInput.userFraction == null) {
    return;
  }

  throw new Error(
    `A "${releaseInput.status}" release can't carry a rollout fraction (only "inProgress" or "halted" can).`,
    { cause: releaseInput },
  );
}

function rejectOutOfRangeFraction(userFraction: number | undefined): void {
  if (userFraction == null) {
    return;
  }

  const fractionIsTooLow = userFraction <= 0;

  if (fractionIsTooLow) {
    throw new Error(
      `The rollout fraction must be between 0 and 1 (exclusive); got ${userFraction}.`,
      { cause: userFraction },
    );
  }

  const fractionIsTooHigh = userFraction >= 1;

  if (fractionIsTooHigh) {
    throw new Error(
      `The rollout fraction must be between 0 and 1 (exclusive); got ${userFraction}.`,
      { cause: userFraction },
    );
  }
}

function attachReleaseNotes(
  playRelease: MutableDeep<PlayRelease>,
  releaseNotes: readonly ReleaseNote[] | undefined,
): void {
  if (releaseNotes == null) {
    return;
  }

  const hasNotes = releaseNotes.length > 0;

  if (hasNotes == false) {
    return;
  }

  playRelease.releaseNotes = releaseNotes.map(copyReleaseNote);
}

export function buildRelease(releaseInput: ReleaseInput): PlayRelease {
  const hasNoVersionCodes = releaseInput.versionCodes.length == 0;

  if (hasNoVersionCodes) {
    throw new Error('A release needs at least one version code.', {
      cause: releaseInput.versionCodes,
    });
  }

  requireStagedFraction(releaseInput);
  rejectForbiddenFraction(releaseInput);
  rejectOutOfRangeFraction(releaseInput.userFraction);

  const playRelease: MutableDeep<PlayRelease> = {
    status: releaseInput.status,
    versionCodes: [...releaseInput.versionCodes],
  };

  if (releaseInput.name != null) {
    playRelease.name = releaseInput.name;
  }

  if (releaseInput.userFraction != null) {
    playRelease.userFraction = releaseInput.userFraction;
  }

  attachReleaseNotes(playRelease, releaseInput.releaseNotes);

  return playRelease;
}

export function parseRollout(rolloutText: string): number {
  const rolloutFraction = Number(rolloutText);

  const fractionIsUnusable = Number.isFinite(rolloutFraction) == false;

  if (fractionIsUnusable) {
    throw new Error(
      `--rollout must be a number between 0 and 1 (exclusive); got "${rolloutText}".`,
      { cause: rolloutText },
    );
  }

  const fractionIsTooLow = rolloutFraction <= 0;

  if (fractionIsTooLow) {
    throw new Error(
      `--rollout must be a number between 0 and 1 (exclusive); got "${rolloutText}".`,
      { cause: rolloutText },
    );
  }

  const fractionIsTooHigh = rolloutFraction >= 1;

  if (fractionIsTooHigh) {
    throw new Error(
      `--rollout must be a number between 0 and 1 (exclusive); got "${rolloutText}".`,
      { cause: rolloutText },
    );
  }

  return rolloutFraction;
}

export function parseReleaseNotes(releaseNotesDocument: unknown): readonly ReleaseNote[] {
  const notes = decodeReleaseNotesDocument(releaseNotesDocument);

  return releaseNotesFromDocument(notes);
}

export function parseReleaseNotesJson(releaseNotesText: string): readonly ReleaseNote[] {
  let parsedNotes: unknown = null;

  try {
    parsedNotes = JSON.parse(releaseNotesText);
  } catch (cause) {
    throw releaseNotesFailure(cause);
  }

  return parseReleaseNotes(parsedNotes);
}
