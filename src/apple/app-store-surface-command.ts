// Shows a planned App Store Connect change and asks before writing it.

import { LaunchPrompt } from '../services/platform/prompt.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import { hasMessage } from '../services/platform/error-message.ts';
import type { PlannedAction } from '../types/reconcile.ts';

/** Convert a surface helper failure into an Error. */
function surfaceFailure(operation: string, cause: unknown, explicitMessage?: string): never {
  const hasExplicitMessage = explicitMessage != null;

  if (hasExplicitMessage) {
    throw new Error(explicitMessage, { cause });
  }

  const causeText = typeof cause == 'string' ? cause : '';
  const isBlankCauseText = causeText.length == 0;

  if (isBlankCauseText == false) {
    throw new Error(causeText, { cause });
  }

  const causeHasMessage = hasMessage(cause);

  if (causeHasMessage) {
    throw new Error(cause.message, { cause });
  }

  throw new Error(`${operation} failed.`, { cause });
}

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
    throw surfaceFailure(
      'confirm store surface write',
      'confirmation-required',
      'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
    );
  }

  try {
    var confirmed = await new LaunchPrompt().confirm(confirmationMessage);
  } catch (cause) {
    throw surfaceFailure('confirm store surface write', cause);
  }

  if (confirmed) {
    return true;
  }

  new LaunchPrompt().cancel('Aborted - no changes made.');

  return false;
}
