import { type FileSystem, Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import { CommandExitSchema, completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { PlannedAction } from '../types/reconcile.js';
import { loadActiveAppleStore, type ActiveAppleStoreRequirements } from './appleStoreCommand.js';
import { readAvailabilityConfig, reconcileAvailability } from './availability.js';
import { resolveStoreBundleId, type StoreAppSelectionRequirements } from './selectStoreApp.js';

export const AvailabilityCommandInputSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  config: Schema.String,
  dryRun: Schema.Boolean,
  yes: Schema.Boolean,
});

export type AvailabilityCommandInput = Schema.Schema.Type<typeof AvailabilityCommandInputSchema>;

export const AvailabilityCommandFailureSchema = Schema.Struct({
  _tag: Schema.Literal('AvailabilityCommandFailure'),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
});

export type AvailabilityCommandFailure = Schema.Schema.Type<
  typeof AvailabilityCommandFailureSchema
>;
export const makeAvailabilityCommandFailure = Data.tagged<AvailabilityCommandFailure>(
  'AvailabilityCommandFailure',
);

type AvailabilityCommandRequirements =
  | ActiveAppleStoreRequirements
  | FileSystem.FileSystem
  | Logger
  | LaunchPromptService
  | StoreAppSelectionRequirements
  | Terminal.Terminal;

const commandFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): AvailabilityCommandFailure => {
  let message = errorMessage(cause);
  if (explicitMessage !== undefined) message = explicitMessage;
  return makeAvailabilityCommandFailure({ operation, message, cause });
};

const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, AvailabilityCommandFailure> =>
  logWrite.pipe(Effect.mapError((cause) => commandFailure(operation, cause)));

export const renderAvailabilityAction = (plannedAction: PlannedAction): string => {
  if (plannedAction.status === 'failed') {
    let failureText = 'failed';
    if (plannedAction.error !== undefined) failureText = plannedAction.error;
    return `x ${plannedAction.description} - ${failureText}`;
  }
  if (plannedAction.destructive) return `! ${plannedAction.description}`;
  return `+ ${plannedAction.description}`;
};

export const availabilityConfirmationMessage = (
  plannedAction: PlannedAction | undefined,
): string => {
  if (plannedAction?.destructive === true) {
    return 'This removes the app from sale in some territories. Apply the new store availability?';
  }
  return 'Apply the new store availability?';
};

const confirmAvailabilityWrite = (
  plannedAction: PlannedAction | undefined,
  assumeYes: boolean,
): Effect.Effect<boolean, AvailabilityCommandFailure, LaunchPromptService | Terminal.Terminal> =>
  Effect.gen(function* () {
    if (assumeYes) return true;
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        commandFailure(
          'confirm availability write',
          'confirmation-required',
          'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
        ),
      );
    }
    const prompt = yield* LaunchPrompt;
    const confirmed = yield* prompt
      .confirm(availabilityConfirmationMessage(plannedAction))
      .pipe(Effect.mapError((cause) => commandFailure('confirm availability write', cause)));
    if (confirmed) return true;
    yield* prompt.cancel('Aborted - no changes made.');
    return false;
  });

export const availabilityCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, AvailabilityCommandFailure | CommandExit, AvailabilityCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(AvailabilityCommandInputSchema)(
      rawCommandInput,
    );
    const logger = yield* createLogger(false);
    const availabilityConfig = yield* readAvailabilityConfig(commandInput.config);
    const bundleId = yield* resolveStoreBundleId(commandInput.app);
    const appleStore = yield* loadActiveAppleStore();
    const availabilityPlan = yield* reconcileAvailability(appleStore, {
      bundleId,
      config: availabilityConfig,
      dryRun: true,
    });
    yield* writeLog('open availability plan', logger.gap());
    if (availabilityPlan.actions.length === 0) {
      yield* writeLog(
        'render synchronized availability',
        logger.step(bundleId, 'store availability already in sync'),
      );
      return;
    }
    yield* writeLog(
      'render availability plan',
      logger.notice(bundleId, ...availabilityPlan.actions.map(renderAvailabilityAction)),
    );
    yield* writeLog('separate availability plan', logger.gap());
    if (commandInput.dryRun) {
      yield* writeLog(
        'render availability dry run',
        logger.note('Dry run - no changes made. Re-run without --dry-run to apply.'),
      );
      return;
    }
    const confirmed = yield* confirmAvailabilityWrite(
      availabilityPlan.actions[0],
      commandInput.yes,
    );
    if (!confirmed) return;
    const appliedAvailability = yield* reconcileAvailability(appleStore, {
      bundleId,
      config: availabilityConfig,
      dryRun: false,
    });
    const appliedAction = appliedAvailability.actions[0];
    if (appliedAction?.status === 'failed') {
      yield* writeLog(
        'render failed availability write',
        logger.box('Failed', [renderAvailabilityAction(appliedAction)]),
      );
      yield* completeCommand(1);
      return;
    }
    yield* writeLog(
      'render applied availability',
      logger.box(
        'Applied',
        appliedAvailability.actions.map((completedAction) => `OK ${completedAction.description}`),
      ),
    );
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(CommandExitSchema)(cause)) return cause;
      if (Schema.is(AvailabilityCommandFailureSchema)(cause)) return cause;
      return commandFailure('run availability command', cause);
    }),
  );
