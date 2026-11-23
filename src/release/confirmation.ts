// Requires an explicit yes before Launch submits a public store release.

/** The command may either skip the prompt because `--yes` was passed, or show an interactive prompt. */
type ReleaseConfirmationMode = 'confirmed' | 'prompt';

/** Inputs used to decide whether the release command may proceed. */
type ReleaseConfirmationRequest = {
  readonly yes: boolean;
  readonly canPrompt: boolean;
};

/** Typed error for a non-interactive release without explicit confirmation. */
export type ReleaseConfirmationRequired = Readonly<{
  readonly _tag: 'ReleaseConfirmationRequired';
  readonly message: string;
}>;

export function makeReleaseConfirmationRequired(fields: {
  message: string;
}): ReleaseConfirmationRequired {
  return { _tag: 'ReleaseConfirmationRequired', message: fields.message };
}

export function resolveReleaseConfirmationMode(
  confirmation: ReleaseConfirmationRequest,
): ReleaseConfirmationMode {
  if (confirmation.yes) {
    return 'confirmed';
  }

  if (confirmation.canPrompt) {
    return 'prompt';
  }

  throw makeReleaseConfirmationRequired({
    message:
      'Refusing to submit a public release without confirmation. Re-run with --yes after the operator approves this release.',
  });
}
