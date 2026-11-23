// Syncs accessibility nutrition labels for one app to App Store Connect.

import { loadActiveAscKey } from '@/credentials/accounts.js';
import { AppleStoreClientService } from '@/services/stores/apple-store-client.js';
import { createLogger } from '@/services/platform/logger.js';
import { LaunchPrompt } from '@/services/platform/prompt.js';
import { checkTerminalIsInteractive } from '@/services/platform/progress.js';
import { completeCommand } from '@/terminal/command-exit.js';
import type { PlannedAction } from '@/types/reconcile.js';
import { reconcileAccessibility, summarizeAccessibility } from '@/store/apple/accessibility.js';
import { loadStoreAppContext } from '@/store/shared/select-store-app.js';
import { hasMessage } from '@/services/platform/error-message.js';

/** Inputs accepted by the accessibility command. */
type AccessibilityCommandInput = Readonly<{
  app?: string;
  dryRun: boolean;
  yes: boolean;
}>;

/** Accessibility configuration or reconciliation failed. */
type AccessibilityCommandFailure = Readonly<{
  readonly _tag: 'AccessibilityCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeAccessibilityCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): AccessibilityCommandFailure {
  return { _tag: 'AccessibilityCommandFailure', ...fields };
}

/** Convert an unknown cause to the command's tagged channel. */
function accessibilityFailure(
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): AccessibilityCommandFailure {
  const hasFallback = fallbackMessage != null;

  if (hasFallback) {
    return makeAccessibilityCommandFailure({ operation, message: fallbackMessage, cause });
  }

  if (hasMessage(cause)) {
    return makeAccessibilityCommandFailure({ operation, message: cause.message, cause });
  }

  return makeAccessibilityCommandFailure({
    operation,
    message: `${operation} failed.`,
    cause,
  });
}

/** Render one accessibility action with an ASCII status marker. */
export function renderAccessibilityAction(plannedAction: PlannedAction): string {
  const isFailed = plannedAction.status == 'failed';

  if (isFailed == false) {
    return `+ ${plannedAction.description}`;
  }

  let errorDetail = '';

  const hasError = plannedAction.error != null;

  if (hasError) {
    errorDetail = ` - ${plannedAction.error}`;
  }

  return `x ${plannedAction.description}${errorDetail}`;
}

function renderPlanned(plannedAction: PlannedAction): string {
  return renderAccessibilityAction(plannedAction);
}

function isPlannedAction(plannedAction: PlannedAction): boolean {
  return plannedAction.status == 'planned';
}

function receiptLine(appliedAction: PlannedAction): string {
  const isFailed = appliedAction.status == 'failed';

  if (isFailed) {
    let errorDetail = 'failed';
    const actionError = appliedAction.error;

    const hasError = actionError != null;

    if (hasError) {
      errorDetail = actionError;
    }

    return `x ${appliedAction.description} - ${errorDetail}`;
  }

  let marker = 'OK';

  const isSkipped = appliedAction.status == 'skipped';

  if (isSkipped) {
    marker = '-';
  }

  return `${marker} ${appliedAction.description}`;
}

/** Reconcile accessibility declarations for the selected App Store app. */
export async function accessibilityCommandProgram(
  commandInput: AccessibilityCommandInput,
): Promise<void> {
  const logger = createLogger(false);

  try {
    var storeAppContext = await loadStoreAppContext(commandInput.app);
  } catch (cause) {
    throw accessibilityFailure('select app', cause);
  }

  const bundleId = storeAppContext.app.bundleId;

  const isBundleMissing = bundleId == null;

  if (isBundleMissing) {
    throw accessibilityFailure(
      'resolve iOS bundle identifier',
      storeAppContext.app,
      `No iOS bundle identifier for ${storeAppContext.app.name} (set ios.bundleIdentifier in app.json).`,
    );
  }

  const accessibilitySection = storeAppContext.config.accessibility?.[bundleId];

  const isAccessibilityMissing = accessibilitySection == null;

  if (isAccessibilityMissing) {
    throw accessibilityFailure(
      'resolve accessibility config',
      bundleId,
      `No accessibility config for ${bundleId}. Add an accessibility entry to launch.config.ts.`,
    );
  }

  try {
    var ascKey = await loadActiveAscKey();
  } catch (cause) {
    throw accessibilityFailure('load active Apple account', cause);
  }

  const loadedAscKey = ascKey;

  const isAccountMissing = loadedAscKey == null;

  if (isAccountMissing) {
    throw accessibilityFailure(
      'load active Apple account',
      bundleId,
      'No active Apple account. Run `launch-store creds set-key` first.',
    );
  }

  try {
    var ascClient = AppleStoreClientService.createClient(loadedAscKey);
  } catch (cause) {
    throw accessibilityFailure('create App Store client', cause);
  }

  try {
    var accessibilityPlan = await reconcileAccessibility(ascClient, {
      bundleId,
      config: accessibilitySection,
      dryRun: true,
    });
  } catch (cause) {
    throw accessibilityFailure('plan accessibility changes', cause);
  }

  const plannedActions = accessibilityPlan.actions.filter(isPlannedAction);

  logger.gap();

  const isAlreadyInSync = accessibilityPlan.actions.length == 0;

  if (isAlreadyInSync) {
    logger.step(bundleId, 'accessibility declarations already in sync');
    return;
  }

  logger.notice(bundleId, ...accessibilityPlan.actions.map(renderPlanned));
  logger.gap();
  logger.note(`${plannedActions.length} change(s) for ${bundleId}.`);

  const isDryRun = commandInput.dryRun == true;

  if (isDryRun) {
    logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
    return;
  }

  const skipConfirmation = commandInput.yes == true;

  if (skipConfirmation == false) {
    const terminalIsInteractive = checkTerminalIsInteractive();

    const needsATerminal = terminalIsInteractive == false;

    if (needsATerminal) {
      throw accessibilityFailure(
        'confirm accessibility changes',
        commandInput,
        'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
      );
    }

    let confirmed = false;

    try {
      confirmed = await LaunchPrompt.confirm(
        `Apply ${plannedActions.length} accessibility change(s) to App Store Connect?`,
      );
    } catch (cause) {
      throw accessibilityFailure('confirm accessibility changes', cause);
    }

    const declined = confirmed == false;

    if (declined) {
      LaunchPrompt.cancel('Aborted - no changes made.');
      return;
    }
  }

  try {
    var appliedAccessibility = await reconcileAccessibility(ascClient, {
      bundleId,
      config: accessibilitySection,
      dryRun: false,
    });
  } catch (cause) {
    throw accessibilityFailure('apply accessibility changes', cause);
  }

  const accessibilitySummary = summarizeAccessibility(appliedAccessibility.actions);
  let receiptTitle = 'Applied';

  const hasFailures = accessibilitySummary.failed > 0;

  if (hasFailures) {
    receiptTitle = 'Applied with errors';
  }

  logger.box(receiptTitle, appliedAccessibility.actions.map(receiptLine));

  if (hasFailures) {
    completeCommand(1);
  }
}
