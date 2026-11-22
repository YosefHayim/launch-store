import { errorMessage } from '../../services/platform/errorMessage.js';
import { createLogger } from '../../services/platform/logger.js';
import { LaunchPrompt } from '../../services/platform/prompt.js';
import { checkTerminalIsInteractive } from '../../services/platform/progress.js';
import { completeCommand, isCommandExit } from '../../terminal/commandExit.js';
import type { PlannedAction } from '../../types/reconcile.js';
import { loadActiveAppleStore } from './appleStoreCommand.js';
import { readAvailabilityConfig, reconcileAvailability } from './availability.js';
import { resolveStoreBundleId } from '../shared/selectStoreApp.js';

export type AvailabilityCommandInput = {
  app?: string;
  config: string;
  dryRun: boolean;
  yes: boolean;
};

type AvailabilityCommandFailure = Readonly<{
  readonly _tag: 'AvailabilityCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeAvailabilityCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): AvailabilityCommandFailure {
  return { _tag: 'AvailabilityCommandFailure', ...fields };
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  return true;
}

function readText(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];
  const isText = typeof field == 'string';

  if (isText == false) {
    throw new Error(`Expected ${fieldName} to be a string.`);
  }

  return field;
}

function readFlag(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];
  const isFlag = typeof field == 'boolean';

  if (isFlag == false) {
    throw new Error(`Expected ${fieldName} to be a boolean.`);
  }

  return field;
}

/** Decode one availability command. Rejects an explicit undefined exact optional app. */
export function AvailabilityCommandInputSchema(rawCommandInput: unknown): AvailabilityCommandInput {
  const isCommandRecord = isRecord(rawCommandInput);

  if (isCommandRecord == false) {
    throw new Error('Availability command input must be an object.');
  }

  const config = readText(rawCommandInput, 'config');
  const dryRun = readFlag(rawCommandInput, 'dryRun');
  const yes = readFlag(rawCommandInput, 'yes');
  const hasApp = Object.hasOwn(rawCommandInput, 'app');

  if (hasApp == false) {
    return { config, dryRun, yes };
  }

  const app = rawCommandInput['app'];
  const isAppText = typeof app == 'string';

  if (isAppText == false) {
    throw new Error('Expected app to be a string.');
  }

  return { app, config, dryRun, yes };
}

function commandFailure(
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): AvailabilityCommandFailure {
  let message = errorMessage(cause);
  const hasExplicitMessage = explicitMessage != null;

  if (hasExplicitMessage) {
    message = explicitMessage;
  }

  return makeAvailabilityCommandFailure({ operation, message, cause });
}

function isAvailabilityCommandFailure(cause: unknown): cause is AvailabilityCommandFailure {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'AvailabilityCommandFailure';
}

export function renderAvailabilityAction(plannedAction: PlannedAction): string {
  if (plannedAction.status == 'failed') {
    let failureText = 'failed';
    const actionError = plannedAction.error;
    const hasError = actionError != null;

    if (hasError) {
      failureText = actionError;
    }

    return `x ${plannedAction.description} - ${failureText}`;
  }

  if (plannedAction.destructive) {
    return `! ${plannedAction.description}`;
  }

  return `+ ${plannedAction.description}`;
}

export function availabilityConfirmationMessage(plannedAction: PlannedAction | undefined): string {
  const removesTerritories = plannedAction?.destructive == true;

  if (removesTerritories) {
    return 'This removes the app from sale in some territories. Apply the new store availability?';
  }

  return 'Apply the new store availability?';
}

function appliedLine(completedAction: PlannedAction): string {
  return `OK ${completedAction.description}`;
}

function renderPlanned(plannedAction: PlannedAction): string {
  return renderAvailabilityAction(plannedAction);
}

async function confirmAvailabilityWrite(
  plannedAction: PlannedAction | undefined,
  assumeYes: boolean,
): Promise<boolean> {
  const isConfirmed = assumeYes == true;

  if (isConfirmed) {
    return true;
  }

  const terminalIsInteractive = checkTerminalIsInteractive();
  const needsATerminal = terminalIsInteractive == false;

  if (needsATerminal) {
    throw commandFailure(
      'confirm availability write',
      'confirmation-required',
      'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
    );
  }

  let confirmed = false;

  try {
    confirmed = await LaunchPrompt.confirm(availabilityConfirmationMessage(plannedAction));
  } catch (cause) {
    throw commandFailure('confirm availability write', cause);
  }

  if (confirmed) {
    return true;
  }

  LaunchPrompt.cancel('Aborted - no changes made.');
  return false;
}

export async function availabilityCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = AvailabilityCommandInputSchema(rawCommandInput);
    const logger = createLogger(false);
    const availabilityConfig = await readAvailabilityConfig(commandInput.config);
    const bundleId = await resolveStoreBundleId(commandInput.app);
    const appleStore = await loadActiveAppleStore();
    const availabilityPlan = await reconcileAvailability(appleStore, {
      bundleId,
      config: availabilityConfig,
      dryRun: true,
    });
    logger.gap();
    const isAlreadyInSync = availabilityPlan.actions.length == 0;

    if (isAlreadyInSync) {
      logger.step(bundleId, 'store availability already in sync');
      return;
    }

    logger.notice(bundleId, ...availabilityPlan.actions.map(renderPlanned));
    logger.gap();
    const isDryRun = commandInput.dryRun == true;

    if (isDryRun) {
      logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return;
    }

    const confirmed = await confirmAvailabilityWrite(availabilityPlan.actions[0], commandInput.yes);
    const declined = confirmed == false;

    if (declined) {
      return;
    }

    const appliedAvailability = await reconcileAvailability(appleStore, {
      bundleId,
      config: availabilityConfig,
      dryRun: false,
    });
    const appliedAction = appliedAvailability.actions[0];
    const hasAppliedAction = appliedAction != null;

    if (hasAppliedAction) {
      const writeFailed = appliedAction.status == 'failed';

      if (writeFailed) {
        logger.box('Failed', [renderAvailabilityAction(appliedAction)]);
        completeCommand(1);
        return;
      }
    }

    logger.box('Applied', appliedAvailability.actions.map(appliedLine));
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    if (isAvailabilityCommandFailure(cause)) {
      throw cause;
    }

    throw commandFailure('run availability command', cause);
  }
}
