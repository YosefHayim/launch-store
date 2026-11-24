// Applies the release attribute config for one app through the active Apple account.

import { stdout } from 'node:process';
import { launchConfigForApp, loadConfig } from '../config/config.ts';
import { loadActiveAscKey } from '../credentials/accounts.ts';
import { hasMessage, errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { AppleStoreClientService } from '../services/stores/apple-store-client.ts';
import { summarize } from '../store/shared/reconcile.ts';
import { selectStoreApp } from '../store/shared/select-store-app.ts';
import { completeCommand } from '../terminal/command-exit.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import { reconcileRelease } from './release-attributes.ts';

/** Inputs resolved from Commander for App Store release-attribute reconciliation. */
type ReleaseConfigCommandInput = Readonly<{
  app?: string;
  dryRun: boolean;
  yes: boolean;
}>;

/** Render one planned, skipped, applied, or failed action with ASCII markers. */
export function renderAction(plannedAction: PlannedAction): string {
  const isSkipped = plannedAction.status == 'skipped';

  if (isSkipped) {
    return `- ${plannedAction.description}`;
  }

  const isFailed = plannedAction.status == 'failed';

  if (isFailed) {
    let errorDetail = '';

    const hasError = plannedAction.error != null;

    if (hasError) {
      errorDetail = ` - ${plannedAction.error}`;
    }

    return `x ${plannedAction.description}${errorDetail}`;
  }

  return `+ ${plannedAction.description}`;
}

function isPlannedAction(plannedAction: PlannedAction): boolean {
  return plannedAction.status == 'planned';
}

function failedReceiptLine(description: string, actionError: string | undefined): string {
  const hasError = actionError != null;

  if (hasError) {
    return `x ${description} - ${actionError}`;
  }

  return `x ${description} - failed`;
}

function renderReceiptLine(appliedAction: PlannedAction): string {
  const isFailed = appliedAction.status == 'failed';

  if (isFailed) {
    return failedReceiptLine(appliedAction.description, appliedAction.error);
  }

  let marker = 'OK';

  const isSkipped = appliedAction.status == 'skipped';

  if (isSkipped) {
    marker = '-';
  }

  return `${marker} ${appliedAction.description}`;
}

async function confirmReleaseChanges(changeCount: number, yes: boolean): Promise<boolean> {
  const isAlreadyConfirmed = yes == true;

  if (isAlreadyConfirmed) {
    return true;
  }

  const terminalIsInteractive = stdout.isTTY == true;

  if (terminalIsInteractive == false) {
    throw new Error(
      'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
      { cause: { yes } },
    );
  }

  try {
    return await new LaunchPrompt().confirm(`Apply ${changeCount} change(s) to App Store Connect?`);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

/** Reconcile one app's release attributes through the active Apple account. */
export async function releaseConfigCommandProgram(
  commandInput: ReleaseConfigCommandInput,
): Promise<void> {
  const logger = createLogger(false);
  try {
    var loadedConfiguration = await loadConfig();
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  try {
    var selectedApp = await selectStoreApp(commandInput.app);
  } catch (cause) {
    let explicitMessage: string | undefined;

    const causeHasMessage = hasMessage(cause);

    if (causeHasMessage) {
      explicitMessage = cause.message;
    }

    throw new Error(explicitMessage ?? errorMessage(cause), { cause: cause });
  }

  const bundleId = selectedApp.bundleId;

  const isBundleMissing = bundleId == null;

  if (isBundleMissing) {
    throw new Error(
      `No iOS bundle identifier for ${selectedApp.name} (set ios.bundleIdentifier in app.json).`,
      { cause: selectedApp },
    );
  }

  try {
    var appLaunch = await launchConfigForApp(loadedConfiguration.config, selectedApp.dir);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  const releaseAttributes = appLaunch.releaseAttributes?.[bundleId];

  const isReleaseAttributesMissing = releaseAttributes == null;

  if (isReleaseAttributesMissing) {
    throw new Error(
      `No release attributes for ${bundleId}. Add a releaseAttributes entry to launch.config.ts.`,
      { cause: bundleId },
    );
  }

  try {
    var ascKey = await loadActiveAscKey();
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  if (ascKey == null) {
    throw new Error('No active Apple account. Run `launch-store creds set-key` first.', {
      cause: bundleId,
    });
  }

  try {
    var ascClient = new AppleStoreClientService().createClient(ascKey);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  try {
    var releasePlan = await reconcileRelease(ascClient, {
      bundleId,
      config: releaseAttributes,
      dryRun: true,
    });
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  const plannedActions = releasePlan.actions.filter(isPlannedAction);

  logger.gap();

  const isAlreadyInSync = releasePlan.actions.length == 0;

  if (isAlreadyInSync) {
    logger.step(bundleId, 'release attributes already in sync');
    return;
  }

  const plannedLines = releasePlan.actions.map(renderAction);

  logger.notice(bundleId, ...plannedLines);

  const hasNothingToApply = plannedActions.length == 0;

  if (hasNothingToApply) {
    logger.gap();
    logger.step(
      'release-config',
      'nothing to apply (everything in sync; skipped areas need a version first)',
    );

    return;
  }

  logger.gap();
  logger.note(`${plannedActions.length} change(s) for ${bundleId}.`);

  if (commandInput.dryRun) {
    logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
    return;
  }

  const confirmed = await confirmReleaseChanges(plannedActions.length, commandInput.yes);

  const isDeclined = confirmed == false;

  if (isDeclined) {
    new LaunchPrompt().cancel('Aborted - no changes made.');
    return;
  }

  try {
    var appliedRelease = await reconcileRelease(ascClient, {
      bundleId,
      config: releaseAttributes,
      dryRun: false,
    });
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  const releaseSummary = summarize(appliedRelease.actions);
  const receiptLines = appliedRelease.actions.map(renderReceiptLine);
  let receiptTitle = 'Applied';

  const hasFailedActions = releaseSummary.failed > 0;

  if (hasFailedActions) {
    receiptTitle = 'Applied with errors';
  }

  logger.box(receiptTitle, receiptLines);

  if (hasFailedActions) {
    completeCommand(1);
  }
}
