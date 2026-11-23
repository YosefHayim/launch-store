// Plans custom product page changes and applies them on App Store Connect.

import { createLogger } from '@/services/platform/logger.js';
import { completeCommand } from '@/terminal/command-exit.js';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
} from './app-store-surface-command.ts';
import { loadActiveAppleStore } from './apple-store-command.ts';
import {
  reconcileCustomProductPages,
  summarizeCustomPages,
  type CustomProductPagesConfig,
} from '@/apple/store/custom-product-pages.js';
import { loadStoreAppContext } from '@/store/shared/select-store-app.js';
import { hasMessage } from '@/services/platform/error-message.js';
import type { PlannedAction } from '@/types/reconcile.js';
import { readPlainObject } from '@/services/platform/plain-object.js';

export type CustomProductPagesCommandInput = {
  app?: string;
  dryRun: boolean;
  yes: boolean;
};

/** A custom product pages command step failed. */
type CustomProductPagesCommandFailure = Readonly<{
  readonly _tag: 'CustomProductPagesCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeCustomProductPagesCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): CustomProductPagesCommandFailure {
  return { _tag: 'CustomProductPagesCommandFailure', ...fields };
}

function readFlag(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];
  const isFlag = typeof field == 'boolean';

  if (isFlag == false) {
    throw new Error(`Expected ${fieldName} to be a boolean.`);
  }

  return field;
}

/** Decode one custom-pages command. Rejects an explicit undefined exact optional app. */
export function CustomProductPagesCommandInputSchema(
  rawCommandInput: unknown,
): CustomProductPagesCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Custom product pages command input must be an object.');
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

/** Convert a dependency failure into the custom pages command channel. */
function customPagesFailure(operation: string, cause: unknown): CustomProductPagesCommandFailure {
  if (typeof cause == 'string') {
    const hasCauseText = cause.length > 0;

    if (hasCauseText) {
      return makeCustomProductPagesCommandFailure({ operation, message: cause, cause });
    }
  }

  if (hasMessage(cause)) {
    return makeCustomProductPagesCommandFailure({ operation, message: cause.message, cause });
  }

  return makeCustomProductPagesCommandFailure({
    operation,
    message: `${operation} failed.`,
    cause,
  });
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

/** Resolve the selected bundle id and its custom pages declaration. */
async function resolveCustomPagesTarget(
  commandInput: CustomProductPagesCommandInput,
): Promise<Readonly<{ bundleId: string; customPagesConfig: CustomProductPagesConfig }>> {
  try {
    var storeAppContext = await loadStoreAppContext(commandInput.app);
  } catch (cause) {
    throw customPagesFailure('select custom pages app', cause);
  }

  const bundleId = storeAppContext.app.bundleId;

  const isBundleMissing = bundleId == null;

  if (isBundleMissing) {
    throw makeCustomProductPagesCommandFailure({
      operation: 'resolve custom pages bundle id',
      message: `No iOS bundle identifier for ${storeAppContext.app.name} (set ios.bundleIdentifier in app.json).`,
      cause: storeAppContext.app,
    });
  }

  const customPagesSection = storeAppContext.config.customPages?.[bundleId];

  const isCustomPagesMissing = customPagesSection == null;

  if (isCustomPagesMissing) {
    throw makeCustomProductPagesCommandFailure({
      operation: 'resolve custom pages config',
      message: `No custom pages config for ${bundleId}. Add a customPages entry to launch.config.ts.`,
      cause: bundleId,
    });
  }

  return { bundleId, customPagesConfig: customPagesSection };
}

/** Plan, confirm, and apply custom product page changes. */
async function executeCustomProductPages(rawCommandInput: unknown): Promise<number> {
  try {
    let commandInput: CustomProductPagesCommandInput;

    try {
      commandInput = CustomProductPagesCommandInputSchema(rawCommandInput);
    } catch (cause) {
      throw customPagesFailure('decode custom pages command input', cause);
    }

    const customPagesTarget = await resolveCustomPagesTarget(commandInput);
    const logger = createLogger(false);

    try {
      var appleStore = await loadActiveAppleStore();
    } catch (cause) {
      throw customPagesFailure('load App Store Connect client', cause);
    }

    try {
      var customPagesPlan = await reconcileCustomProductPages(appleStore, {
        bundleId: customPagesTarget.bundleId,
        config: customPagesTarget.customPagesConfig,
        dryRun: true,
      });
    } catch (cause) {
      throw customPagesFailure('plan custom page changes', cause);
    }

    const plannedActions = customPagesPlan.actions.filter(isPlannedAction);

    logger.gap();

    const isAlreadyInSync = customPagesPlan.actions.length == 0;

    if (isAlreadyInSync) {
      logger.step(customPagesTarget.bundleId, 'custom product pages already in sync');
      return 0;
    }

    logger.notice(customPagesTarget.bundleId, ...customPagesPlan.actions.map(renderPlanned));

    const hasNothingToApply = plannedActions.length == 0;

    if (hasNothingToApply) {
      logger.gap();
      logger.step('custom-pages', 'nothing to apply (everything already in sync)');
      return 0;
    }

    logger.gap();
    logger.note(`${plannedActions.length} change(s) for ${customPagesTarget.bundleId}.`);

    const isDryRun = commandInput.dryRun == true;

    if (isDryRun) {
      logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return 0;
    }

    let confirmed = false;

    try {
      confirmed = await confirmStoreSurfaceWrite(
        `Apply ${plannedActions.length} custom-page change(s) to App Store Connect?`,
        commandInput.yes,
      );
    } catch (cause) {
      throw customPagesFailure('confirm custom page changes', cause);
    }

    const declined = confirmed == false;

    if (declined) {
      return 0;
    }

    try {
      var appliedCustomPages = await reconcileCustomProductPages(appleStore, {
        bundleId: customPagesTarget.bundleId,
        config: customPagesTarget.customPagesConfig,
        dryRun: false,
      });
    } catch (cause) {
      throw customPagesFailure('apply custom page changes', cause);
    }

    const customPagesSummary = summarizeCustomPages(appliedCustomPages.actions);
    let receiptTitle = 'Applied';

    const hasFailures = customPagesSummary.failed > 0;

    if (hasFailures) {
      receiptTitle = 'Applied with errors';
    }

    logger.box(receiptTitle, appliedCustomPages.actions.map(renderApplied));

    return customPagesSummary.failed;
  } catch (cause) {
    throw customPagesFailure('run custom pages command', cause);
  }
}

/** Run the decoded custom-pages command. */
export async function customProductPagesCommandProgram(rawCommandInput: unknown): Promise<void> {
  const failureCount = await executeCustomProductPages(rawCommandInput);

  const hasFailures = failureCount > 0;

  if (hasFailures) {
    completeCommand(1);
  }
}
