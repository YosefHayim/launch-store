// Sets the App Store countries an app is sold in from launch.config.ts.

import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import { completeCommand, isCommandExit } from '../terminal/command-exit.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import { loadActiveAppleStore } from './apple-store-command.ts';
import { reconcileAvailability } from './availability.ts';
import { loadStoreAppContext } from '../store/shared/select-store-app.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { isFailureTag } from '../services/platform/tagged-failure.ts';
import type { Command } from '../cli/command.ts';
import { runCliProgram } from '../cli/run-cli-program.ts';

export type AvailabilityCommandInput = {
  app?: string;
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
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Availability command input must be an object.');
  }

  const dryRun = readFlag(rawCommandInputObject, 'dryRun');
  const yes = readFlag(rawCommandInputObject, 'yes');
  const hasApp = Object.hasOwn(rawCommandInputObject, 'app');

  if (hasApp == false) {
    return { dryRun, yes };
  }

  const app = rawCommandInputObject['app'];
  const isAppText = typeof app == 'string';

  if (isAppText == false) {
    throw new Error('Expected app to be a string.');
  }

  return { app, dryRun, yes };
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
    confirmed = await new LaunchPrompt().confirm(availabilityConfirmationMessage(plannedAction));
  } catch (cause) {
    throw commandFailure('confirm availability write', cause);
  }

  if (confirmed) {
    return true;
  }

  new LaunchPrompt().cancel('Aborted - no changes made.');

  return false;
}

export async function availabilityCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = AvailabilityCommandInputSchema(rawCommandInput);
    const logger = createLogger(false);
    const storeAppContext = await loadStoreAppContext(commandInput.app);
    const bundleId = storeAppContext.app.bundleId;

    const isBundleMissing = bundleId == null;

    if (isBundleMissing) {
      throw commandFailure(
        'resolve availability bundle id',
        storeAppContext.app,
        `No iOS bundle identifier for ${storeAppContext.app.name} (set ios.bundleIdentifier in app.json).`,
      );
    }

    const availabilitySection = storeAppContext.config.availability?.[bundleId];

    const isAvailabilityMissing = availabilitySection == null;

    if (isAvailabilityMissing) {
      throw commandFailure(
        'resolve availability config',
        bundleId,
        `No availability config for ${bundleId}. Add an availability entry to launch.config.ts.`,
      );
    }

    const appleStore = await loadActiveAppleStore();
    const availabilityPlan = await reconcileAvailability(appleStore, {
      bundleId,
      config: availabilitySection,
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
      config: availabilitySection,
      dryRun: false,
    });
    const appliedAction = appliedAvailability.actions[0];

    const hasAppliedAction = appliedAction != null;

    if (hasAppliedAction) {
      const writeFailed = appliedAction.status == 'failed';

      if (writeFailed) {
        const availabilityAction = renderAvailabilityAction(appliedAction);
        logger.box('Failed', [availabilityAction]);
        completeCommand(1);
        return;
      }
    }

    logger.box('Applied', appliedAvailability.actions.map(appliedLine));
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    if (isFailureTag(cause, 'AvailabilityCommandFailure')) {
      throw cause;
    }

    throw commandFailure('run availability command', cause);
  }
}

type AvailabilityOptions = Readonly<{
  readonly app?: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

function readAvailabilityCommand(commandOptions: AvailabilityOptions): AvailabilityCommandInput {
  let availabilityInput: AvailabilityCommandInput = {
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) {
    availabilityInput = { ...availabilityInput, app: commandOptions.app };
  }

  return availabilityInput;
}

export function registerAvailabilityCommand(program: Command): void {
  function runAvailability(commandOptions: AvailabilityOptions) {
    const availability = readAvailabilityCommand(commandOptions);
    const availabilityProgram = availabilityCommandProgram(availability);
    return runCliProgram(availabilityProgram);
  }

  program
    .command('availability')
    .description('set the App Store territories the app sells in, from launch.config.ts')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runAvailability);
}
