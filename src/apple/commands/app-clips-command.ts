// Plans App Clip card changes and applies them on App Store Connect.

import { createLogger } from '@/services/platform/logger.js';
import { completeCommand } from '@/terminal/command-exit.js';
import type { AppClipsConfig } from '@/types/store-surface.js';
import type { PlannedAction } from '@/types/reconcile.js';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
} from './app-store-surface-command.ts';
import { loadActiveAppleStore } from './apple-store-command.ts';
import { reconcileAppClips } from '@/apple/store/app-clips.js';
import { summarize } from '@/store/shared/reconcile.js';
import { loadStoreAppContext } from '@/store/shared/select-store-app.js';
import { hasMessage } from '@/services/platform/error-message.js';
import { readPlainObject } from '@/services/platform/plain-object.js';

export type AppClipsCommandInput = {
  app?: string;
  dryRun: boolean;
  yes: boolean;
};

/** An App Clips command step failed. */
type AppClipsCommandFailure = Readonly<{
  readonly _tag: 'AppClipsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeAppClipsCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): AppClipsCommandFailure {
  return { _tag: 'AppClipsCommandFailure', ...fields };
}

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

/** Convert a dependency failure into the App Clips command channel. */
function appClipsFailure(operation: string, cause: unknown): AppClipsCommandFailure {
  if (typeof cause == 'string') {
    const hasCauseText = cause.length > 0;

    if (hasCauseText) {
      return makeAppClipsCommandFailure({ operation, message: cause, cause });
    }
  }

  if (hasMessage(cause)) {
    return makeAppClipsCommandFailure({ operation, message: cause.message, cause });
  }

  return makeAppClipsCommandFailure({ operation, message: `${operation} failed.`, cause });
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

/** Resolve the selected bundle id and its App Clips declaration. */
async function resolveAppClipsTarget(
  commandInput: AppClipsCommandInput,
): Promise<Readonly<{ bundleId: string; appClipsConfig: AppClipsConfig }>> {
  try {
    var storeAppContext = await loadStoreAppContext(commandInput.app);
  } catch (cause) {
    throw appClipsFailure('select App Clips app', cause);
  }

  const bundleId = storeAppContext.app.bundleId;

  const isBundleMissing = bundleId == null;

  if (isBundleMissing) {
    throw makeAppClipsCommandFailure({
      operation: 'resolve App Clips bundle id',
      message: `No iOS bundle identifier for ${storeAppContext.app.name} (set ios.bundleIdentifier in app.json).`,
      cause: storeAppContext.app,
    });
  }

  const appClipsSection = storeAppContext.config.appClips?.[bundleId];

  const isAppClipsMissing = appClipsSection == null;

  if (isAppClipsMissing) {
    throw makeAppClipsCommandFailure({
      operation: 'resolve App Clips config',
      message: `No App Clips config for ${bundleId}. Add an appClips entry to launch.config.ts.`,
      cause: bundleId,
    });
  }

  return { bundleId, appClipsConfig: appClipsSection };
}

/** Plan, confirm, and apply App Clip card changes. */
async function executeAppClips(rawCommandInput: unknown): Promise<number> {
  try {
    let commandInput: AppClipsCommandInput;

    try {
      commandInput = AppClipsCommandInputSchema(rawCommandInput);
    } catch (cause) {
      throw appClipsFailure('decode App Clips command input', cause);
    }

    const appClipsTarget = await resolveAppClipsTarget(commandInput);
    const logger = createLogger(false);

    try {
      var appleStore = await loadActiveAppleStore();
    } catch (cause) {
      throw appClipsFailure('load App Store Connect client', cause);
    }

    try {
      var appClipsPlan = await reconcileAppClips(appleStore, {
        bundleId: appClipsTarget.bundleId,
        config: appClipsTarget.appClipsConfig,
        dryRun: true,
      });
    } catch (cause) {
      throw appClipsFailure('plan App Clip changes', cause);
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

    let confirmed = false;

    try {
      confirmed = await confirmStoreSurfaceWrite(
        `Apply ${plannedActions.length} App Clip change(s) to App Store Connect?`,
        commandInput.yes,
      );
    } catch (cause) {
      throw appClipsFailure('confirm App Clip changes', cause);
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
      throw appClipsFailure('apply App Clip changes', cause);
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
    throw appClipsFailure('run App Clips command', cause);
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
