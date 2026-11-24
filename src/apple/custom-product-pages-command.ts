// Plans custom product page changes and applies them on App Store Connect.

import type { Command } from '../cli/command.ts';
import { runCliProgram } from '../cli/run-cli-program.ts';
import { createLogger } from '../services/platform/logger.ts';
import { completeCommand } from '../terminal/command-exit.ts';
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
} from './custom-product-pages.ts';
import { loadStoreAppContext } from '../store/shared/select-store-app.ts';
import { hasMessage } from '../services/platform/error-message.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

export type CustomProductPagesCommandInput = {
  app?: string;
  dryRun: boolean;
  yes: boolean;
};

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

/** Convert a dependency failure into an Error. */
function customPagesFailure(operation: string, cause: unknown): never {
  const causeText = typeof cause == 'string' ? cause : '';
  const isBlankCauseText = causeText.length == 0;

  if (isBlankCauseText == false) {
    throw new Error(causeText, { cause });
  }

  const causeHasMessage = hasMessage(cause);

  if (causeHasMessage) {
    throw new Error(cause.message, { cause });
  }

  throw new Error(`${operation} failed.`, { cause });
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

/** Read the selected bundle id and its custom pages declaration. */
async function readCustomPagesTarget(
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
    throw new Error(
      `No iOS bundle identifier for ${storeAppContext.app.name} (set ios.bundleIdentifier in app.json).`,
      { cause: storeAppContext.app },
    );
  }

  const customPagesSection = storeAppContext.config.customPages?.[bundleId];

  const isCustomPagesMissing = customPagesSection == null;

  if (isCustomPagesMissing) {
    throw new Error(
      `No custom pages config for ${bundleId}. Add a customPages entry to launch.config.ts.`,
      { cause: bundleId },
    );
  }

  return { bundleId, customPagesConfig: customPagesSection };
}

/** Plan, confirm, and apply custom product page changes. */
async function executeCustomProductPages(rawCommandInput: unknown): Promise<number> {
  try {
    try {
      var commandInput = CustomProductPagesCommandInputSchema(rawCommandInput);
    } catch (cause) {
      throw customPagesFailure('decode custom pages command input', cause);
    }

    const customPagesTarget = await readCustomPagesTarget(commandInput);
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

    try {
      var confirmed = await confirmStoreSurfaceWrite(
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

type CustomPagesOptions = Readonly<{
  readonly app?: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

/** Map Commander values without explicit undefined optionals. */
function readCustomProductPages(
  commandOptions: CustomPagesOptions,
): CustomProductPagesCommandInput {
  let customPagesInput: CustomProductPagesCommandInput = {
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) {
    customPagesInput = { ...customPagesInput, app: commandOptions.app };
  }

  return customPagesInput;
}

/** Attach the custom product pages command. */
export function registerCustomPagesCommand(program: Command): void {
  function runCustomPages(commandOptions: CustomPagesOptions) {
    const customProductPages = readCustomProductPages(commandOptions);
    const customProductPagesProgram = customProductPagesCommandProgram(customProductPages);
    return runCliProgram(customProductPagesProgram);
  }

  program
    .command('custom-pages')
    .description('reconcile custom product pages (alternate listings) from launch.config.ts')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runCustomPages);
}
