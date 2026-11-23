// Submits one build to TestFlight Beta App Review and shows the planned steps.

import { createLogger } from '../services/platform/logger.ts';
import { loadActiveAppleStore } from '../cli/commands/store/apple/apple-store-command.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import {
  loadBetaReviewConfig,
  reconcileBetaReview,
  summarizeBetaReview,
  type BetaReviewReconcileInput,
} from './beta-review.ts';
import { confirmAction, loadSelectedAppleApp, testflightFailure } from './testflight-group.ts';

export interface ReleaseCommandInput {
  operation: 'release';
  app?: string;
  build?: string;
  whatsNew?: string;
  locale: string;
  config: string;
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

  const betaReviewConfig = await loadBetaReviewConfig(commandInput.config);

  return betaReviewConfig.whatToTest;
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
    throw testflightFailure(
      'apply beta release',
      `${actionSummary.failed} TestFlight action(s) failed.`,
    );
  }
}
