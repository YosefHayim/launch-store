import { hasMessage } from '@/services/platform/errorMessage.js';
import { checkTerminalIsInteractive } from '@/services/platform/progress.js';
import { LaunchPrompt } from '@/services/platform/prompt.js';
import type { PlannedAction } from '@/types/reconcile.js';

/** Confirmation for a Google Play catalog write failed or was unavailable. */
type PlayCatalogConfirmationFailure = Readonly<{
  readonly _tag: 'PlayCatalogConfirmationFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

function makePlayCatalogConfirmationFailure(fields: {
  message: string;
  cause: unknown;
}): PlayCatalogConfirmationFailure {
  return { _tag: 'PlayCatalogConfirmationFailure', ...fields };
}

function confirmationMessage(cause: unknown): string {
  if (hasMessage(cause)) {
    return cause.message;
  }

  return 'Play catalog confirmation failed.';
}

/** Render one planned Google Play catalog action. */
export function renderPlayCatalogAction(plannedAction: PlannedAction): string {
  if (plannedAction.status != 'failed') {
    return `+ ${plannedAction.description}`;
  }

  let failureText = '';

  if (plannedAction.error != null) {
    failureText = ` - ${plannedAction.error}`;
  }

  return `x ${plannedAction.description}${failureText}`;
}

/** Render one applied Google Play catalog action for a receipt. */
export function renderAppliedPlayCatalogAction(appliedAction: PlannedAction): string {
  if (appliedAction.status == 'failed') {
    let failureText = 'failed';

    if (appliedAction.error != null) {
      failureText = appliedAction.error;
    }

    return `x ${appliedAction.description} - ${failureText}`;
  }

  if (appliedAction.status == 'skipped') {
    return `- ${appliedAction.description}`;
  }

  return `OK ${appliedAction.description}`;
}

/** Confirm a Play catalog write unless the caller supplied `--yes`. */
export async function confirmPlayCatalogWrite(
  confirmationMessageText: string,
  assumeYes: boolean,
): Promise<boolean> {
  if (assumeYes) {
    return true;
  }

  const terminalIsInteractive = checkTerminalIsInteractive();

  if (terminalIsInteractive == false) {
    throw makePlayCatalogConfirmationFailure({
      message:
        'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
      cause: 'confirmation-required',
    });
  }

  let confirmed = false;

  try {
    confirmed = await LaunchPrompt.confirm(confirmationMessageText);
  } catch (cause) {
    throw makePlayCatalogConfirmationFailure({ message: confirmationMessage(cause), cause });
  }

  if (confirmed) {
    return true;
  }

  LaunchPrompt.cancel('Aborted - no changes made.');

  return false;
}
