import { type FileSystem, type Path, Terminal } from '@effect/platform';
import { Data, Effect } from 'effect';
import { selectApp } from '../build/pipelineEnv.js';
import { loadConfig } from '../config/config.js';
import { loadActiveAscKey } from '../credentials/accounts.js';
import {
  AppleStoreClientService,
  type AppleStoreClientService as AppleStoreClientDependencies,
} from '../services/appleStoreClient.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import { completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { PlannedAction } from '../types/reconcile.js';
import {
  loadAccessibilityConfig,
  reconcileAccessibility,
  summarizeAccessibility,
} from './accessibility.js';

/** Inputs accepted by the accessibility command. */
export type AccessibilityCommandInput = Readonly<{
  app?: string;
  configPath: string;
  dryRun: boolean;
  yes: boolean;
}>;

/** Accessibility configuration or reconciliation failed. */
export type AccessibilityCommandFailure = Readonly<{
  readonly _tag: 'AccessibilityCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeAccessibilityCommandFailure = Data.tagged<AccessibilityCommandFailure>(
  'AccessibilityCommandFailure',
);

/** Convert an unknown cause to the command's tagged channel. */
const accessibilityFailure = (
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): AccessibilityCommandFailure => {
  let message = fallbackMessage;
  if (message === undefined && cause instanceof Error) message = cause.message;
  if (message === undefined) message = `${operation} failed.`;
  return makeAccessibilityCommandFailure({ operation, message, cause });
};

/** Map one logger write to the accessibility command channel. */
const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, AccessibilityCommandFailure> =>
  logWrite.pipe(Effect.mapError((cause) => accessibilityFailure(operation, cause)));

/** Render one accessibility action with an ASCII status marker. */
export const renderAccessibilityAction = (plannedAction: PlannedAction): string => {
  if (plannedAction.status !== 'failed') return `+ ${plannedAction.description}`;
  let errorDetail = '';
  if (plannedAction.error !== undefined) errorDetail = ` - ${plannedAction.error}`;
  return `x ${plannedAction.description}${errorDetail}`;
};

/** Reconcile accessibility declarations for the selected App Store app. */
export const accessibilityCommandProgram = (
  commandInput: AccessibilityCommandInput,
): Effect.Effect<
  void,
  AccessibilityCommandFailure | CommandExit,
  | AppleStoreClientDependencies
  | FileSystem.FileSystem
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | Terminal.Terminal
> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const loadedConfiguration = yield* loadConfig().pipe(
      Effect.mapError((cause) => accessibilityFailure('load Launch configuration', cause)),
    );
    const selectedApp = yield* selectApp(loadedConfiguration.apps, commandInput.app).pipe(
      Effect.mapError((cause) => accessibilityFailure('select app', cause, cause.message)),
    );
    const bundleId = selectedApp.bundleId;
    if (bundleId === undefined) {
      return yield* Effect.fail(
        accessibilityFailure(
          'resolve iOS bundle identifier',
          selectedApp,
          `No iOS bundle identifier for ${selectedApp.name} (set ios.bundleIdentifier in app.json).`,
        ),
      );
    }
    const accessibilityConfig = yield* loadAccessibilityConfig(commandInput.configPath).pipe(
      Effect.mapError((cause) => accessibilityFailure('load accessibility configuration', cause)),
    );
    const ascKey = yield* loadActiveAscKey().pipe(
      Effect.mapError((cause) => accessibilityFailure('load active Apple account', cause)),
    );
    if (ascKey === null) {
      return yield* Effect.fail(
        accessibilityFailure(
          'load active Apple account',
          bundleId,
          'No active Apple account. Run `launch creds set-key` first.',
        ),
      );
    }
    const appleStoreClient = yield* AppleStoreClientService;
    const ascClient = yield* appleStoreClient
      .createEffectClient(ascKey)
      .pipe(Effect.mapError((cause) => accessibilityFailure('create App Store client', cause)));
    const accessibilityPlan = yield* reconcileAccessibility(ascClient, {
      bundleId,
      config: accessibilityConfig,
      dryRun: true,
    }).pipe(Effect.mapError((cause) => accessibilityFailure('plan accessibility changes', cause)));
    const plannedActions = accessibilityPlan.actions.filter(
      (plannedAction) => plannedAction.status === 'planned',
    );
    yield* writeLog('render accessibility plan', logger.gap());
    if (accessibilityPlan.actions.length === 0) {
      yield* writeLog(
        'render accessibility plan',
        logger.step(bundleId, 'accessibility declarations already in sync'),
      );
      return;
    }
    yield* writeLog(
      'render accessibility plan',
      logger.notice(bundleId, ...accessibilityPlan.actions.map(renderAccessibilityAction)),
    );
    yield* writeLog('render accessibility plan', logger.gap());
    yield* writeLog(
      'render accessibility summary',
      logger.note(`${plannedActions.length} change(s) for ${bundleId}.`),
    );
    if (commandInput.dryRun) {
      yield* writeLog(
        'render accessibility dry run',
        logger.note('Dry run - no changes made. Re-run without --dry-run to apply.'),
      );
      return;
    }
    if (!commandInput.yes) {
      const terminal = yield* Terminal.Terminal;
      const terminalIsInteractive = yield* terminal.isTTY;
      if (!terminalIsInteractive) {
        return yield* Effect.fail(
          accessibilityFailure(
            'confirm accessibility changes',
            commandInput,
            'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
          ),
        );
      }
      const launchPrompt = yield* LaunchPrompt;
      const confirmed = yield* launchPrompt
        .confirm(`Apply ${plannedActions.length} accessibility change(s) to App Store Connect?`)
        .pipe(
          Effect.mapError((cause) => accessibilityFailure('confirm accessibility changes', cause)),
        );
      if (!confirmed) {
        yield* launchPrompt.cancel('Aborted - no changes made.');
        return;
      }
    }
    const appliedAccessibility = yield* reconcileAccessibility(ascClient, {
      bundleId,
      config: accessibilityConfig,
      dryRun: false,
    }).pipe(Effect.mapError((cause) => accessibilityFailure('apply accessibility changes', cause)));
    const accessibilitySummary = summarizeAccessibility(appliedAccessibility.actions);
    const receiptLines = appliedAccessibility.actions.map((appliedAction) => {
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
    if (accessibilitySummary.failed > 0) receiptTitle = 'Applied with errors';
    yield* writeLog('render applied accessibility changes', logger.box(receiptTitle, receiptLines));
    if (accessibilitySummary.failed > 0) yield* completeCommand(1);
  });
