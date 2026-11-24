// Reads App Store Connect and Google Play, then saves that copy under the chosen name.

import { createLogger, type Logger } from '../services/platform/logger.ts';
import { completeCommand } from '../terminal/command-exit.ts';
import type { CaptureReport } from '../types/snapshot.ts';
import { captureSnapshot, type CaptureResult } from './orchestrator.ts';
import { listSnapshotSources, registerBuiltinSources } from './registry.ts';
import { snapshotFailure } from './snapshot-failure.ts';
import { SNAPSHOT_STORES, storeLabel } from './snapshot-report.ts';
import {
  captureContextFromSession,
  currentIsoTime,
  loadSnapshotStoreSession,
} from './snapshot-store-session.ts';
import { saveSnapshot } from './store.ts';

export type CreateCommand = {
  operation: 'create';
  name?: string;
  app?: string;
  json?: boolean;
};

export function defaultSnapshotName(capturedAt: string): string {
  // Replaces colons and dots so the timestamp can be a file name.
  return `snapshot-${capturedAt.replace(/[:.]/g, '-')}`;
}

function renderCaptureReport(logger: Logger, captureReport: CaptureReport): void {
  const captureOutcome = captureReport.outcome;

  if (captureOutcome.state == 'skipped') {
    logger.warn(`${captureReport.title}: skipped - ${captureOutcome.reason}`);
    showSkipHint(logger, captureOutcome.hint);

    return;
  }

  if (captureOutcome.state == 'errored') {
    logger.error(`${captureReport.title}: ${captureOutcome.error}`);

    return;
  }

  if (captureOutcome.state != 'captured') {
    return;
  }

  renderSkippedApps(logger, captureReport.title, captureOutcome.skippedApps);

  for (const appEntities of captureOutcome.apps) {
    logger.step(captureReport.title, `${appEntities.app}: ${appEntities.entities.length} item(s)`);
  }
}

function showSkipHint(logger: Logger, hint: string | undefined): void {
  if (hint == null) {
    return;
  }

  logger.tip(hint);
}

function renderSkippedApps(
  logger: Logger,
  title: string,
  skippedApps: readonly { app: string; reason: string }[] | undefined,
): void {
  if (skippedApps == null) {
    return;
  }

  for (const skipped of skippedApps) {
    logger.warn(`${title} (${skipped.app}): skipped - ${skipped.reason}`);
  }
}

function renderCapture(logger: Logger, captureOutcome: CaptureResult, snapshotPath: string): void {
  for (const snapshotStore of SNAPSHOT_STORES) {
    const storeReports = captureOutcome.snapshot.reports.filter(function sameStore(captureReport) {
      return captureReport.store == snapshotStore;
    });

    if (storeReports.length == 0) {
      continue;
    }

    logger.note(storeLabel(snapshotStore));

    for (const captureReport of storeReports) {
      renderCaptureReport(logger, captureReport);
    }
  }

  const summaryParts = [`${captureOutcome.entityCount} item(s)`];

  if (captureOutcome.skippedCount > 0) {
    summaryParts.push(`${captureOutcome.skippedCount} skipped`);
  }

  if (captureOutcome.errorCount > 0) {
    summaryParts.push(`${captureOutcome.errorCount} unreadable`);
  }

  logger.gap();
  logger.note(
    `Snapshot "${captureOutcome.snapshot.name}" saved to ${snapshotPath} (${summaryParts.join(', ')})`,
  );

  if (captureOutcome.errorCount > 0) {
    logger.warn('Snapshot is incomplete - a surface could not be read.');
  }
}

export async function createSnapshot(command: CreateCommand): Promise<void> {
  const logger = createLogger(false);

  registerBuiltinSources();

  const capturedAt = currentIsoTime();
  let snapshotName = command.name;

  if (snapshotName == null) {
    snapshotName = defaultSnapshotName(capturedAt);
  }

  const storeSession = await loadSnapshotStoreSession(command.app);
  const captureFromSession = captureContextFromSession(storeSession);
  const snapshotSources = listSnapshotSources();
  const captureOutcome = await captureSnapshot(captureFromSession, snapshotSources, {
    name: snapshotName,
    capturedAt,
  });
  try {
    var snapshotPath = await saveSnapshot(captureOutcome.snapshot);
  } catch (cause) {
    throw snapshotFailure('save store snapshot', cause);
  }

  if (command.json == true) {
    const serialized = JSON.stringify({ ...captureOutcome, file: snapshotPath }, null, 2);
    logger.line(serialized);
  }

  if (command.json != true) {
    renderCapture(logger, captureOutcome, snapshotPath);
  }

  completeCommand(captureOutcome.exitCode);
}
