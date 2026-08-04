import type { FileSystem, Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPromptService } from '../services/prompt.js';
import { completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { AppClipsConfig } from '../types/storeSurface.js';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
  resolveStoreSurfaceSection,
} from './appStoreSurfaceCommand.js';
import { loadActiveAppleStore, type ActiveAppleStoreRequirements } from './appleStoreCommand.js';
import { parseAppClipsConfig, reconcileAppClips } from './appClips.js';
import { summarize } from './reconcile.js';
import { loadStoreAppContext, type StoreAppSelectionRequirements } from './selectStoreApp.js';

export const AppClipsCommandInputSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  config: Schema.String,
  explicitConfig: Schema.Boolean,
  dryRun: Schema.Boolean,
  yes: Schema.Boolean,
});

export type AppClipsCommandInput = Schema.Schema.Type<typeof AppClipsCommandInputSchema>;

/** An App Clips command step failed. */
export type AppClipsCommandFailure = Readonly<{
  readonly _tag: 'AppClipsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeAppClipsCommandFailure =
  Data.tagged<AppClipsCommandFailure>('AppClipsCommandFailure');

type AppClipsCommandRequirements =
  | ActiveAppleStoreRequirements
  | FileSystem.FileSystem
  | LaunchPromptService
  | Logger
  | StoreAppSelectionRequirements
  | Terminal.Terminal;

/** Convert a dependency failure into the App Clips command channel. */
const appClipsFailure = (operation: string, cause: unknown): AppClipsCommandFailure => {
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
  return makeAppClipsCommandFailure({ operation, message, cause });
};

/** Resolve the selected bundle id and its App Clips declaration. */
const resolveAppClipsTarget = (
  commandInput: AppClipsCommandInput,
): Effect.Effect<
  Readonly<{ bundleId: string; appClipsConfig: AppClipsConfig }>,
  AppClipsCommandFailure,
  FileSystem.FileSystem | StoreAppSelectionRequirements
> =>
  Effect.gen(function* () {
    const storeAppContext = yield* loadStoreAppContext(commandInput.app).pipe(
      Effect.mapError((cause) => appClipsFailure('select App Clips app', cause)),
    );
    if (storeAppContext.app.bundleId === undefined) {
      return yield* Effect.fail(
        makeAppClipsCommandFailure({
          operation: 'resolve App Clips bundle id',
          message: `No iOS bundle identifier for ${storeAppContext.app.name} (set ios.bundleIdentifier in app.json).`,
          cause: storeAppContext.app,
        }),
      );
    }
    const bundleId = storeAppContext.app.bundleId;
    let typedAppClipsConfig: AppClipsConfig | undefined;
    if (storeAppContext.config.appClips !== undefined) {
      typedAppClipsConfig = storeAppContext.config.appClips[bundleId];
    }
    const appClipsConfig = yield* resolveStoreSurfaceSection(
      typedAppClipsConfig,
      commandInput.config,
      commandInput.explicitConfig,
      parseAppClipsConfig,
    ).pipe(Effect.mapError((cause) => appClipsFailure('resolve App Clips config', cause)));
    if (appClipsConfig === undefined) {
      return yield* Effect.fail(
        makeAppClipsCommandFailure({
          operation: 'resolve App Clips config',
          message: `No App Clips config for ${bundleId}. Add an \`appClips\` entry to launch.config.ts or create ${commandInput.config}.`,
          cause: commandInput.config,
        }),
      );
    }
    return { bundleId, appClipsConfig };
  });

/** Plan, confirm, and apply App Clip card changes. */
const executeAppClips = (
  rawCommandInput: unknown,
): Effect.Effect<number, AppClipsCommandFailure, AppClipsCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(AppClipsCommandInputSchema)(
      rawCommandInput,
    ).pipe(Effect.mapError((cause) => appClipsFailure('decode App Clips command input', cause)));
    const appClipsTarget = yield* resolveAppClipsTarget(commandInput);
    const logger = yield* createLogger(false);
    const appleStore = yield* loadActiveAppleStore().pipe(
      Effect.mapError((cause) => appClipsFailure('load App Store Connect client', cause)),
    );
    const appClipsPlan = yield* reconcileAppClips(appleStore, {
      bundleId: appClipsTarget.bundleId,
      config: appClipsTarget.appClipsConfig,
      dryRun: true,
    }).pipe(Effect.mapError((cause) => appClipsFailure('plan App Clip changes', cause)));
    const plannedActions = appClipsPlan.actions.filter(
      (plannedAction) => plannedAction.status === 'planned',
    );
    yield* logger.gap();
    if (appClipsPlan.actions.length === 0) {
      yield* logger.step(appClipsTarget.bundleId, 'App Clip cards already in sync');
      return 0;
    }
    yield* logger.notice(
      appClipsTarget.bundleId,
      ...appClipsPlan.actions.map(renderStoreSurfaceAction),
    );
    if (plannedActions.length === 0) {
      yield* logger.gap();
      yield* logger.step(
        'app-clips',
        'nothing to apply (everything in sync; skipped clips need a build or version first)',
      );
      return 0;
    }
    yield* logger.gap();
    yield* logger.note(`${plannedActions.length} change(s) for ${appClipsTarget.bundleId}.`);
    if (commandInput.dryRun) {
      yield* logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return 0;
    }
    const confirmed = yield* confirmStoreSurfaceWrite(
      `Apply ${plannedActions.length} App Clip change(s) to App Store Connect?`,
      commandInput.yes,
    ).pipe(Effect.mapError((cause) => appClipsFailure('confirm App Clip changes', cause)));
    if (!confirmed) return 0;
    const appliedAppClips = yield* reconcileAppClips(appleStore, {
      bundleId: appClipsTarget.bundleId,
      config: appClipsTarget.appClipsConfig,
      dryRun: false,
    }).pipe(Effect.mapError((cause) => appClipsFailure('apply App Clip changes', cause)));
    const appClipsSummary = summarize(appliedAppClips.actions);
    let receiptTitle = 'Applied';
    if (appClipsSummary.failed > 0) receiptTitle = 'Applied with errors';
    yield* logger.box(receiptTitle, appliedAppClips.actions.map(renderAppliedStoreSurfaceAction));
    return appClipsSummary.failed;
  }).pipe(Effect.mapError((cause) => appClipsFailure('run App Clips command', cause)));

/** Run the schema-decoded App Clips command. */
export const appClipsCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, CommandExit | AppClipsCommandFailure, AppClipsCommandRequirements> =>
  Effect.gen(function* () {
    const failureCount = yield* executeAppClips(rawCommandInput);
    if (failureCount > 0) yield* completeCommand(1);
  });
