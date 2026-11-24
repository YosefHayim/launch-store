// Writes a saved copy back onto App Store Connect and Google Play.

import { createLogger, type Logger } from '../services/platform/logger.ts';
import { completeCommand } from '../terminal/command-exit.ts';
import type { ActionStatus, PlannedAction } from '../types/reconcile.ts';
import type {
  AppEntities,
  CaptureReport,
  RestoreContext,
  Snapshot,
  SnapshotSource,
} from '../types/snapshot.ts';
import { diffSnapshots } from './diff.ts';
import { captureSnapshot } from './orchestrator.ts';
import { listSnapshotSources, registerBuiltinSources } from './registry.ts';
import { snapshotFailure } from './snapshot-failure.ts';
import { reportMissingSnapshot } from './snapshot-report.ts';
import {
  LIVE_SNAPSHOT,
  captureContextFromSession,
  currentIsoTime,
  loadSnapshotStoreSession,
  type SnapshotStoreSession,
} from './snapshot-store-session.ts';
import { loadSnapshot } from './store.ts';

const restoreMarker: Readonly<Record<ActionStatus, string>> = {
  planned: '+',
  applied: 'OK',
  skipped: '-',
  failed: 'x',
};

export type RestoreCommand = {
  operation: 'restore';
  name: string;
  app?: string;
  source?: string;
  yes?: boolean;
  json?: boolean;
};

type RestorableSource = SnapshotSource & {
  restore: NonNullable<SnapshotSource['restore']>;
};

export type SourceRestore = Readonly<{
  source: string;
  title: string;
  actions: readonly PlannedAction[];
}>;

function restoreContextFromSession(storeSession: SnapshotStoreSession): RestoreContext {
  return {
    config: storeSession.config,
    apps: storeSession.apps,
    readAscWriteClient: function readAscWriteClient() {
      return Promise.resolve(storeSession.ascClient);
    },
    readPlayWriteClient: storeSession.playClient,
  };
}

export function savedEntitiesFor(
  savedSnapshot: Snapshot,
  sourceId: string,
  appSelector: string | undefined,
): readonly AppEntities[] {
  const captureReport = savedSnapshot.reports.find(function sameSource(snapshotReport) {
    return snapshotReport.id == sourceId;
  });

  if (captureReport == null) {
    return [];
  }

  if (captureReport.outcome.state != 'captured') {
    return [];
  }

  if (appSelector == null) {
    return captureReport.outcome.apps;
  }

  const selectedNames = new Set(
    appSelector
      .split(',')
      .map(function trimName(appName) {
        return appName.trim();
      })
      .filter(function hasName(appName) {
        return appName.length > 0;
      }),
  );

  return captureReport.outcome.apps.filter(function selectedApp(appEntities) {
    return selectedNames.has(appEntities.app);
  });
}

export function previewOnlyTitles(
  savedSnapshot: Snapshot,
  sourceRestores: readonly SourceRestore[],
  sourceFilter: string | undefined,
): string[] {
  const restoredSources = new Set(
    sourceRestores.map(function sourceId(sourceRestore) {
      return sourceRestore.source;
    }),
  );
  const titles: string[] = [];

  for (const captureReport of savedSnapshot.reports) {
    if (isPreviewOnly(captureReport, restoredSources, sourceFilter) == false) {
      continue;
    }

    titles.push(`${captureReport.title} (${captureReport.id})`);
  }

  return titles;
}

function isPreviewOnly(
  captureReport: CaptureReport,
  restoredSources: ReadonlySet<string>,
  sourceFilter: string | undefined,
): boolean {
  if (captureReport.outcome.state != 'captured') {
    return false;
  }

  if (restoredSources.has(captureReport.id)) {
    return false;
  }

  if (sourceFilter == null) {
    return true;
  }

  return captureReport.id == sourceFilter;
}

function renderRestore(
  logger: Logger,
  savedSnapshot: Snapshot,
  snapshotName: string,
  sourceRestores: readonly SourceRestore[],
  dryRun: boolean,
  sourceFilter: string | undefined,
): void {
  logger.note(`Restore "${snapshotName}" -> live`);

  const actionCount = sourceRestores.reduce(function addActions(totalActions, sourceRestore) {
    return totalActions + sourceRestore.actions.length;
  }, 0);

  if (actionCount == 0) {
    logger.note(
      'Nothing to restore - the saved listing already matches live (or no restorable surface is in scope).',
    );
  }

  for (const sourceRestore of sourceRestores) {
    renderSourceRestore(logger, sourceRestore);
  }

  const previewOnly = previewOnlyTitles(savedSnapshot, sourceRestores, sourceFilter);

  if (previewOnly.length > 0) {
    logger.gap();
    logger.warn(`Preview-only (no restore support yet): ${previewOnly.join(', ')}`);
    logger.tip(
      'the Apple catalog captures a summary-grade record; restore is wired for the App Store listing + Play catalog',
    );
  }

  logger.gap();

  if (dryRun) {
    notePendingRestore(logger, actionCount);

    return;
  }

  logger.note(
    `Restored ${appliedCount(sourceRestores)} change(s)${failureSuffix(sourceRestores)}.`,
  );
}

function notePendingRestore(logger: Logger, actionCount: number): void {
  if (actionCount == 0) {
    return;
  }

  logger.note('(dry-run - re-run with --yes to apply)');
}

function renderSourceRestore(logger: Logger, sourceRestore: SourceRestore): void {
  if (sourceRestore.actions.length == 0) {
    return;
  }

  logger.note(sourceRestore.title);

  for (const restoreAction of sourceRestore.actions) {
    let errorSuffix = '';

    if (restoreAction.error != null) {
      errorSuffix = ` - ${restoreAction.error}`;
    }

    logger.note(
      `  ${restoreMarker[restoreAction.status]} ${restoreAction.description}${errorSuffix}`,
    );
  }
}

function appliedCount(sourceRestores: readonly SourceRestore[]): number {
  return sourceRestores.reduce(function addApplied(totalApplied, sourceRestore) {
    return totalApplied + sourceRestore.actions.filter(isApplied).length;
  }, 0);
}

function isApplied(restoreAction: PlannedAction): boolean {
  return restoreAction.status == 'applied';
}

function failureSuffix(sourceRestores: readonly SourceRestore[]): string {
  const failedCount = sourceRestores.reduce(function addFailed(totalFailed, sourceRestore) {
    return totalFailed + sourceRestore.actions.filter(isFailed).length;
  }, 0);

  if (failedCount > 0) {
    return `, ${failedCount} failed`;
  }

  return '';
}

function isFailed(restoreAction: PlannedAction): boolean {
  return restoreAction.status == 'failed';
}

function isRestorableSource(snapshotSource: SnapshotSource): snapshotSource is RestorableSource {
  return typeof snapshotSource.restore == 'function';
}

function matchesSourceFilter(
  snapshotSource: SnapshotSource,
  sourceFilter: string | undefined,
): boolean {
  if (sourceFilter == null) {
    return true;
  }

  return snapshotSource.id == sourceFilter;
}

async function restoreOneSource(
  snapshotSource: RestorableSource,
  restoreContext: RestoreContext,
  savedSnapshot: Snapshot,
  appSelector: string | undefined,
  dryRun: boolean,
): Promise<SourceRestore> {
  try {
    const restoreReport = await snapshotSource.restore({
      ctx: restoreContext,
      saved: savedEntitiesFor(savedSnapshot, snapshotSource.id, appSelector),
      dryRun,
    });

    return {
      source: snapshotSource.id,
      title: snapshotSource.title,
      actions: restoreReport.actions,
    };
  } catch (cause) {
    throw snapshotFailure(`restore ${snapshotSource.id}`, cause);
  }
}

export async function restoreSnapshot(command: RestoreCommand): Promise<void> {
  const logger = createLogger(false);
  const savedSnapshot = await loadSnapshot(command.name);

  if (savedSnapshot == null) {
    reportMissingSnapshot(logger, command.name);

    return;
  }

  registerBuiltinSources();

  const restorableSources = listSnapshotSources()
    .filter(isRestorableSource)
    .filter(function selectedSource(snapshotSource) {
      return matchesSourceFilter(snapshotSource, command.source);
    })
    .filter(function hasSavedEntities(snapshotSource) {
      return savedEntitiesFor(savedSnapshot, snapshotSource.id, command.app).length > 0;
    });
  const storeSession = await loadSnapshotStoreSession(command.app);
  const captureFromSession = captureContextFromSession(storeSession);
  const snapshotSources = listSnapshotSources();
  const liveCapture = await captureSnapshot(captureFromSession, snapshotSources, {
    name: LIVE_SNAPSHOT,
    capturedAt: currentIsoTime(),
  });
  const preview = diffSnapshots(savedSnapshot, liveCapture.snapshot);
  const dryRun = command.yes != true;
  const restoreContext = restoreContextFromSession(storeSession);
  const sourceRestores: SourceRestore[] = [];

  for (const snapshotSource of restorableSources) {
    const sourceRestore = await restoreOneSource(
      snapshotSource,
      restoreContext,
      savedSnapshot,
      command.app,
      dryRun,
    );

    sourceRestores.push(sourceRestore);
  }

  if (command.json == true) {
    const serialized = JSON.stringify({ preview, restored: sourceRestores, dryRun }, null, 2);
    logger.line(serialized);
  }

  if (command.json != true) {
    renderRestore(logger, savedSnapshot, command.name, sourceRestores, dryRun, command.source);
  }

  if (sourceRestores.some(hasFailedAction)) {
    completeCommand(1);
  }
}

function hasFailedAction(sourceRestore: SourceRestore): boolean {
  return sourceRestore.actions.some(isFailed);
}
