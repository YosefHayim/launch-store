// Shows a planned App Store Connect change and asks before writing it.

import { LaunchPrompt } from '../services/platform/prompt.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import type { PlannedAction } from '../types/reconcile.ts';

/** Render one planned App Store surface action with ASCII markers. */
export function renderStoreSurfaceAction(plannedAction: PlannedAction): string {
  if (plannedAction.status == 'skipped') return `- ${plannedAction.description}`;

  if (plannedAction.status == 'failed') {
    let failureText = '';

    if (plannedAction.error != null) failureText = ` - ${plannedAction.error}`;

    return `x ${plannedAction.description}${failureText}`;
  }

  return `+ ${plannedAction.description}`;
}

/** Render one applied App Store surface action with ASCII markers. */
export function renderAppliedStoreSurfaceAction(appliedAction: PlannedAction): string {
  if (appliedAction.status == 'failed') {
    let failureText = 'failed';

    if (appliedAction.error != null) failureText = appliedAction.error;

    return `x ${appliedAction.description} - ${failureText}`;
  }

  if (appliedAction.status == 'skipped') return `- ${appliedAction.description}`;

  return `OK ${appliedAction.description}`;
}

/** Confirm a store-surface write unless the caller supplied --yes. */
export async function confirmStoreSurfaceWrite(
  confirmationMessage: string,
  assumeYes: boolean,
): Promise<boolean> {
  const shouldAssumeYes = assumeYes == true;

  if (shouldAssumeYes) {
    return true;
  }

  const isInteractive = checkTerminalIsInteractive();

  const needsATerminal = isInteractive == false;

  if (needsATerminal) {
    throw new Error(
      'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
      { cause: 'confirmation-required' },
    );
  }

  try {
    var confirmed = await new LaunchPrompt().confirm(confirmationMessage);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  if (confirmed) {
    return true;
  }

  new LaunchPrompt().cancel('Aborted - no changes made.');

  return false;
}
