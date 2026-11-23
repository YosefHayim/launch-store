// Plans Game Center changes and applies them on App Store Connect.

import { createLogger } from '@/services/platform/logger.js';
import { completeCommand } from '@/terminal/command-exit.js';
import type { GameCenterConfig } from '@/types/store-surface.js';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
} from './app-store-surface-command.ts';
import { loadActiveAppleStore } from './apple-store-command.ts';
import { reconcileGameCenter } from '@/store/apple/game-center.js';
import { summarize } from '@/store/shared/reconcile.js';
import { loadStoreAppContext } from '@/store/shared/select-store-app.js';
import { hasMessage } from '@/services/platform/error-message.js';
import { readPlainObject } from '@/services/platform/plain-object.js';

export type GameCenterCommandInput = Readonly<{
  app?: string;
  dryRun: boolean;
  yes: boolean;
}>;

/** Decode one Game Center command. Rejects an explicit undefined exact optional app. */
export function GameCenterCommandInputSchema(rawCommandInput: unknown): GameCenterCommandInput {
  const commandRecord = readPlainObject(rawCommandInput);

  if (commandRecord == null) {
    throw new Error('Game Center command input must be an object.');
  }

  const dryRun = commandRecord['dryRun'];
  const yes = commandRecord['yes'];
  const isDryRunFlag = typeof dryRun == 'boolean';

  if (isDryRunFlag == false) {
    throw new Error('Expected dryRun to be a boolean.');
  }

  const isYesFlag = typeof yes == 'boolean';

  if (isYesFlag == false) {
    throw new Error('Expected yes to be a boolean.');
  }

  const hasApp = Object.hasOwn(commandRecord, 'app');

  if (hasApp == false) {
    return { dryRun, yes };
  }

  const app = commandRecord['app'];
  const isAppText = typeof app == 'string';

  if (isAppText == false) {
    throw new Error('Expected app to be a string.');
  }

  return { app, dryRun, yes };
}

/** A Game Center command step failed. */
type GameCenterCommandFailure = Readonly<{
  readonly _tag: 'GameCenterCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeGameCenterCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): GameCenterCommandFailure {
  return { _tag: 'GameCenterCommandFailure', ...fields };
}

function readNonEmptyText(cause: unknown): string | null {
  const isNotText = typeof cause != 'string';

  if (isNotText) return null;

  const isEmpty = cause.length == 0;

  if (isEmpty) return null;

  return cause;
}

function readCauseMessage(cause: unknown, fallback: string): string {
  const textMessage = readNonEmptyText(cause);

  if (textMessage != null) return textMessage;

  const hasCauseMessage = hasMessage(cause);

  if (hasCauseMessage) return cause.message;

  return fallback;
}

/** Convert a dependency failure into the Game Center command channel. */
function gameCenterFailure(operation: string, cause: unknown): GameCenterCommandFailure {
  const message = readCauseMessage(cause, `${operation} failed.`);
  return makeGameCenterCommandFailure({ operation, message, cause });
}

/** Resolve the selected bundle id and its Game Center declaration. */
async function resolveGameCenterTarget(
  commandInput: GameCenterCommandInput,
): Promise<Readonly<{ bundleId: string; gameCenterConfig: GameCenterConfig }>> {
  let storeAppContext: Awaited<ReturnType<typeof loadStoreAppContext>>;

  try {
    storeAppContext = await loadStoreAppContext(commandInput.app);
  } catch (cause) {
    throw gameCenterFailure('select Game Center app', cause);
  }

  const bundleId = storeAppContext.app.bundleId;

  const isBundleMissing = bundleId == null;

  if (isBundleMissing) {
    throw makeGameCenterCommandFailure({
      operation: 'resolve Game Center bundle id',
      message: `No iOS bundle identifier for ${storeAppContext.app.name} (set ios.bundleIdentifier in app.json).`,
      cause: storeAppContext.app,
    });
  }

  const gameCenterSection = storeAppContext.config.gameCenter?.[bundleId];

  const isGameCenterMissing = gameCenterSection == null;

  if (isGameCenterMissing) {
    throw makeGameCenterCommandFailure({
      operation: 'resolve Game Center config',
      message: `No Game Center config for ${bundleId}. Add a gameCenter entry to launch.config.ts.`,
      cause: bundleId,
    });
  }

  return { bundleId, gameCenterConfig: gameCenterSection };
}

function isPlannedAction(plannedAction: { status: string }): boolean {
  return plannedAction.status == 'planned';
}

/** Plan, confirm, and apply Game Center changes. */
async function executeGameCenter(rawCommandInput: unknown): Promise<number> {
  try {
    let commandInput: GameCenterCommandInput;

    try {
      commandInput = GameCenterCommandInputSchema(rawCommandInput);
    } catch (cause) {
      throw gameCenterFailure('decode Game Center command input', cause);
    }

    const gameCenterTarget = await resolveGameCenterTarget(commandInput);
    const logger = createLogger(false);
    let appleStore: Awaited<ReturnType<typeof loadActiveAppleStore>>;

    try {
      appleStore = await loadActiveAppleStore();
    } catch (cause) {
      throw gameCenterFailure('load App Store Connect client', cause);
    }

    let gameCenterPlan: Awaited<ReturnType<typeof reconcileGameCenter>>;

    try {
      gameCenterPlan = await reconcileGameCenter(appleStore, {
        bundleId: gameCenterTarget.bundleId,
        config: gameCenterTarget.gameCenterConfig,
        dryRun: true,
      });
    } catch (cause) {
      throw gameCenterFailure('plan Game Center changes', cause);
    }

    const plannedActions = gameCenterPlan.actions.filter(isPlannedAction);

    logger.gap();

    const isAlreadyInSync = gameCenterPlan.actions.length == 0;

    if (isAlreadyInSync) {
      logger.step(
        gameCenterTarget.bundleId,
        'Game Center achievements & leaderboards already in sync',
      );

      return 0;
    }

    const actionLines = gameCenterPlan.actions.map(renderStoreSurfaceAction);

    logger.notice(gameCenterTarget.bundleId, ...actionLines);

    const hasNothingToApply = plannedActions.length == 0;

    if (hasNothingToApply) {
      logger.gap();
      logger.step('game-center', 'nothing to apply (everything already in sync)');
      return 0;
    }

    logger.gap();
    logger.note(`${plannedActions.length} change(s) for ${gameCenterTarget.bundleId}.`);

    const isDryRun = commandInput.dryRun == true;

    if (isDryRun) {
      logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return 0;
    }

    let confirmed = false;

    try {
      confirmed = await confirmStoreSurfaceWrite(
        `Apply ${plannedActions.length} Game Center change(s) to App Store Connect?`,
        commandInput.yes,
      );
    } catch (cause) {
      throw gameCenterFailure('confirm Game Center changes', cause);
    }

    const wasDeclined = confirmed == false;

    if (wasDeclined) {
      return 0;
    }

    let appliedGameCenter: Awaited<ReturnType<typeof reconcileGameCenter>>;

    try {
      appliedGameCenter = await reconcileGameCenter(appleStore, {
        bundleId: gameCenterTarget.bundleId,
        config: gameCenterTarget.gameCenterConfig,
        dryRun: false,
      });
    } catch (cause) {
      throw gameCenterFailure('apply Game Center changes', cause);
    }

    const gameCenterSummary = summarize(appliedGameCenter.actions);
    let receiptTitle = 'Applied';

    const hasFailures = gameCenterSummary.failed > 0;

    if (hasFailures) {
      receiptTitle = 'Applied with errors';
    }

    const receiptLines = appliedGameCenter.actions.map(renderAppliedStoreSurfaceAction);

    logger.box(receiptTitle, receiptLines);

    return gameCenterSummary.failed;
  } catch (cause) {
    throw gameCenterFailure('run Game Center command', cause);
  }
}

/** Run the schema-decoded Game Center command. */
export async function gameCenterCommandProgram(rawCommandInput: unknown): Promise<void> {
  const failureCount = await executeGameCenter(rawCommandInput);

  const hasFailures = failureCount > 0;

  if (hasFailures) {
    completeCommand(1);
  }
}
