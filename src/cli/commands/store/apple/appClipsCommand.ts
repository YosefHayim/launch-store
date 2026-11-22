import { createLogger } from '../../../../services/platform/logger.ts';
import { completeCommand } from '../../../../terminal/commandExit.ts';
import type { AppClipsConfig } from '../../../../types/storeSurface.ts';
import type { PlannedAction } from '../../../../types/reconcile.ts';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
  resolveStoreSurfaceSection,
} from './appStoreSurfaceCommand.ts';
import { loadActiveAppleStore } from './appleStoreCommand.ts';
import { parseAppClipsConfig, reconcileAppClips } from '../../../../store/apple/appClips.ts';
import { summarize } from '../../../../store/shared/reconcile.ts';
import { loadStoreAppContext } from '../../../../store/shared/selectStoreApp.ts';
import { hasMessage } from '../../../../services/platform/errorMessage.ts';

export type AppClipsCommandInput = {
  app?: string;
  config: string;
  explicitConfig: boolean;
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

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  return true;
}

function readText(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];
  const isText = typeof field == 'string';

  if (isText == false) {
    throw new Error(`Expected ${fieldName} to be a string.`);
  }

  return field;
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
  const isCommandRecord = isRecord(rawCommandInput);

  if (isCommandRecord == false) {
    throw new Error('App Clips command input must be an object.');
  }

  const config = readText(rawCommandInput, 'config');
  const explicitConfig = readFlag(rawCommandInput, 'explicitConfig');
  const dryRun = readFlag(rawCommandInput, 'dryRun');
  const yes = readFlag(rawCommandInput, 'yes');
  const hasApp = Object.hasOwn(rawCommandInput, 'app');

  if (hasApp == false) {
    return { config, explicitConfig, dryRun, yes };
  }

  const app = rawCommandInput['app'];
  const isAppText = typeof app == 'string';

  if (isAppText == false) {
    throw new Error('Expected app to be a string.');
  }

  return { app, config, explicitConfig, dryRun, yes };
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

  let typedAppClipsConfig: AppClipsConfig | undefined;
  const typedClips = storeAppContext.config.appClips;
  const hasTypedClips = typedClips != null;

  if (hasTypedClips) {
    typedAppClipsConfig = typedClips[bundleId];
  }

  let appClipsConfig: AppClipsConfig | undefined;

  try {
    appClipsConfig = await resolveStoreSurfaceSection(
      typedAppClipsConfig,
      commandInput.config,
      commandInput.explicitConfig,
      parseAppClipsConfig,
    );
  } catch (cause) {
    throw appClipsFailure('resolve App Clips config', cause);
  }

  const loadedAppClipsConfig = appClipsConfig;
  const isConfigMissing = loadedAppClipsConfig == null;

  if (isConfigMissing) {
    throw makeAppClipsCommandFailure({
      operation: 'resolve App Clips config',
      message: `No App Clips config for ${bundleId}. Add an \`appClips\` entry to launch.config.ts or create ${commandInput.config}.`,
      cause: commandInput.config,
    });
  }

  return { bundleId, appClipsConfig: loadedAppClipsConfig };
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
