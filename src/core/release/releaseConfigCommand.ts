import { type FileSystem, type Path, Terminal } from '@effect/platform';
import { Data, Effect } from 'effect';
import { selectApp } from '../build/pipelineEnv.js';
import { loadConfig } from '../config/config.js';
import { loadActiveAscKey } from '../credentials/accounts.js';
import {
  AppleStoreClientService,
  type AppleStoreClientService as AppleStoreClientDependencies,
} from '../services/appleStoreClient.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import { completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { PlannedAction } from '../types/reconcile.js';
import { resolveStoreSurfaceSection } from '../store/appStoreSurfaceCommand.js';
import { summarize } from '../store/reconcile.js';
import { parseReleaseConfig, reconcileRelease } from './releaseAttrs.js';

/** Inputs resolved from Commander for App Store release-attribute reconciliation. */
export type ReleaseConfigCommandInput = Readonly<{
  app?: string;
  configPath: string;
  explicitConfigPath: boolean;
  dryRun: boolean;
  yes: boolean;
}>;

/** Release-attribute configuration or transport work failed. */
export type ReleaseConfigCommandFailure = Readonly<{
  readonly _tag: 'ReleaseConfigCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeReleaseConfigCommandFailure = Data.tagged<ReleaseConfigCommandFailure>(
  'ReleaseConfigCommandFailure',
);

/** Convert an unknown cause to the release-config failure channel. */
const releaseConfigFailure = (
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): ReleaseConfigCommandFailure => {
  let message = fallbackMessage;
  if (message === undefined && cause instanceof Error) message = cause.message;
  if (message === undefined) message = `${operation} failed.`;
  return makeReleaseConfigCommandFailure({ operation, message, cause });
};

/** Map one logger write into the command failure channel. */
const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, ReleaseConfigCommandFailure> =>
  logWrite.pipe(Effect.mapError((cause) => releaseConfigFailure(operation, cause)));

/** Render one planned, skipped, applied, or failed action with ASCII markers. */
export const renderAction = (plannedAction: PlannedAction): string => {
  if (plannedAction.status === 'skipped') return `- ${plannedAction.description}`;
  if (plannedAction.status === 'failed') {
    let errorDetail = '';
    if (plannedAction.error !== undefined) errorDetail = ` - ${plannedAction.error}`;
    return `x ${plannedAction.description}${errorDetail}`;
  }
  return `+ ${plannedAction.description}`;
};

/** Reconcile one app's release attributes through the active Apple account. */
export const releaseConfigCommandProgram = (
  commandInput: ReleaseConfigCommandInput,
): Effect.Effect<
  void,
  CommandExit | ReleaseConfigCommandFailure,
  | AppleStoreClientDependencies
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | Terminal.Terminal
> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const launchPrompt = yield* LaunchPrompt;
    const terminal = yield* Terminal.Terminal;
    const terminalIsInteractive = yield* terminal.isTTY;
    const loadedConfiguration = yield* loadConfig().pipe(
      Effect.mapError((cause) => releaseConfigFailure('load Launch configuration', cause)),
    );
    const selectedApp = yield* selectApp(loadedConfiguration.apps, commandInput.app).pipe(
      Effect.mapError((cause) => releaseConfigFailure('select app', cause, cause.message)),
    );
    const bundleId = selectedApp.bundleId;
    if (bundleId === undefined) {
      return yield* Effect.fail(
        releaseConfigFailure(
          'resolve iOS bundle identifier',
          selectedApp,
          `No iOS bundle identifier for ${selectedApp.name} (set ios.bundleIdentifier in app.json).`,
        ),
      );
    }
    const releaseAttributes = yield* resolveStoreSurfaceSection(
      loadedConfiguration.config.releaseAttributes?.[bundleId],
      commandInput.configPath,
      commandInput.explicitConfigPath,
      parseReleaseConfig,
    ).pipe(Effect.mapError((cause) => releaseConfigFailure('load release attributes', cause)));
    if (releaseAttributes === undefined) {
      return yield* Effect.fail(
        releaseConfigFailure(
          'load release attributes',
          commandInput.configPath,
          `No release attributes for ${bundleId}. Add a releaseAttributes entry to launch.config.ts or create ${commandInput.configPath}.`,
        ),
      );
    }
    const ascKey = yield* loadActiveAscKey().pipe(
      Effect.mapError((cause) => releaseConfigFailure('load active Apple account', cause)),
    );
    if (ascKey === null) {
      return yield* Effect.fail(
        releaseConfigFailure(
          'load active Apple account',
          bundleId,
          'No active Apple account. Run `launch creds set-key` first.',
        ),
      );
    }
    const appleStoreClient = yield* AppleStoreClientService;
    const ascClient = yield* appleStoreClient
      .createReleaseAttributesClient(ascKey)
      .pipe(Effect.mapError((cause) => releaseConfigFailure('create App Store client', cause)));
    const releasePlan = yield* reconcileRelease(ascClient, {
      bundleId,
      config: releaseAttributes,
      dryRun: true,
    }).pipe(Effect.mapError((cause) => releaseConfigFailure('plan release attributes', cause)));
    const plannedActions = releasePlan.actions.filter(
      (plannedAction) => plannedAction.status === 'planned',
    );
    yield* writeLog('render release attributes plan', logger.gap());
    if (releasePlan.actions.length === 0) {
      yield* writeLog(
        'render release attributes plan',
        logger.step(bundleId, 'release attributes already in sync'),
      );
      return;
    }
    yield* writeLog(
      'render release attributes plan',
      logger.notice(bundleId, ...releasePlan.actions.map(renderAction)),
    );
    if (plannedActions.length === 0) {
      yield* writeLog('render release attributes plan', logger.gap());
      yield* writeLog(
        'render release attributes plan',
        logger.step(
          'release-config',
          'nothing to apply (everything in sync; skipped areas need a version first)',
        ),
      );
      return;
    }
    yield* writeLog('render release attributes plan', logger.gap());
    yield* writeLog(
      'render release attributes summary',
      logger.note(`${plannedActions.length} change(s) for ${bundleId}.`),
    );
    if (commandInput.dryRun) {
      yield* writeLog(
        'render release attributes dry run',
        logger.note('Dry run - no changes made. Re-run without --dry-run to apply.'),
      );
      return;
    }
    if (!commandInput.yes) {
      if (!terminalIsInteractive) {
        return yield* Effect.fail(
          releaseConfigFailure(
            'confirm release attributes',
            commandInput,
            'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
          ),
        );
      }
      const confirmed = yield* launchPrompt
        .confirm(`Apply ${plannedActions.length} change(s) to App Store Connect?`)
        .pipe(
          Effect.mapError((cause) => releaseConfigFailure('confirm release attributes', cause)),
        );
      if (!confirmed) {
        yield* launchPrompt.cancel('Aborted - no changes made.');
        return;
      }
    }
    const appliedRelease = yield* reconcileRelease(ascClient, {
      bundleId,
      config: releaseAttributes,
      dryRun: false,
    }).pipe(Effect.mapError((cause) => releaseConfigFailure('apply release attributes', cause)));
    const releaseSummary = summarize(appliedRelease.actions);
    const receiptLines = appliedRelease.actions.map((appliedAction) => {
      if (appliedAction.status === 'failed') {
        let errorDetail = 'failed';
        if (appliedAction.error !== undefined) errorDetail = appliedAction.error;
        return `x ${appliedAction.description} - ${errorDetail}`;
      }
      let marker = 'OK';
      if (appliedAction.status === 'skipped') marker = '-';
      return `${marker} ${appliedAction.description}`;
    });
    let receiptTitle = 'Applied';
    if (releaseSummary.failed > 0) receiptTitle = 'Applied with errors';
    yield* writeLog('render applied release attributes', logger.box(receiptTitle, receiptLines));
    if (releaseSummary.failed > 0) yield* completeCommand(1);
  });
