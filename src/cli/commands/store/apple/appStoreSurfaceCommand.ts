import { readFile } from 'node:fs/promises';
import { LaunchPrompt } from '../../../../services/platform/prompt.ts';
import { checkTerminalIsInteractive } from '../../../../services/platform/progress.ts';
import { hasMessage } from '../../../../services/platform/errorMessage.ts';
import { pathExists } from '../../../../path-exists.ts';
import type { PlannedAction } from '../../../../types/reconcile.ts';

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
  const hasExplicitMessage = explicitMessage !== undefined;

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
export const renderStoreSurfaceAction = (plannedAction: PlannedAction): string => {
  if (plannedAction.status === 'skipped') return `- ${plannedAction.description}`;
  if (plannedAction.status === 'failed') {
    let failureText = '';
    if (plannedAction.error !== undefined) failureText = ` - ${plannedAction.error}`;
    return `x ${plannedAction.description}${failureText}`;
  }
  return `+ ${plannedAction.description}`;
};

/** Render one applied App Store surface action with ASCII markers. */
export const renderAppliedStoreSurfaceAction = (appliedAction: PlannedAction): string => {
  if (appliedAction.status === 'failed') {
    let failureText = 'failed';
    if (appliedAction.error !== undefined) failureText = appliedAction.error;
    return `x ${appliedAction.description} - ${failureText}`;
  }
  if (appliedAction.status === 'skipped') return `- ${appliedAction.description}`;
  return `OK ${appliedAction.description}`;
};

function shouldUseTypedSection<StoreSurfaceSection>(
  explicitPath: boolean,
  typedSection: StoreSurfaceSection | undefined,
): boolean {
  const isExplicitPath = explicitPath == true;

  if (isExplicitPath) {
    return false;
  }

  return typedSection !== undefined;
}

function shouldSkipMissingSidecar(sidecarExists: boolean, explicitPath: boolean): boolean {
  const isSidecarMissing = sidecarExists == false;

  if (isSidecarMissing == false) {
    return false;
  }

  return explicitPath == false;
}

/** Resolve a typed config section or its backward-compatible JSON sidecar. */
export async function resolveStoreSurfaceSection<StoreSurfaceSection>(
  typedSection: StoreSurfaceSection | undefined,
  configPath: string,
  explicitPath: boolean,
  parseDocument: (parsedDocument: unknown) => StoreSurfaceSection | Promise<StoreSurfaceSection>,
): Promise<StoreSurfaceSection | undefined> {
  const useTypedSection = shouldUseTypedSection(explicitPath, typedSection);

  if (useTypedSection) {
    return typedSection;
  }

  let sidecarExists = false;

  try {
    sidecarExists = await pathExists(configPath);
  } catch (cause) {
    throw surfaceFailure('inspect store surface config', cause);
  }

  const skipMissingSidecar = shouldSkipMissingSidecar(sidecarExists, explicitPath);

  if (skipMissingSidecar) {
    return undefined;
  }

  const isSidecarMissing = sidecarExists == false;

  if (isSidecarMissing) {
    throw surfaceFailure(
      'read store surface config',
      configPath,
      `No store surface config at ${configPath}.`,
    );
  }

  let sidecarText = '';

  try {
    sidecarText = await readFile(configPath, 'utf8');
  } catch (cause) {
    throw surfaceFailure('read store surface config', cause);
  }

  let parsedDocument: unknown;

  try {
    parsedDocument = JSON.parse(sidecarText);
  } catch (cause) {
    throw surfaceFailure('parse store surface JSON', cause);
  }

  try {
    return await parseDocument(parsedDocument);
  } catch (cause) {
    throw surfaceFailure('decode store surface config', cause);
  }
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
    confirmed = await LaunchPrompt.confirm(confirmationMessage);
  } catch (cause) {
    throw surfaceFailure('confirm store surface write', cause);
  }

  if (confirmed) {
    return true;
  }

  LaunchPrompt.cancel('Aborted - no changes made.');
  return false;
}
