// Submits one build to TestFlight Beta App Review and shows the planned steps.

import { createLogger } from '../services/platform/logger.ts';
import { hasMessage } from '../services/platform/error-message.ts';
import { loadActiveAppleStore } from '../apple/apple-store-command.ts';
import { loadStoreAppContext } from '../store/shared/select-store-app.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import {
  reconcileBetaReview,
  summarizeBetaReview,
  type BetaReviewReconcileInput,
} from './beta-review.ts';
import { confirmAction, loadSelectedAppleApp } from './testflight-group.ts';

export interface ReleaseCommandInput {
  operation: 'release';
  app?: string;
  build?: string;
  whatsNew?: string;
  locale: string;
  review: boolean;
  dryRun: boolean;
  yes: boolean;
}

function failedActionLine(action: PlannedAction): string {
  const failureDetail = action.error ?? 'failed';
  return `x ${action.description} - ${failureDetail}`;
}

export function renderBetaAction(action: PlannedAction): string {
  if (action.status == 'failed') {
    return failedActionLine(action);
  }

  if (action.status == 'skipped') {
    return `- ${action.description}`;
  }

  if (action.status == 'applied') {
    return `[OK] ${action.description}`;
  }

  return `+ ${action.description}`;
}

function isPlannedAction(action: PlannedAction): boolean {
  return action.status == 'planned';
}

async function readLocalizedNotes(
  commandInput: ReleaseCommandInput,
): Promise<Record<string, string>> {
  if (commandInput.whatsNew != null) {
    return { [commandInput.locale]: commandInput.whatsNew };
  }

  try {
    var storeAppContext = await loadStoreAppContext(commandInput.app);
  } catch (cause) {
    let message = 'Could not load the selected app.';

    const causeHasMessage = hasMessage(cause);

    if (causeHasMessage) {
      message = cause.message;
    }

    throw new Error(message, { cause });
  }

  const bundleId = storeAppContext.app.bundleId;

  const isBundleMissing = bundleId == null;

  if (isBundleMissing) {
    throw new Error('Add a testFlight entry to launch.config.ts, or pass --whats-new.');
  }

  const notesForBundle = storeAppContext.config.testFlight?.[bundleId];

  const isNotesMissing = notesForBundle == null;

  if (isNotesMissing) {
    throw new Error(
      `No TestFlight notes for ${bundleId}. Add a testFlight entry to launch.config.ts, or pass --whats-new.`,
    );
  }

  return notesForBundle.whatToTest;
}

function withBuildVersion(
  reconciliationInput: BetaReviewReconcileInput,
  build: string | undefined,
): BetaReviewReconcileInput {
  if (build == null) {
    return reconciliationInput;
  }

  return { ...reconciliationInput, buildVersion: build };
}

function receiptTitle(failedCount: number): string {
  const hasFailures = failedCount > 0;

  if (hasFailures) {
    return 'Applied with errors';
  }

  return 'Applied';
}

export async function releaseBuild(commandInput: ReleaseCommandInput): Promise<void> {
  const localizedNotes = await readLocalizedNotes(commandInput);
  const appleStore = await loadActiveAppleStore();
  const selectedApp = await loadSelectedAppleApp(appleStore, commandInput.app);
  const reconciliationInput = withBuildVersion(
    {
      appId: selectedApp.appId,
      whatToTest: localizedNotes,
      submitForReview: commandInput.review,
      dryRun: true,
    },
    commandInput.build,
  );
  const planReport = await reconcileBetaReview(appleStore, reconciliationInput);
  const plannedActions = planReport.actions.filter(isPlannedAction);
  const releaseLabel = `${selectedApp.name} build ${planReport.buildVersion}`;
  const logger = createLogger(false);

  logger.gap();

  const hasNoActions = planReport.actions.length == 0;

  if (hasNoActions) {
    logger.skip(`${releaseLabel}: TestFlight release prep is already in sync.`);
    return;
  }

  logger.notice(releaseLabel, ...planReport.actions.map(renderBetaAction));
  logger.gap();
  logger.line(`${plannedActions.length} change(s) for ${releaseLabel}.`);

  const isDryRun = commandInput.dryRun == true;

  if (isDryRun) {
    logger.ok('Dry run complete; no changes were made.');
    return;
  }

  const hasNoPlannedChanges = plannedActions.length == 0;

  if (hasNoPlannedChanges) {
    logger.skip('Nothing to apply; everything is already in sync.');
    return;
  }

  const confirmed = await confirmAction(
    `Apply ${plannedActions.length} change(s) to ${releaseLabel}?`,
    commandInput.yes,
  );

  const isDeclined = confirmed == false;

  if (isDeclined) {
    logger.skip('No TestFlight changes were applied.');
    return;
  }

  const appliedReport = await reconcileBetaReview(appleStore, {
    ...reconciliationInput,
    dryRun: false,
  });
  const actionSummary = summarizeBetaReview(appliedReport.actions);
  const appliedTitle = receiptTitle(actionSummary.failed);
  const appliedLines = appliedReport.actions.map(renderBetaAction);

  logger.box(appliedTitle, appliedLines);

  const hasFailedActions = actionSummary.failed > 0;

  if (hasFailedActions) {
    throw new Error(`${actionSummary.failed} TestFlight action(s) failed.`);
  }
}
