import type { FileSystem, Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPromptService } from '../services/prompt.js';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
  resolveStoreSurfaceSection,
} from '../store/appStoreSurfaceCommand.js';
import {
  loadActiveAppleStore,
  type ActiveAppleStoreRequirements,
} from '../store/appleStoreCommand.js';
import {
  loadStoreAppContext,
  type StoreAppSelectionRequirements,
} from '../store/selectStoreApp.js';
import { completeCommand, type CommandExit } from '../terminal/commandExit.js';
import {
  parseVersionExperimentsConfig,
  reconcileVersionExperiments,
  summarizeExperiments,
  type VersionExperimentsConfig,
} from './versionExperiments.js';

export const VersionExperimentsCommandInputSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  config: Schema.String,
  dryRun: Schema.Boolean,
  yes: Schema.Boolean,
});

export type VersionExperimentsCommandInput = Schema.Schema.Type<
  typeof VersionExperimentsCommandInputSchema
>;

/** A version experiments command step failed. */
export type VersionExperimentsCommandFailure = Readonly<{
  readonly _tag: 'VersionExperimentsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeVersionExperimentsCommandFailure = Data.tagged<VersionExperimentsCommandFailure>(
  'VersionExperimentsCommandFailure',
);

type VersionExperimentsCommandRequirements =
  | ActiveAppleStoreRequirements
  | FileSystem.FileSystem
  | LaunchPromptService
  | Logger
  | StoreAppSelectionRequirements
  | Terminal.Terminal;

/** Convert a dependency failure into the experiments command channel. */
const experimentsFailure = (
  operation: string,
  cause: unknown,
): VersionExperimentsCommandFailure => {
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
  return makeVersionExperimentsCommandFailure({ operation, message, cause });
};

/** Resolve the selected bundle id and required experiments sidecar. */
const resolveExperimentsTarget = (
  commandInput: VersionExperimentsCommandInput,
): Effect.Effect<
  Readonly<{ bundleId: string; experimentsConfig: VersionExperimentsConfig }>,
  VersionExperimentsCommandFailure,
  FileSystem.FileSystem | StoreAppSelectionRequirements
> =>
  Effect.gen(function* () {
    const storeAppContext = yield* loadStoreAppContext(commandInput.app).pipe(
      Effect.mapError((cause) => experimentsFailure('select experiments app', cause)),
    );
    if (storeAppContext.app.bundleId === undefined) {
      return yield* Effect.fail(
        makeVersionExperimentsCommandFailure({
          operation: 'resolve experiments bundle id',
          message: `No iOS bundle identifier for ${storeAppContext.app.name} (set ios.bundleIdentifier in app.json).`,
          cause: storeAppContext.app,
        }),
      );
    }
    const experimentsConfig = yield* resolveStoreSurfaceSection(
      undefined,
      commandInput.config,
      true,
      parseVersionExperimentsConfig,
    ).pipe(Effect.mapError((cause) => experimentsFailure('resolve experiments config', cause)));
    if (experimentsConfig === undefined) {
      return yield* Effect.fail(
        makeVersionExperimentsCommandFailure({
          operation: 'resolve experiments config',
          message: `No experiments config at ${commandInput.config}. Create one (see \`launch experiments --help\`) or pass --config.`,
          cause: commandInput.config,
        }),
      );
    }
    return { bundleId: storeAppContext.app.bundleId, experimentsConfig };
  });

/** Plan, confirm, and apply product-page experiment changes. */
const executeVersionExperiments = (
  rawCommandInput: unknown,
): Effect.Effect<number, VersionExperimentsCommandFailure, VersionExperimentsCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(VersionExperimentsCommandInputSchema)(
      rawCommandInput,
    ).pipe(
      Effect.mapError((cause) => experimentsFailure('decode experiments command input', cause)),
    );
    const experimentsTarget = yield* resolveExperimentsTarget(commandInput);
    const logger = yield* createLogger(false);
    const appleStore = yield* loadActiveAppleStore().pipe(
      Effect.mapError((cause) => experimentsFailure('load App Store Connect client', cause)),
    );
    const experimentsPlan = yield* reconcileVersionExperiments(appleStore, {
      bundleId: experimentsTarget.bundleId,
      config: experimentsTarget.experimentsConfig,
      dryRun: true,
    }).pipe(Effect.mapError((cause) => experimentsFailure('plan experiment changes', cause)));
    const plannedActions = experimentsPlan.actions.filter(
      (plannedAction) => plannedAction.status === 'planned',
    );
    yield* logger.gap();
    if (experimentsPlan.actions.length === 0) {
      yield* logger.step(experimentsTarget.bundleId, 'product-page experiments already in sync');
      return 0;
    }
    yield* logger.notice(
      experimentsTarget.bundleId,
      ...experimentsPlan.actions.map(renderStoreSurfaceAction),
    );
    if (plannedActions.length === 0) {
      yield* logger.gap();
      yield* logger.step('experiments', 'nothing to apply (everything already in sync)');
      return 0;
    }
    yield* logger.gap();
    yield* logger.note(`${plannedActions.length} change(s) for ${experimentsTarget.bundleId}.`);
    if (commandInput.dryRun) {
      yield* logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return 0;
    }
    const confirmed = yield* confirmStoreSurfaceWrite(
      `Apply ${plannedActions.length} experiment change(s) to App Store Connect?`,
      commandInput.yes,
    ).pipe(Effect.mapError((cause) => experimentsFailure('confirm experiment changes', cause)));
    if (!confirmed) return 0;
    const appliedExperiments = yield* reconcileVersionExperiments(appleStore, {
      bundleId: experimentsTarget.bundleId,
      config: experimentsTarget.experimentsConfig,
      dryRun: false,
    }).pipe(Effect.mapError((cause) => experimentsFailure('apply experiment changes', cause)));
    const experimentsSummary = summarizeExperiments(appliedExperiments.actions);
    let receiptTitle = 'Applied';
    if (experimentsSummary.failed > 0) receiptTitle = 'Applied with errors';
    yield* logger.box(
      receiptTitle,
      appliedExperiments.actions.map(renderAppliedStoreSurfaceAction),
    );
    return experimentsSummary.failed;
  }).pipe(Effect.mapError((cause) => experimentsFailure('run experiments command', cause)));

/** Run the schema-decoded experiments command. */
export const versionExperimentsCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<
  void,
  CommandExit | VersionExperimentsCommandFailure,
  VersionExperimentsCommandRequirements
> =>
  Effect.gen(function* () {
    const failureCount = yield* executeVersionExperiments(rawCommandInput);
    if (failureCount > 0) yield* completeCommand(1);
  });
