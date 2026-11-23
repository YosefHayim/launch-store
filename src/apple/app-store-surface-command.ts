// Shows a planned App Store Connect change and asks before writing it.

import { LaunchPrompt } from '../services/platform/prompt.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import { hasMessage } from '../services/platform/error-message.ts';
import type { PlannedAction } from '../types/reconcile.ts';

/** Reading a sidecar or confirming an App Store surface write failed. */
type AppStoreSurfaceCommandFailure = Readonly<{
  readonly _tag: 'AppStoreSurfaceCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeAppStoreSurfaceCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): AppStoreSurfaceCommandFailure {
  return { _tag: 'AppStoreSurfaceCommandFailure', ...fields };
}

/** Convert a surface helper failure into its tagged channel. */
function surfaceFailure(
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): AppStoreSurfaceCommandFailure {
  const hasExplicitMessage = explicitMessage != null;

  if (hasExplicitMessage) {
    return makeAppStoreSurfaceCommandFailure({ operation, message: explicitMessage, cause });
  }

  const isCauseText = typeof cause == 'string';

  if (isCauseText) {
    const hasCauseText = cause.length > 0;

    if (hasCauseText) {
      return makeAppStoreSurfaceCommandFailure({ operation, message: cause, cause });
    }
  }

  if (hasMessage(cause)) {
    return makeAppStoreSurfaceCommandFailure({ operation, message: cause.message, cause });
  }

  return makeAppStoreSurfaceCommandFailure({
    operation,
    message: `${operation} failed.`,
    cause,
  });
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

  let confirmed = false;

  try {
    confirmed = await new LaunchPrompt().confirm(confirmationMessage);
  } catch (cause) {
    throw surfaceFailure('confirm store surface write', cause);
  }

  if (confirmed) {
    return true;
  }

  new LaunchPrompt().cancel('Aborted - no changes made.');

  return false;
}
