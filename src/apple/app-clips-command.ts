// Plans App Clip card changes and applies them on App Store Connect.

import { createLogger } from '../services/platform/logger.ts';
import { completeCommand } from '../terminal/command-exit.ts';
import type { AppClipsConfig } from '../types/store-surface.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
} from './app-store-surface-command.ts';
import { loadActiveAppleStore } from './apple-store-command.ts';
import { reconcileAppClips } from './app-clips.ts';
import { summarize } from '../store/shared/reconcile.ts';
import { loadStoreAppContext } from '../store/shared/select-store-app.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import type { Command } from '../cli/command.ts';
import { runCliProgram } from '../cli/run-cli-program.ts';

export type AppClipsCommandInput = {
  app?: string;
  dryRun: boolean;
  yes: boolean;
};

/** An App Clips command step failed. */
function readFlag(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];
  const isFlag = typeof field == 'boolean';

  if (isFlag == false) {
    throw new Error(`Expected ${fieldName} to be a boolean.`);
  }

  return field;
}

/** Decode one App Clips command. Rejects an explicit undefined exact optional app. */
export function AppClipsCommandInputSchema(rawCommandInput: unknown): AppClipsCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('App Clips command input must be an object.');
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

function isPlannedAction(plannedAction: PlannedAction): boolean {
  return plannedAction.status == 'planned';
}

function renderPlanned(plannedAction: PlannedAction): string {
  return renderStoreSurfaceAction(plannedAction);
}

function renderApplied(plannedAction: PlannedAction): string {
  return renderAppliedStoreSurfaceAction(plannedAction);
}

/** Read the selected bundle id and its App Clips declaration. */
async function readAppClipsTarget(
  commandInput: AppClipsCommandInput,
): Promise<Readonly<{ bundleId: string; appClipsConfig: AppClipsConfig }>> {
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

  const appClipsSection = storeAppContext.config.appClips?.[bundleId];

  const isAppClipsMissing = appClipsSection == null;

  if (isAppClipsMissing) {
    throw new Error(
      `No App Clips config for ${bundleId}. Add an appClips entry to launch.config.ts.`,
      { cause: bundleId },
    );
  }

  return { bundleId, appClipsConfig: appClipsSection };
}

/** Plan, confirm, and apply App Clip card changes. */
async function executeAppClips(rawCommandInput: unknown): Promise<number> {
  try {
    try {
      var commandInput = AppClipsCommandInputSchema(rawCommandInput);
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    const appClipsTarget = await readAppClipsTarget(commandInput);
    const logger = createLogger(false);

    try {
      var appleStore = await loadActiveAppleStore();
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    try {
      var appClipsPlan = await reconcileAppClips(appleStore, {
        bundleId: appClipsTarget.bundleId,
        config: appClipsTarget.appClipsConfig,
        dryRun: true,
      });
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    const plannedActions = appClipsPlan.actions.filter(isPlannedAction);

    logger.gap();

    const isAlreadyInSync = appClipsPlan.actions.length == 0;

    if (isAlreadyInSync) {
      logger.step(appClipsTarget.bundleId, 'App Clip cards already in sync');
      return 0;
    }

    logger.notice(appClipsTarget.bundleId, ...appClipsPlan.actions.map(renderPlanned));

    const hasNothingToApply = plannedActions.length == 0;

    if (hasNothingToApply) {
      logger.gap();
      logger.step(
        'app-clips',
        'nothing to apply (everything in sync; skipped clips need a build or version first)',
      );

      return 0;
    }

    logger.gap();
    logger.note(`${plannedActions.length} change(s) for ${appClipsTarget.bundleId}.`);

    const isDryRun = commandInput.dryRun == true;

    if (isDryRun) {
      logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return 0;
    }

    try {
      var confirmed = await confirmStoreSurfaceWrite(
        `Apply ${plannedActions.length} App Clip change(s) to App Store Connect?`,
        commandInput.yes,
      );
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    const declined = confirmed == false;

    if (declined) {
      return 0;
    }

    try {
      var appliedAppClips = await reconcileAppClips(appleStore, {
        bundleId: appClipsTarget.bundleId,
        config: appClipsTarget.appClipsConfig,
        dryRun: false,
      });
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    const appClipsSummary = summarize(appliedAppClips.actions);
    let receiptTitle = 'Applied';

    const hasFailures = appClipsSummary.failed > 0;

    if (hasFailures) {
      receiptTitle = 'Applied with errors';
    }

    logger.box(receiptTitle, appliedAppClips.actions.map(renderApplied));

    return appClipsSummary.failed;
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

/** Run the decoded App Clips command. */
export async function appClipsCommandProgram(rawCommandInput: unknown): Promise<void> {
  const failureCount = await executeAppClips(rawCommandInput);

  const hasFailures = failureCount > 0;

  if (hasFailures) {
    completeCommand(1);
  }
}

type AppClipsOptions = Readonly<{
  readonly app?: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

/** Map Commander values without explicit undefined optionals. */
function readAppClipsCommand(commandOptions: AppClipsOptions): AppClipsCommandInput {
  let appClipsInput: AppClipsCommandInput = {
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) {
    appClipsInput = { ...appClipsInput, app: commandOptions.app };
  }

  return appClipsInput;
}

/** Attach the app-clips command. */
export function registerAppClipsCommand(program: Command): void {
  function runAppClips(commandOptions: AppClipsOptions) {
    const appClips = readAppClipsCommand(commandOptions);
    const appClipsProgram = appClipsCommandProgram(appClips);
    return runCliProgram(appClipsProgram);
  }

  program
    .command('app-clips')
    .description(
      'reconcile App Clip card metadata (action, per-locale subtitle) from launch.config.ts',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runAppClips);
}
