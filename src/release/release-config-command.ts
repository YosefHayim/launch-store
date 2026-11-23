// Applies the release attribute config for one app through the active Apple account.

import { stdout } from 'node:process';
import { selectApp } from '../build/pipeline-environment.ts';
import { launchConfigForApp, loadConfig } from '../config/config.ts';
import { loadActiveAscKey } from '../credentials/accounts.ts';
import { hasMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { AppleStoreClientService } from '../services/stores/apple-store-client.ts';
import { summarize } from '../store/shared/reconcile.ts';
import { completeCommand } from '../terminal/command-exit.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import { reconcileRelease } from './release-attributes.ts';

/** Inputs resolved from Commander for App Store release-attribute reconciliation. */
type ReleaseConfigCommandInput = Readonly<{
  app?: string;
  dryRun: boolean;
  yes: boolean;
}>;

/** Release-attribute configuration or transport work failed. */
type ReleaseConfigCommandFailure = Readonly<{
  readonly _tag: 'ReleaseConfigCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeReleaseConfigCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): ReleaseConfigCommandFailure {
  return {
    _tag: 'ReleaseConfigCommandFailure',
    operation: fields.operation,
    message: fields.message,
    cause: fields.cause,
  };
}

/** Convert an unknown cause to the release-config failure channel. */
function releaseConfigFailure(
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): ReleaseConfigCommandFailure {
  let message = fallbackMessage;

  if (message == null) {
    const causeHasMessage = hasMessage(cause);

    if (causeHasMessage) {
      message = cause.message;
    }
  }

  if (message == null) {
    message = `${operation} failed.`;
  }

  return makeReleaseConfigCommandFailure({ operation, message, cause });
}

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
    throw releaseConfigFailure(
      'confirm release attributes',
      { yes },
      'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
    );
  }

  try {
    return await new LaunchPrompt().confirm(`Apply ${changeCount} change(s) to App Store Connect?`);
  } catch (cause) {
    throw releaseConfigFailure('confirm release attributes', cause);
  }
}

/** Reconcile one app's release attributes through the active Apple account. */
export async function releaseConfigCommandProgram(
  commandInput: ReleaseConfigCommandInput,
): Promise<void> {
  const logger = createLogger(false);
  let loadedConfiguration: Awaited<ReturnType<typeof loadConfig>>;

  try {
    loadedConfiguration = await loadConfig();
  } catch (cause) {
    throw releaseConfigFailure('load Launch configuration', cause);
  }

  let selectedApp: Awaited<ReturnType<typeof selectApp>>;

  try {
    selectedApp = await selectApp(loadedConfiguration.apps, commandInput.app);
  } catch (cause) {
    let explicitMessage: string | undefined;

    const causeHasMessage = hasMessage(cause);

    if (causeHasMessage) {
      explicitMessage = cause.message;
    }

    throw releaseConfigFailure('select app', cause, explicitMessage);
  }

  const bundleId = selectedApp.bundleId;

  const isBundleMissing = bundleId == null;

  if (isBundleMissing) {
    throw releaseConfigFailure(
      'resolve iOS bundle identifier',
      selectedApp,
      `No iOS bundle identifier for ${selectedApp.name} (set ios.bundleIdentifier in app.json).`,
    );
  }

  let appLaunch: Awaited<ReturnType<typeof launchConfigForApp>>;

  try {
    appLaunch = await launchConfigForApp(loadedConfiguration.config, selectedApp.dir);
  } catch (cause) {
    throw releaseConfigFailure('load release attributes', cause);
  }

  const releaseAttributes = appLaunch.releaseAttributes?.[bundleId];

  const isReleaseAttributesMissing = releaseAttributes == null;

  if (isReleaseAttributesMissing) {
    throw releaseConfigFailure(
      'load release attributes',
      bundleId,
      `No release attributes for ${bundleId}. Add a releaseAttributes entry to launch.config.ts.`,
    );
  }

  let ascKey: Awaited<ReturnType<typeof loadActiveAscKey>>;

  try {
    ascKey = await loadActiveAscKey();
  } catch (cause) {
    throw releaseConfigFailure('load active Apple account', cause);
  }

  const activeAscKey = ascKey;

  const isAccountMissing = activeAscKey == null;

  if (isAccountMissing) {
    throw releaseConfigFailure(
      'load active Apple account',
      bundleId,
      'No active Apple account. Run `launch-store creds set-key` first.',
    );
  }

  let ascClient: ReturnType<AppleStoreClientService['createClient']>;

  try {
    ascClient = new AppleStoreClientService().createClient(activeAscKey);
  } catch (cause) {
    throw releaseConfigFailure('create App Store client', cause);
  }

  let releasePlan: Awaited<ReturnType<typeof reconcileRelease>>;

  try {
    releasePlan = await reconcileRelease(ascClient, {
      bundleId,
      config: releaseAttributes,
      dryRun: true,
    });
  } catch (cause) {
    throw releaseConfigFailure('plan release attributes', cause);
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

  let appliedRelease: Awaited<ReturnType<typeof reconcileRelease>>;

  try {
    appliedRelease = await reconcileRelease(ascClient, {
      bundleId,
      config: releaseAttributes,
      dryRun: false,
    });
  } catch (cause) {
    throw releaseConfigFailure('apply release attributes', cause);
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
