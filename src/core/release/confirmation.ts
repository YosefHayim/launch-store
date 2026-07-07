/**
 * Confirmation policy for the public release path. The CLI owns the actual prompt UI; this module owns
 * the decision contract so non-interactive release attempts fail before Clack tries to read from stdin.
 */

import { Data, Effect } from 'effect';

/** Message shown when a public release needs confirmation but no prompt can be shown. */
const RELEASE_CONFIRMATION_REQUIRED_MESSAGE =
  'Refusing to submit a public release without confirmation. Re-run with --yes after the operator approves this release.';

/** The command may either skip the prompt because `--yes` was passed, or show an interactive prompt. */
export type ReleaseConfirmationMode = 'confirmed' | 'prompt';

/** Inputs used to decide whether the release command may proceed. */
export interface ResolveReleaseConfirmationInput {
  /** True when the caller passed `--yes` after an out-of-band approval. */
  readonly yes: boolean;
  /** True when stdin/stdout can show and answer an interactive confirmation prompt. */
  readonly canPrompt: boolean;
}

/** Typed error for a non-interactive release without explicit confirmation. */
export class ReleaseConfirmationRequired extends Data.TaggedError('ReleaseConfirmationRequired')<{
  readonly message: string;
}> {}

/**
 * Resolve how the public release command should obtain confirmation.
 *
 * @param input - The parsed `--yes` value and whether the current process can prompt.
 * @returns An Effect that succeeds with the confirmation mode or fails when confirmation is required.
 */
export const resolveReleaseConfirmationMode = (
  input: ResolveReleaseConfirmationInput,
): Effect.Effect<ReleaseConfirmationMode, ReleaseConfirmationRequired> => {
  if (input.yes) return Effect.succeed('confirmed');
  if (input.canPrompt) return Effect.succeed('prompt');
  return Effect.fail(
    new ReleaseConfirmationRequired({ message: RELEASE_CONFIRMATION_REQUIRED_MESSAGE }),
  );
};
