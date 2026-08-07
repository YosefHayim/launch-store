import { Data, Effect, Schema } from 'effect';
import type { PlayRelease } from '../types/googlePlay.js';
import type { MutableDeep } from '../types/mutable.js';

/** Play release statuses accepted by the Android Publisher API. */
export const RELEASE_STATUSES = ['draft', 'inProgress', 'halted', 'completed'] as const;

/** Schema for a Play track release status. */
export const PlayReleaseStatusSchema = Schema.Literal(...RELEASE_STATUSES);

/** A validated Play track release status. */
export type PlayReleaseStatus = Schema.Schema.Type<typeof PlayReleaseStatusSchema>;

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

/** Invalid Play track release input. */
export type PlayReleaseInputFailure = Readonly<{
  readonly _tag: 'PlayReleaseInputFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

export const makePlayReleaseInputFailure =
  Data.tagged<PlayReleaseInputFailure>('PlayReleaseInputFailure');

const ReleaseNotesDocumentSchema = Schema.Record({ key: Schema.String, value: Schema.String });

/** Convert a decoded language-to-copy document to the Android Publisher release-note shape. */
const releaseNotesFromDocument = (
  releaseNotesDocument: Readonly<Record<string, string>>,
): readonly ReleaseNote[] =>
  Object.entries(releaseNotesDocument).map(([language, noteText]) => ({
    language,
    text: noteText,
  }));

/** Create the shared failure for invalid release-note documents. */
const releaseNotesFailure = (cause: unknown): PlayReleaseInputFailure =>
  makePlayReleaseInputFailure({
    message:
      'Release notes must be a JSON object mapping language codes to text, e.g. { "en-US": "..." }.',
    cause,
  });

export const isReleaseStatus = (
  releaseStatusText: string,
): releaseStatusText is PlayReleaseStatus => Schema.is(PlayReleaseStatusSchema)(releaseStatusText);

export const buildRelease = (
  releaseInput: ReleaseInput,
): Effect.Effect<PlayRelease, PlayReleaseInputFailure> => {
  if (releaseInput.versionCodes.length === 0) {
    return Effect.fail(
      makePlayReleaseInputFailure({
        message: 'A release needs at least one version code.',
        cause: releaseInput.versionCodes,
      }),
    );
  }
  let allowsFraction = false;
  if (releaseInput.status === 'inProgress') allowsFraction = true;
  if (releaseInput.status === 'halted') allowsFraction = true;
  if (releaseInput.status === 'inProgress' && releaseInput.userFraction === undefined) {
    return Effect.fail(
      makePlayReleaseInputFailure({
        message:
          'An "inProgress" staged rollout needs a rollout fraction (--rollout, 0-1 exclusive).',
        cause: releaseInput,
      }),
    );
  }
  if (!allowsFraction && releaseInput.userFraction !== undefined) {
    return Effect.fail(
      makePlayReleaseInputFailure({
        message: `A "${releaseInput.status}" release can't carry a rollout fraction (only "inProgress" or "halted" can).`,
        cause: releaseInput,
      }),
    );
  }
  if (releaseInput.userFraction !== undefined && releaseInput.userFraction <= 0) {
    return Effect.fail(
      makePlayReleaseInputFailure({
        message: `The rollout fraction must be between 0 and 1 (exclusive); got ${releaseInput.userFraction}.`,
        cause: releaseInput.userFraction,
      }),
    );
  }
  if (releaseInput.userFraction !== undefined && releaseInput.userFraction >= 1) {
    return Effect.fail(
      makePlayReleaseInputFailure({
        message: `The rollout fraction must be between 0 and 1 (exclusive); got ${releaseInput.userFraction}.`,
        cause: releaseInput.userFraction,
      }),
    );
  }
  const playRelease: MutableDeep<PlayRelease> = {
    status: releaseInput.status,
    versionCodes: [...releaseInput.versionCodes],
  };
  if (releaseInput.name !== undefined) playRelease.name = releaseInput.name;
  if (releaseInput.userFraction !== undefined) {
    playRelease.userFraction = releaseInput.userFraction;
  }
  if (releaseInput.releaseNotes !== undefined && releaseInput.releaseNotes.length > 0) {
    playRelease.releaseNotes = releaseInput.releaseNotes.map((releaseNote) => ({ ...releaseNote }));
  }
  return Effect.succeed(playRelease);
};

export const parseRollout = (
  rolloutText: string,
): Effect.Effect<number, PlayReleaseInputFailure> => {
  const rolloutFraction = Number(rolloutText);
  if (!Number.isFinite(rolloutFraction)) {
    return Effect.fail(
      makePlayReleaseInputFailure({
        message: `--rollout must be a number between 0 and 1 (exclusive); got "${rolloutText}".`,
        cause: rolloutText,
      }),
    );
  }
  if (rolloutFraction <= 0) {
    return Effect.fail(
      makePlayReleaseInputFailure({
        message: `--rollout must be a number between 0 and 1 (exclusive); got "${rolloutText}".`,
        cause: rolloutText,
      }),
    );
  }
  if (rolloutFraction >= 1) {
    return Effect.fail(
      makePlayReleaseInputFailure({
        message: `--rollout must be a number between 0 and 1 (exclusive); got "${rolloutText}".`,
        cause: rolloutText,
      }),
    );
  }
  return Effect.succeed(rolloutFraction);
};

export const parseReleaseNotes = (
  releaseNotesDocument: unknown,
): Effect.Effect<readonly ReleaseNote[], PlayReleaseInputFailure> =>
  Schema.decodeUnknown(ReleaseNotesDocumentSchema)(releaseNotesDocument).pipe(
    Effect.map(releaseNotesFromDocument),
    Effect.mapError(releaseNotesFailure),
  );

export const parseReleaseNotesJson = (
  releaseNotesText: string,
): Effect.Effect<readonly ReleaseNote[], PlayReleaseInputFailure> =>
  Schema.decodeUnknown(Schema.parseJson(ReleaseNotesDocumentSchema))(releaseNotesText).pipe(
    Effect.map(releaseNotesFromDocument),
    Effect.mapError(releaseNotesFailure),
  );
