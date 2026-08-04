import type { FileSystem, Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPromptService } from '../services/prompt.js';
import { completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { GameCenterConfig } from '../types/storeSurface.js';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
  resolveStoreSurfaceSection,
} from './appStoreSurfaceCommand.js';
import { loadActiveAppleStore, type ActiveAppleStoreRequirements } from './appleStoreCommand.js';
import { parseGameCenterConfig, reconcileGameCenter } from './gameCenter.js';
import { summarize } from './reconcile.js';
import { loadStoreAppContext, type StoreAppSelectionRequirements } from './selectStoreApp.js';

export const GameCenterCommandInputSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  config: Schema.String,
  explicitConfig: Schema.Boolean,
  dryRun: Schema.Boolean,
  yes: Schema.Boolean,
});

export type GameCenterCommandInput = Schema.Schema.Type<typeof GameCenterCommandInputSchema>;

/** A Game Center command step failed. */
export type GameCenterCommandFailure = Readonly<{
  readonly _tag: 'GameCenterCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeGameCenterCommandFailure = Data.tagged<GameCenterCommandFailure>(
  'GameCenterCommandFailure',
);

type GameCenterCommandRequirements =
  | ActiveAppleStoreRequirements
  | FileSystem.FileSystem
  | LaunchPromptService
  | Logger
  | StoreAppSelectionRequirements
  | Terminal.Terminal;

/** Convert a dependency failure into the Game Center command channel. */
const gameCenterFailure = (operation: string, cause: unknown): GameCenterCommandFailure => {
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
  return makeGameCenterCommandFailure({ operation, message, cause });
};

/** Resolve the selected bundle id and its Game Center declaration. */
const resolveGameCenterTarget = (
  commandInput: GameCenterCommandInput,
): Effect.Effect<
  Readonly<{ bundleId: string; gameCenterConfig: GameCenterConfig }>,
  GameCenterCommandFailure,
  FileSystem.FileSystem | StoreAppSelectionRequirements
> =>
  Effect.gen(function* () {
    const storeAppContext = yield* loadStoreAppContext(commandInput.app).pipe(
      Effect.mapError((cause) => gameCenterFailure('select Game Center app', cause)),
    );
    if (storeAppContext.app.bundleId === undefined) {
      return yield* Effect.fail(
        makeGameCenterCommandFailure({
          operation: 'resolve Game Center bundle id',
          message: `No iOS bundle identifier for ${storeAppContext.app.name} (set ios.bundleIdentifier in app.json).`,
          cause: storeAppContext.app,
        }),
      );
    }
    const bundleId = storeAppContext.app.bundleId;
    let typedGameCenterConfig: GameCenterConfig | undefined;
    if (storeAppContext.config.gameCenter !== undefined) {
      typedGameCenterConfig = storeAppContext.config.gameCenter[bundleId];
    }
    const gameCenterConfig = yield* resolveStoreSurfaceSection(
      typedGameCenterConfig,
      commandInput.config,
      commandInput.explicitConfig,
      parseGameCenterConfig,
    ).pipe(Effect.mapError((cause) => gameCenterFailure('resolve Game Center config', cause)));
    if (gameCenterConfig === undefined) {
      return yield* Effect.fail(
        makeGameCenterCommandFailure({
          operation: 'resolve Game Center config',
          message: `No Game Center config for ${bundleId}. Add a \`gameCenter\` entry to launch.config.ts or create ${commandInput.config}.`,
          cause: commandInput.config,
        }),
      );
    }
    return { bundleId, gameCenterConfig };
  });

/** Plan, confirm, and apply Game Center changes. */
const executeGameCenter = (
  rawCommandInput: unknown,
): Effect.Effect<number, GameCenterCommandFailure, GameCenterCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(GameCenterCommandInputSchema)(
      rawCommandInput,
    ).pipe(
      Effect.mapError((cause) => gameCenterFailure('decode Game Center command input', cause)),
    );
    const gameCenterTarget = yield* resolveGameCenterTarget(commandInput);
    const logger = yield* createLogger(false);
    const appleStore = yield* loadActiveAppleStore().pipe(
      Effect.mapError((cause) => gameCenterFailure('load App Store Connect client', cause)),
    );
    const gameCenterPlan = yield* reconcileGameCenter(appleStore, {
      bundleId: gameCenterTarget.bundleId,
      config: gameCenterTarget.gameCenterConfig,
      dryRun: true,
    }).pipe(Effect.mapError((cause) => gameCenterFailure('plan Game Center changes', cause)));
    const plannedActions = gameCenterPlan.actions.filter(
      (plannedAction) => plannedAction.status === 'planned',
    );
    yield* logger.gap();
    if (gameCenterPlan.actions.length === 0) {
      yield* logger.step(
        gameCenterTarget.bundleId,
        'Game Center achievements & leaderboards already in sync',
      );
      return 0;
    }
    yield* logger.notice(
      gameCenterTarget.bundleId,
      ...gameCenterPlan.actions.map(renderStoreSurfaceAction),
    );
    if (plannedActions.length === 0) {
      yield* logger.gap();
      yield* logger.step('game-center', 'nothing to apply (everything already in sync)');
      return 0;
    }
    yield* logger.gap();
    yield* logger.note(`${plannedActions.length} change(s) for ${gameCenterTarget.bundleId}.`);
    if (commandInput.dryRun) {
      yield* logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return 0;
    }
    const confirmed = yield* confirmStoreSurfaceWrite(
      `Apply ${plannedActions.length} Game Center change(s) to App Store Connect?`,
      commandInput.yes,
    ).pipe(Effect.mapError((cause) => gameCenterFailure('confirm Game Center changes', cause)));
    if (!confirmed) return 0;
    const appliedGameCenter = yield* reconcileGameCenter(appleStore, {
      bundleId: gameCenterTarget.bundleId,
      config: gameCenterTarget.gameCenterConfig,
      dryRun: false,
    }).pipe(Effect.mapError((cause) => gameCenterFailure('apply Game Center changes', cause)));
    const gameCenterSummary = summarize(appliedGameCenter.actions);
    let receiptTitle = 'Applied';
    if (gameCenterSummary.failed > 0) receiptTitle = 'Applied with errors';
    yield* logger.box(receiptTitle, appliedGameCenter.actions.map(renderAppliedStoreSurfaceAction));
    return gameCenterSummary.failed;
  }).pipe(Effect.mapError((cause) => gameCenterFailure('run Game Center command', cause)));

/** Run the schema-decoded Game Center command. */
export const gameCenterCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, CommandExit | GameCenterCommandFailure, GameCenterCommandRequirements> =>
  Effect.gen(function* () {
    const failureCount = yield* executeGameCenter(rawCommandInput);
    if (failureCount > 0) yield* completeCommand(1);
  });
