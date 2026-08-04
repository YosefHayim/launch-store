import { Terminal } from '@effect/platform';
import { Data, Effect } from 'effect';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { PlannedAction } from '../types/reconcile.js';

/** Confirmation for a Google Play catalog write failed or was unavailable. */
export type PlayCatalogConfirmationFailure = Readonly<{
  readonly _tag: 'PlayCatalogConfirmationFailure';
  readonly message: string;
  readonly cause: unknown;
}>;
export const makePlayCatalogConfirmationFailure = Data.tagged<PlayCatalogConfirmationFailure>(
  'PlayCatalogConfirmationFailure',
);

/** Render one planned Google Play catalog action. */
export const renderPlayCatalogAction = (plannedAction: PlannedAction): string => {
  if (plannedAction.status !== 'failed') return `+ ${plannedAction.description}`;
  let failureText = '';
  if (plannedAction.error !== undefined) failureText = ` - ${plannedAction.error}`;
  return `x ${plannedAction.description}${failureText}`;
};

/** Render one applied Google Play catalog action for a receipt. */
export const renderAppliedPlayCatalogAction = (appliedAction: PlannedAction): string => {
  if (appliedAction.status === 'failed') {
    let failureText = 'failed';
    if (appliedAction.error !== undefined) failureText = appliedAction.error;
    return `x ${appliedAction.description} - ${failureText}`;
  }
  if (appliedAction.status === 'skipped') return `- ${appliedAction.description}`;
  return `OK ${appliedAction.description}`;
};

/** Confirm a Play catalog write unless the caller supplied `--yes`. */
export const confirmPlayCatalogWrite = (
  confirmationMessage: string,
  assumeYes: boolean,
): Effect.Effect<
  boolean,
  PlayCatalogConfirmationFailure,
  LaunchPromptService | Terminal.Terminal
> =>
  Effect.gen(function* () {
    if (assumeYes) return true;
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        makePlayCatalogConfirmationFailure({
          message:
            'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
          cause: 'confirmation-required',
        }),
      );
    }
    const prompt = yield* LaunchPrompt;
    const confirmed = yield* prompt
      .confirm(confirmationMessage)
      .pipe(
        Effect.mapError((cause) =>
          makePlayCatalogConfirmationFailure({ message: cause.message, cause }),
        ),
      );
    if (confirmed) return true;
    yield* prompt.cancel('Aborted - no changes made.');
    return false;
  });
