// Plans Game Center changes and applies them on App Store Connect.

import { completeCommand } from '../terminal/command-exit.ts';
import type { GameCenterConfig } from '../types/store-surface.ts';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
} from './app-store-surface-command.ts';
import { loadActiveAppleStore } from './apple-store-command.ts';
import { reconcileGameCenter } from './game-center.ts';
import { summarize } from '../store/shared/reconcile.ts';
import { loadStoreAppContext } from '../store/shared/select-store-app.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import type { Command } from '../cli/command.ts';
import { runCliProgram } from '../cli/run-cli-program.ts';
import { redactText } from '../services/platform/redact.ts';

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

/** Read the selected bundle id and its Game Center declaration. */
async function readGameCenterTarget(
  commandInput: GameCenterCommandInput,
): Promise<Readonly<{ bundleId: string; gameCenterConfig: GameCenterConfig }>> {
  try {
    var storeAppContext = await loadStoreAppContext(commandInput.app);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  const bundleId = storeAppContext.app.bundleId;

  const isBundleMissing = bundleId == null;

  if (isBundleMissing) {
    throw new Error(
      `No iOS bundle identifier for ${storeAppContext.app.name} (set ios.bundleIdentifier in app.json).`,
      { cause: storeAppContext.app },
    );
  }

  const gameCenterSection = storeAppContext.config.gameCenter?.[bundleId];

  const isGameCenterMissing = gameCenterSection == null;

  if (isGameCenterMissing) {
    throw new Error(
      `No Game Center config for ${bundleId}. Add a gameCenter entry to launch.config.ts.`,
      { cause: bundleId },
    );
  }

  return { bundleId, gameCenterConfig: gameCenterSection };
}

function isPlannedAction(plannedAction: { status: string }): boolean {
  return plannedAction.status == 'planned';
}

/** Plan, confirm, and apply Game Center changes. */
async function executeGameCenter(rawCommandInput: unknown): Promise<number> {
  try {
    try {
      var commandInput = GameCenterCommandInputSchema(rawCommandInput);
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    const gameCenterTarget = await readGameCenterTarget(commandInput);
    try {
      var appleStore = await loadActiveAppleStore();
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    try {
      var gameCenterPlan = await reconcileGameCenter(appleStore, {
        bundleId: gameCenterTarget.bundleId,
        config: gameCenterTarget.gameCenterConfig,
        dryRun: true,
      });
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    const plannedActions = gameCenterPlan.actions.filter(isPlannedAction);

    console.log('');

    const isAlreadyInSync = gameCenterPlan.actions.length == 0;

    if (isAlreadyInSync) {
      console.log(
        redactText(
          `${gameCenterTarget.bundleId} - Game Center achievements & leaderboards already in sync`,
        ),
      );

      return 0;
    }

    const actionLines = gameCenterPlan.actions.map(renderStoreSurfaceAction);

    console.log(redactText([gameCenterTarget.bundleId, ...actionLines].join('\n  ')));

    const hasNothingToApply = plannedActions.length == 0;

    if (hasNothingToApply) {
      console.log('');
      console.log(redactText('game-center - nothing to apply (everything already in sync)'));
      return 0;
    }

    console.log('');
    console.log(redactText(`${plannedActions.length} change(s) for ${gameCenterTarget.bundleId}.`));

    const isDryRun = commandInput.dryRun == true;

    if (isDryRun) {
      console.log(redactText('Dry run - no changes made. Re-run without --dry-run to apply.'));
      return 0;
    }

    try {
      var confirmed = await confirmStoreSurfaceWrite(
        `Apply ${plannedActions.length} Game Center change(s) to App Store Connect?`,
        commandInput.yes,
      );
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    const wasDeclined = confirmed == false;

    if (wasDeclined) {
      return 0;
    }

    try {
      var appliedGameCenter = await reconcileGameCenter(appleStore, {
        bundleId: gameCenterTarget.bundleId,
        config: gameCenterTarget.gameCenterConfig,
        dryRun: false,
      });
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    const gameCenterSummary = summarize(appliedGameCenter.actions);
    let receiptTitle = 'Applied';

    const hasFailures = gameCenterSummary.failed > 0;

    if (hasFailures) {
      receiptTitle = 'Applied with errors';
    }

    const receiptLines = appliedGameCenter.actions.map(renderAppliedStoreSurfaceAction);

    console.log(redactText([receiptTitle, ...receiptLines].join('\n  ')));

    return gameCenterSummary.failed;
  } catch (cause) {
    const isAlreadyError = cause instanceof Error;

    if (isAlreadyError) {
      throw cause;
    }

    throw new Error(errorMessage(cause), { cause: cause });
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

type GameCenterOptions = Readonly<{
  readonly app?: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

/** Map Commander values without explicit undefined optionals. */
function gameCenterInputFromOptions(commandOptions: GameCenterOptions): GameCenterCommandInput {
  let gameCenterInput: GameCenterCommandInput = {
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) {
    gameCenterInput = { ...gameCenterInput, app: commandOptions.app };
  }

  return gameCenterInput;
}

/** Attach the game-center command. */
export function registerGameCenterCommand(program: Command): void {
  function runGameCenter(commandOptions: GameCenterOptions) {
    const gameCenterFrom = gameCenterInputFromOptions(commandOptions);
    const gameCenterProgram = gameCenterCommandProgram(gameCenterFrom);
    return runCliProgram(gameCenterProgram);
  }

  program
    .command('game-center')
    .description('reconcile Game Center achievements and leaderboards from launch.config.ts')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runGameCenter);
}
