import { Data, Effect } from 'effect';
/** Message shown when a public release needs confirmation but no prompt can be shown. */
const RELEASE_CONFIRMATION_REQUIRED_MESSAGE =
  'Refusing to submit a public release without confirmation. Re-run with --yes after the operator approves this release.';
/** The command may either skip the prompt because `--yes` was passed, or show an interactive prompt. */
export type ReleaseConfirmationMode = 'confirmed' | 'prompt';
/** Inputs used to decide whether the release command may proceed. */
export type ResolveReleaseConfirmationInput = {
  readonly yes: boolean;
  readonly canPrompt: boolean;
};
/** Typed error for a non-interactive release without explicit confirmation. */
export type ReleaseConfirmationRequired = Readonly<{
  readonly _tag: 'ReleaseConfirmationRequired';
  readonly message: string;
}>;
export const makeReleaseConfirmationRequired = Data.tagged<ReleaseConfirmationRequired>(
  'ReleaseConfirmationRequired',
);
export const resolveReleaseConfirmationMode = (
  input: ResolveReleaseConfirmationInput,
): Effect.Effect<ReleaseConfirmationMode, ReleaseConfirmationRequired> => {
  if (input.yes) return Effect.succeed('confirmed');
  if (input.canPrompt) return Effect.succeed('prompt');
  return Effect.fail(
    makeReleaseConfirmationRequired({ message: RELEASE_CONFIRMATION_REQUIRED_MESSAGE }),
  );
};
