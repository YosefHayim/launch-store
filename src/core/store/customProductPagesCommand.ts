import type { FileSystem, Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPromptService } from '../services/prompt.js';
import { completeCommand, type CommandExit } from '../terminal/commandExit.js';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
  resolveStoreSurfaceSection,
} from './appStoreSurfaceCommand.js';
import { loadActiveAppleStore, type ActiveAppleStoreRequirements } from './appleStoreCommand.js';
import {
  parseCustomProductPagesConfig,
  reconcileCustomProductPages,
  summarizeCustomPages,
  type CustomProductPagesConfig,
} from './customProductPages.js';
import { loadStoreAppContext, type StoreAppSelectionRequirements } from './selectStoreApp.js';

export const CustomProductPagesCommandInputSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  config: Schema.String,
  dryRun: Schema.Boolean,
  yes: Schema.Boolean,
});

export type CustomProductPagesCommandInput = Schema.Schema.Type<
  typeof CustomProductPagesCommandInputSchema
>;

/** A custom product pages command step failed. */
export type CustomProductPagesCommandFailure = Readonly<{
  readonly _tag: 'CustomProductPagesCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeCustomProductPagesCommandFailure = Data.tagged<CustomProductPagesCommandFailure>(
  'CustomProductPagesCommandFailure',
);

type CustomProductPagesCommandRequirements =
  | ActiveAppleStoreRequirements
  | FileSystem.FileSystem
  | LaunchPromptService
  | Logger
  | StoreAppSelectionRequirements
  | Terminal.Terminal;

/** Convert a dependency failure into the custom pages command channel. */
const customPagesFailure = (
  operation: string,
  cause: unknown,
): CustomProductPagesCommandFailure => {
  let message = `${operation} failed.`;
  if (typeof cause === 'string' && cause.length > 0) message = cause;
  if (cause instanceof Error) message = cause.message;
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'message' in cause &&
    typeof cause.message === 'string'
  ) {
    message = cause.message;
  }
  return makeCustomProductPagesCommandFailure({ operation, message, cause });
};

/** Resolve the selected bundle id and required custom-pages sidecar. */
const resolveCustomPagesTarget = (
  commandInput: CustomProductPagesCommandInput,
): Effect.Effect<
  Readonly<{ bundleId: string; customPagesConfig: CustomProductPagesConfig }>,
  CustomProductPagesCommandFailure,
  FileSystem.FileSystem | StoreAppSelectionRequirements
> =>
  Effect.gen(function* () {
    const storeAppContext = yield* loadStoreAppContext(commandInput.app).pipe(
      Effect.mapError((cause) => customPagesFailure('select custom pages app', cause)),
    );
    if (storeAppContext.app.bundleId === undefined) {
      return yield* Effect.fail(
        makeCustomProductPagesCommandFailure({
          operation: 'resolve custom pages bundle id',
          message: `No iOS bundle identifier for ${storeAppContext.app.name} (set ios.bundleIdentifier in app.json).`,
          cause: storeAppContext.app,
        }),
      );
    }
    const customPagesConfig = yield* resolveStoreSurfaceSection(
      undefined,
      commandInput.config,
      true,
      parseCustomProductPagesConfig,
    ).pipe(Effect.mapError((cause) => customPagesFailure('resolve custom pages config', cause)));
    if (customPagesConfig === undefined) {
      return yield* Effect.fail(
        makeCustomProductPagesCommandFailure({
          operation: 'resolve custom pages config',
          message: `No custom-pages config at ${commandInput.config}. Create one (see \`launch custom-pages --help\`) or pass --config.`,
          cause: commandInput.config,
        }),
      );
    }
    return { bundleId: storeAppContext.app.bundleId, customPagesConfig };
  });

/** Plan, confirm, and apply custom product page changes. */
const executeCustomProductPages = (
  rawCommandInput: unknown,
): Effect.Effect<number, CustomProductPagesCommandFailure, CustomProductPagesCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(CustomProductPagesCommandInputSchema)(
      rawCommandInput,
    ).pipe(
      Effect.mapError((cause) => customPagesFailure('decode custom pages command input', cause)),
    );
    const customPagesTarget = yield* resolveCustomPagesTarget(commandInput);
    const logger = yield* createLogger(false);
    const appleStore = yield* loadActiveAppleStore().pipe(
      Effect.mapError((cause) => customPagesFailure('load App Store Connect client', cause)),
    );
    const customPagesPlan = yield* reconcileCustomProductPages(appleStore, {
      bundleId: customPagesTarget.bundleId,
      config: customPagesTarget.customPagesConfig,
      dryRun: true,
    }).pipe(Effect.mapError((cause) => customPagesFailure('plan custom page changes', cause)));
    const plannedActions = customPagesPlan.actions.filter(
      (plannedAction) => plannedAction.status === 'planned',
    );
    yield* logger.gap();
    if (customPagesPlan.actions.length === 0) {
      yield* logger.step(customPagesTarget.bundleId, 'custom product pages already in sync');
      return 0;
    }
    yield* logger.notice(
      customPagesTarget.bundleId,
      ...customPagesPlan.actions.map(renderStoreSurfaceAction),
    );
    if (plannedActions.length === 0) {
      yield* logger.gap();
      yield* logger.step('custom-pages', 'nothing to apply (everything already in sync)');
      return 0;
    }
    yield* logger.gap();
    yield* logger.note(`${plannedActions.length} change(s) for ${customPagesTarget.bundleId}.`);
    if (commandInput.dryRun) {
      yield* logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return 0;
    }
    const confirmed = yield* confirmStoreSurfaceWrite(
      `Apply ${plannedActions.length} custom-page change(s) to App Store Connect?`,
      commandInput.yes,
    ).pipe(Effect.mapError((cause) => customPagesFailure('confirm custom page changes', cause)));
    if (!confirmed) return 0;
    const appliedCustomPages = yield* reconcileCustomProductPages(appleStore, {
      bundleId: customPagesTarget.bundleId,
      config: customPagesTarget.customPagesConfig,
      dryRun: false,
    }).pipe(Effect.mapError((cause) => customPagesFailure('apply custom page changes', cause)));
    const customPagesSummary = summarizeCustomPages(appliedCustomPages.actions);
    let receiptTitle = 'Applied';
    if (customPagesSummary.failed > 0) receiptTitle = 'Applied with errors';
    yield* logger.box(
      receiptTitle,
      appliedCustomPages.actions.map(renderAppliedStoreSurfaceAction),
    );
    return customPagesSummary.failed;
  }).pipe(Effect.mapError((cause) => customPagesFailure('run custom pages command', cause)));

/** Run the schema-decoded custom-pages command. */
export const customProductPagesCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<
  void,
  CommandExit | CustomProductPagesCommandFailure,
  CustomProductPagesCommandRequirements
> =>
  Effect.gen(function* () {
    const failureCount = yield* executeCustomProductPages(rawCommandInput);
    if (failureCount > 0) yield* completeCommand(1);
  });
