import { FileSystem } from '@effect/platform';
import { Clock, Data, Effect, Schema } from 'effect';
import { loadConfig } from '../config/config.js';
import { loadActiveAscKey } from '../credentials/accounts.js';
import { loadServiceAccount } from '../credentials/androidKeystore.js';
import {
  AppleStoreClientService,
  type EffectAppStoreConnectClient,
} from '../services/appleStoreClient.js';
import {
  type EffectGooglePlayClient,
  GoogleStoreClientService,
} from '../services/googleStoreClient.js';
import { createLogger, type Logger } from '../services/logger.js';
import { selectApps } from '../store/syncJobs.js';
import { CommandExitSchema, completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { AppDescriptor } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';
import type { ActionStatus, PlannedAction } from '../types/reconcile.js';
import type {
  AppEntities,
  CaptureReport,
  RestoreContext,
  Snapshot,
  SnapshotContext,
  SnapshotSource,
  SnapshotStore,
} from '../types/snapshot.js';
import { AUTO_SNAPSHOT_PREFIX } from './autoSnapshot.js';
import { diffSnapshots, type DiffChange, type SnapshotDiff } from './diff.js';
import { captureSnapshot, type CaptureResult } from './orchestrator.js';
import { listSnapshotSources, registerBuiltinSources } from './registry.js';
import {
  deleteSnapshot,
  listSnapshots,
  loadSnapshot,
  planPrune,
  saveSnapshot,
  type PruneCriteria,
} from './store.js';

const LIVE_SNAPSHOT = 'live';
const SNAPSHOT_STORES: readonly SnapshotStore[] = ['appstore', 'play'];
const DIFF_MARKER: Readonly<Record<DiffChange, string>> = {
  added: '+',
  removed: '-',
  changed: '~',
};
const RESTORE_MARKER: Readonly<Record<ActionStatus, string>> = {
  planned: '+',
  applied: 'OK',
  skipped: '-',
  failed: 'x',
};

const OptionalString = Schema.optionalWith(Schema.String, { exact: true });
const OptionalBoolean = Schema.optionalWith(Schema.Boolean, { exact: true });
const CaptureInputSchema = Schema.Struct({
  operation: Schema.Literal('create'),
  name: OptionalString,
  app: OptionalString,
  json: OptionalBoolean,
});
const ListInputSchema = Schema.Struct({
  operation: Schema.Literal('list'),
  json: OptionalBoolean,
});
const DiffInputSchema = Schema.Struct({
  operation: Schema.Literal('diff'),
  baseline: Schema.String,
  against: Schema.String,
  app: OptionalString,
  json: OptionalBoolean,
});
const ExportInputSchema = Schema.Struct({
  operation: Schema.Literal('export'),
  name: Schema.String,
  out: OptionalString,
});
const DeleteInputSchema = Schema.Struct({
  operation: Schema.Literal('delete'),
  name: Schema.String,
  json: OptionalBoolean,
});
const PruneOptionsSchema = Schema.Struct({
  keep: OptionalString,
  olderThan: OptionalString,
  yes: OptionalBoolean,
  json: OptionalBoolean,
});
const PruneInputSchema = Schema.Struct({
  operation: Schema.Literal('prune'),
  options: PruneOptionsSchema,
});
const RestoreInputSchema = Schema.Struct({
  operation: Schema.Literal('restore'),
  name: Schema.String,
  app: OptionalString,
  source: OptionalString,
  yes: OptionalBoolean,
  json: OptionalBoolean,
});

/** Schema for every operation accepted by the snapshot command family. */
export const SnapshotCommandInputSchema = Schema.Union(
  CaptureInputSchema,
  ListInputSchema,
  DiffInputSchema,
  ExportInputSchema,
  DeleteInputSchema,
  PruneInputSchema,
  RestoreInputSchema,
);

/** One decoded operation in the snapshot command family. */
export type SnapshotCommandInput = Schema.Schema.Type<typeof SnapshotCommandInputSchema>;

type PruneOptions = Schema.Schema.Type<typeof PruneOptionsSchema>;

/** A snapshot command failed while reading, writing, or restoring store state. */
export const SnapshotCommandFailureSchema = Schema.Struct({
  _tag: Schema.Literal('SnapshotCommandFailure'),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
});

export type SnapshotCommandFailure = Schema.Schema.Type<typeof SnapshotCommandFailureSchema>;
export const makeSnapshotCommandFailure =
  Data.tagged<SnapshotCommandFailure>('SnapshotCommandFailure');

type SnapshotCommandOutcome = CommandExit | SnapshotCommandFailure;

type RestorableSource = SnapshotSource & {
  restore: NonNullable<SnapshotSource['restore']>;
};

type SourceRestore = Readonly<{
  source: string;
  title: string;
  actions: readonly PlannedAction[];
}>;

/** Convert an unknown failure into the snapshot command's tagged channel. */
const snapshotFailure = (
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): SnapshotCommandFailure => {
  let message = fallbackMessage;
  if (message === undefined && cause instanceof Error) message = cause.message;
  if (message === undefined) message = `${operation} failed.`;
  return makeSnapshotCommandFailure({ operation, message, cause });
};

/** Map one terminal write into the snapshot command's error channel. */
const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, SnapshotCommandFailure> =>
  logWrite.pipe(Effect.mapError((cause) => snapshotFailure(operation, cause)));

/** Read the current instant through Effect's clock service. */
const currentIsoTime = (): Effect.Effect<string> =>
  Clock.currentTimeMillis.pipe(Effect.map((epochMillis) => new Date(epochMillis).toISOString()));

/** Narrow discovered apps through the snapshot selector in the typed error channel. */
const selectSnapshotApps = (
  discoveredApps: readonly AppDescriptor[],
  appSelector: string | undefined,
): Effect.Effect<readonly AppDescriptor[], SnapshotCommandFailure> =>
  selectApps(discoveredApps, appSelector).pipe(
    Effect.mapError((cause) => snapshotFailure('select snapshot apps', cause)),
  );

/** Loaded config, selected apps, and store clients for one snapshot command. */
type SnapshotStoreSession = Readonly<{
  config: LaunchConfig;
  apps: readonly AppDescriptor[];
  ascClient: EffectAppStoreConnectClient | null;
  playClient: EffectGooglePlayClient | null;
}>;

/** Human-readable store label for snapshot sections. */
const storeLabel = (snapshotStore: SnapshotStore): string => {
  if (snapshotStore === 'appstore') return 'App Store';
  return 'Google Play';
};

/** Load configuration, credentials, and store clients once for capture or restore. */
const loadSnapshotStoreSession = (appSelector: string | undefined) =>
  Effect.gen(function* () {
    const loadedConfiguration = yield* loadConfig().pipe(
      Effect.mapError((cause) => snapshotFailure('load Launch configuration', cause)),
    );
    const ascKey = yield* loadActiveAscKey().pipe(
      Effect.mapError((cause) => snapshotFailure('load active Apple account', cause)),
    );
    const appleStoreClient = yield* AppleStoreClientService;
    let ascClient: EffectAppStoreConnectClient | null = null;
    if (ascKey !== null) {
      ascClient = yield* appleStoreClient
        .createEffectClient(ascKey)
        .pipe(Effect.mapError((cause) => snapshotFailure('create App Store client', cause)));
    }
    const serviceAccountJson = yield* loadServiceAccount().pipe(
      Effect.mapError((cause) => snapshotFailure('load Google service account', cause)),
    );
    const googleStoreClient = yield* GoogleStoreClientService;
    let playClient: EffectGooglePlayClient | null = null;
    if (serviceAccountJson !== null) {
      playClient = yield* googleStoreClient
        .createEffectClient(serviceAccountJson)
        .pipe(Effect.mapError((cause) => snapshotFailure('create Google Play client', cause)));
    }
    const selectedApps = yield* selectSnapshotApps(loadedConfiguration.apps, appSelector);
    return {
      config: loadedConfiguration.config,
      apps: selectedApps,
      ascClient,
      playClient,
    } satisfies SnapshotStoreSession;
  });

/** Read-only capture context over one loaded store session. */
const captureContextFromSession = (storeSession: SnapshotStoreSession): SnapshotContext => ({
  config: storeSession.config,
  apps: storeSession.apps,
  resolveAscApi: () => Effect.succeed(storeSession.ascClient),
  resolvePlayApi: () => Effect.succeed(storeSession.playClient),
});

/** Write-capable restore context over one loaded store session. */
const restoreContextFromSession = (storeSession: SnapshotStoreSession): RestoreContext => ({
  config: storeSession.config,
  apps: storeSession.apps,
  resolveAscWriteClient: () => Effect.succeed(storeSession.ascClient),
  resolvePlayWriteClient: () => Effect.succeed(storeSession.playClient),
});

/** Create the filesystem-safe default name for one capture instant. */
export const defaultSnapshotName = (capturedAt: string): string =>
  `snapshot-${capturedAt.replace(/[:.]/g, '-')}`;

/** Count captured entities across all snapshot surfaces. */
export const countEntities = (snapshot: Snapshot): number => {
  let entityCount = 0;
  for (const captureReport of snapshot.reports) {
    if (captureReport.outcome.state !== 'captured') continue;
    for (const appEntities of captureReport.outcome.apps)
      entityCount += appEntities.entities.length;
  }
  return entityCount;
};

/** Render one captured, skipped, or errored surface. */
const renderCaptureReport = (
  logger: Logger,
  captureReport: CaptureReport,
): Effect.Effect<void, SnapshotCommandFailure> =>
  Effect.gen(function* () {
    const captureOutcome = captureReport.outcome;
    if (captureOutcome.state === 'skipped') {
      yield* writeLog(
        'render snapshot capture',
        logger.warn(`${captureReport.title}: skipped - ${captureOutcome.reason}`),
      );
      if (captureOutcome.hint !== undefined)
        yield* writeLog('render snapshot capture hint', logger.tip(captureOutcome.hint));
      return;
    }
    if (captureOutcome.state === 'errored') {
      yield* writeLog(
        'render snapshot capture error',
        logger.error(`${captureReport.title}: ${captureOutcome.error}`),
      );
      return;
    }
    if (captureOutcome.state !== 'captured') return;
    for (const appEntities of captureOutcome.apps) {
      yield* writeLog(
        'render snapshot capture',
        logger.step(
          captureReport.title,
          `${appEntities.app}: ${appEntities.entities.length} item(s)`,
        ),
      );
    }
  });

/** Render one complete snapshot capture. */
const renderCapture = (
  logger: Logger,
  captureOutcome: CaptureResult,
  snapshotPath: string,
): Effect.Effect<void, SnapshotCommandFailure> =>
  Effect.gen(function* () {
    for (const snapshotStore of SNAPSHOT_STORES) {
      const storeReports = captureOutcome.snapshot.reports.filter(
        (captureReport) => captureReport.store === snapshotStore,
      );
      if (storeReports.length === 0) continue;
      yield* writeLog('render snapshot store', logger.note(storeLabel(snapshotStore)));
      yield* Effect.forEach(
        storeReports,
        (captureReport) => renderCaptureReport(logger, captureReport),
        { concurrency: 1, discard: true },
      );
    }
    const summaryParts = [`${captureOutcome.entityCount} item(s)`];
    if (captureOutcome.skippedCount > 0)
      summaryParts.push(`${captureOutcome.skippedCount} skipped`);
    if (captureOutcome.errorCount > 0) summaryParts.push(`${captureOutcome.errorCount} unreadable`);
    yield* writeLog('render snapshot capture', logger.gap());
    yield* writeLog(
      'render snapshot capture summary',
      logger.note(
        `Snapshot "${captureOutcome.snapshot.name}" saved to ${snapshotPath} (${summaryParts.join(', ')})`,
      ),
    );
    if (captureOutcome.errorCount > 0)
      yield* writeLog(
        'render snapshot capture warning',
        logger.warn('Snapshot is incomplete - a surface could not be read.'),
      );
  });

/** Capture live state and persist it under the requested name. */
const createSnapshot = (commandInput: Extract<SnapshotCommandInput, { operation: 'create' }>) =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    yield* Effect.sync(registerBuiltinSources);
    const capturedAt = yield* currentIsoTime();
    let snapshotName = commandInput.name;
    if (snapshotName === undefined) snapshotName = defaultSnapshotName(capturedAt);
    const storeSession = yield* loadSnapshotStoreSession(commandInput.app);
    const captureOutcome = yield* captureSnapshot(
      captureContextFromSession(storeSession),
      listSnapshotSources(),
      {
        name: snapshotName,
        capturedAt,
      },
    );
    const snapshotPath = yield* saveSnapshot(captureOutcome.snapshot).pipe(
      Effect.mapError((cause) => snapshotFailure('save store snapshot', cause)),
    );
    if (commandInput.json === true)
      yield* writeLog(
        'render snapshot capture JSON',
        logger.line(JSON.stringify({ ...captureOutcome, file: snapshotPath }, null, 2)),
      );
    else yield* renderCapture(logger, captureOutcome, snapshotPath);
    yield* completeCommand(captureOutcome.exitCode);
  });

/** Render a snapshot diff grouped by store. */
const renderDiff = (
  logger: Logger,
  snapshotDiff: SnapshotDiff,
  baselineName: string,
  againstName: string,
): Effect.Effect<void, SnapshotCommandFailure> =>
  Effect.gen(function* () {
    yield* writeLog('render snapshot diff', logger.note(`${baselineName} -> ${againstName}`));
    if (snapshotDiff.entries.length === 0) {
      yield* writeLog('render snapshot diff', logger.note('In sync - no differences.'));
      return;
    }
    for (const snapshotStore of SNAPSHOT_STORES) {
      const storeEntries = snapshotDiff.entries.filter(
        (diffEntry) => diffEntry.store === snapshotStore,
      );
      if (storeEntries.length === 0) continue;
      yield* writeLog('render snapshot diff store', logger.note(storeLabel(snapshotStore)));
      for (const diffEntry of storeEntries)
        yield* writeLog(
          'render snapshot diff entry',
          logger.note(
            `  ${DIFF_MARKER[diffEntry.change]} ${diffEntry.app} ${diffEntry.key} - ${diffEntry.summary}`,
          ),
        );
    }
    yield* writeLog('render snapshot diff', logger.gap());
    yield* writeLog(
      'render snapshot diff summary',
      logger.note(
        `Diff: ${snapshotDiff.addedCount} added, ${snapshotDiff.changedCount} changed, ${snapshotDiff.removedCount} removed`,
      ),
    );
  });

/** Report an unknown saved snapshot without throwing from production code. */
const reportMissingSnapshot = (
  logger: Logger,
  snapshotName: string,
): Effect.Effect<void, SnapshotCommandOutcome> =>
  Effect.gen(function* () {
    yield* writeLog(
      'render missing snapshot',
      logger.error(`No snapshot named "${snapshotName}".`),
    );
    yield* writeLog(
      'render missing snapshot hint',
      logger.tip('run `launch snapshot list` to see saved snapshots'),
    );
    yield* completeCommand(1);
  });

/** Compare a saved baseline with another save or a fresh live capture. */
const diffSnapshot = (commandInput: Extract<SnapshotCommandInput, { operation: 'diff' }>) =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const baselineSnapshot = yield* loadSnapshot(commandInput.baseline);
    if (baselineSnapshot === null) {
      yield* reportMissingSnapshot(logger, commandInput.baseline);
      return;
    }
    let againstSnapshot: Snapshot;
    if (commandInput.against === LIVE_SNAPSHOT) {
      yield* Effect.sync(registerBuiltinSources);
      const storeSession = yield* loadSnapshotStoreSession(commandInput.app);
      const liveCapture = yield* captureSnapshot(
        captureContextFromSession(storeSession),
        listSnapshotSources(),
        {
          name: LIVE_SNAPSHOT,
          capturedAt: yield* currentIsoTime(),
        },
      );
      againstSnapshot = liveCapture.snapshot;
    } else {
      const savedComparison = yield* loadSnapshot(commandInput.against);
      if (savedComparison === null) {
        yield* reportMissingSnapshot(logger, commandInput.against);
        return;
      }
      againstSnapshot = savedComparison;
    }
    const snapshotDiff = diffSnapshots(baselineSnapshot, againstSnapshot);
    if (commandInput.json === true)
      yield* writeLog(
        'render snapshot diff JSON',
        logger.line(JSON.stringify(snapshotDiff, null, 2)),
      );
    else yield* renderDiff(logger, snapshotDiff, commandInput.baseline, commandInput.against);
  });

/** Export a saved snapshot to stdout or a requested file. */
const exportSnapshot = (commandInput: Extract<SnapshotCommandInput, { operation: 'export' }>) =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const savedSnapshot = yield* loadSnapshot(commandInput.name);
    if (savedSnapshot === null) {
      yield* reportMissingSnapshot(logger, commandInput.name);
      return;
    }
    const snapshotJson = JSON.stringify(savedSnapshot, null, 2);
    if (commandInput.out === undefined) {
      yield* writeLog('render snapshot export', logger.line(snapshotJson));
      return;
    }
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem
      .writeFileString(commandInput.out, snapshotJson)
      .pipe(Effect.mapError((cause) => snapshotFailure('write snapshot export', cause)));
    yield* writeLog(
      'render snapshot export summary',
      logger.note(`Exported "${commandInput.name}" to ${commandInput.out}`),
    );
  });

/** List saved snapshots newest first. */
const listSavedSnapshots = (json: boolean | undefined) =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const savedSnapshots = yield* listSnapshots();
    if (json === true) {
      yield* writeLog(
        'render snapshot list JSON',
        logger.line(
          JSON.stringify(
            savedSnapshots.map((savedSnapshot) => ({
              name: savedSnapshot.name,
              capturedAt: savedSnapshot.capturedAt,
              entityCount: countEntities(savedSnapshot),
            })),
            null,
            2,
          ),
        ),
      );
      return;
    }
    if (savedSnapshots.length === 0) {
      yield* writeLog(
        'render empty snapshot list',
        logger.note('No snapshots yet. Capture one with `launch snapshot create`.'),
      );
      return;
    }
    for (const savedSnapshot of savedSnapshots)
      yield* writeLog(
        'render snapshot list entry',
        logger.step(
          'snapshot',
          `${savedSnapshot.name} - ${savedSnapshot.capturedAt} - ${countEntities(savedSnapshot)} item(s)`,
        ),
      );
  });

/** Delete one named saved snapshot. */
const removeSnapshot = (commandInput: Extract<SnapshotCommandInput, { operation: 'delete' }>) =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const savedSnapshot = yield* loadSnapshot(commandInput.name);
    if (savedSnapshot === null) {
      yield* reportMissingSnapshot(logger, commandInput.name);
      return;
    }
    const deleted = yield* deleteSnapshot(commandInput.name);
    if (commandInput.json === true) {
      yield* writeLog(
        'render deleted snapshot JSON',
        logger.line(JSON.stringify({ deleted, name: commandInput.name }, null, 2)),
      );
      return;
    }
    yield* writeLog(
      'render deleted snapshot',
      logger.note(`Deleted snapshot "${commandInput.name}".`),
    );
  });

/** Parse a non-negative integer prune option. */
export const parsePruneCount = (
  countText: string,
  flagName: string,
): Effect.Effect<number, SnapshotCommandFailure> => {
  const count = Number(countText);
  if (Number.isInteger(count) && count >= 0) return Effect.succeed(count);
  return Effect.fail(
    snapshotFailure(
      'parse snapshot prune option',
      countText,
      `${flagName} must be a non-negative integer.`,
    ),
  );
};

/** Prune user snapshots by count and age while preserving automatic safety baselines. */
const pruneSnapshots = (pruneOptions: PruneOptions) =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    if (pruneOptions.keep === undefined && pruneOptions.olderThan === undefined) {
      return yield* Effect.fail(
        snapshotFailure(
          'prune snapshots',
          pruneOptions,
          'Specify at least one of --keep or --older-than.',
        ),
      );
    }
    const pruneCriteria: PruneCriteria = {};
    if (pruneOptions.keep !== undefined)
      pruneCriteria.keep = yield* parsePruneCount(pruneOptions.keep, '--keep');
    if (pruneOptions.olderThan !== undefined)
      pruneCriteria.olderThanDays = yield* parsePruneCount(pruneOptions.olderThan, '--older-than');
    const savedSnapshots = yield* listSnapshots();
    const userSnapshots = savedSnapshots.filter(
      (savedSnapshot) => !savedSnapshot.name.startsWith(AUTO_SNAPSHOT_PREFIX),
    );
    const currentMillis = yield* Clock.currentTimeMillis;
    const snapshotsToPrune = planPrune(userSnapshots, pruneCriteria, new Date(currentMillis));
    const dryRun = pruneOptions.yes !== true;
    if (!dryRun) {
      for (const savedSnapshot of snapshotsToPrune) yield* deleteSnapshot(savedSnapshot.name);
    }
    if (pruneOptions.json === true) {
      yield* writeLog(
        'render snapshot prune JSON',
        logger.line(
          JSON.stringify(
            { pruned: snapshotsToPrune.map((savedSnapshot) => savedSnapshot.name), dryRun },
            null,
            2,
          ),
        ),
      );
      return;
    }
    if (snapshotsToPrune.length === 0) {
      yield* writeLog('render empty snapshot prune', logger.note('Nothing to prune.'));
      return;
    }
    for (const savedSnapshot of snapshotsToPrune) {
      let operationLabel = 'deleted';
      if (dryRun) operationLabel = 'would delete';
      yield* writeLog(
        'render snapshot prune entry',
        logger.step(operationLabel, `${savedSnapshot.name} - ${savedSnapshot.capturedAt}`),
      );
    }
    yield* writeLog('render snapshot prune', logger.gap());
    if (dryRun) {
      yield* writeLog(
        'render snapshot prune preview',
        logger.note(
          `${snapshotsToPrune.length} snapshot(s) would be deleted (dry-run - re-run with --yes to delete)`,
        ),
      );
      return;
    }
    yield* writeLog(
      'render snapshot prune summary',
      logger.note(`Pruned ${snapshotsToPrune.length} snapshot(s).`),
    );
  });

/** Select the saved entities for one source and optional app filter. */
export const savedEntitiesFor = (
  savedSnapshot: Snapshot,
  sourceId: string,
  appSelector: string | undefined,
): readonly AppEntities[] => {
  const captureReport = savedSnapshot.reports.find(
    (snapshotReport) => snapshotReport.id === sourceId,
  );
  if (captureReport === undefined) return [];
  if (captureReport.outcome.state !== 'captured') return [];
  if (appSelector === undefined) return captureReport.outcome.apps;
  const selectedNames = new Set(
    appSelector
      .split(',')
      .map((appName) => appName.trim())
      .filter(Boolean),
  );
  return captureReport.outcome.apps.filter((appEntities) => selectedNames.has(appEntities.app));
};

/** List captured surfaces without restore support. */
export const previewOnlyTitles = (
  savedSnapshot: Snapshot,
  sourceRestores: readonly SourceRestore[],
  sourceFilter: string | undefined,
): string[] => {
  const restoredSources = new Set(sourceRestores.map((sourceRestore) => sourceRestore.source));
  return savedSnapshot.reports
    .filter(
      (captureReport) =>
        captureReport.outcome.state === 'captured' && !restoredSources.has(captureReport.id),
    )
    .filter((captureReport) => {
      if (sourceFilter === undefined) return true;
      return captureReport.id === sourceFilter;
    })
    .map((captureReport) => `${captureReport.title} (${captureReport.id})`);
};

/** Render planned or applied restore actions. */
const renderRestore = (
  logger: Logger,
  savedSnapshot: Snapshot,
  snapshotName: string,
  sourceRestores: readonly SourceRestore[],
  dryRun: boolean,
  sourceFilter: string | undefined,
): Effect.Effect<void, SnapshotCommandFailure> =>
  Effect.gen(function* () {
    yield* writeLog('render snapshot restore', logger.note(`Restore "${snapshotName}" -> live`));
    const actionCount = sourceRestores.reduce(
      (totalActions, sourceRestore) => totalActions + sourceRestore.actions.length,
      0,
    );
    if (actionCount === 0)
      yield* writeLog(
        'render empty snapshot restore',
        logger.note(
          'Nothing to restore - the saved listing already matches live (or no restorable surface is in scope).',
        ),
      );
    for (const sourceRestore of sourceRestores) {
      if (sourceRestore.actions.length === 0) continue;
      yield* writeLog('render snapshot restore source', logger.note(sourceRestore.title));
      for (const restoreAction of sourceRestore.actions) {
        let errorSuffix = '';
        if (restoreAction.error !== undefined) errorSuffix = ` - ${restoreAction.error}`;
        yield* writeLog(
          'render snapshot restore action',
          logger.note(
            `  ${RESTORE_MARKER[restoreAction.status]} ${restoreAction.description}${errorSuffix}`,
          ),
        );
      }
    }
    const previewOnly = previewOnlyTitles(savedSnapshot, sourceRestores, sourceFilter);
    if (previewOnly.length > 0) {
      yield* writeLog('render snapshot restore preview', logger.gap());
      yield* writeLog(
        'render snapshot restore preview warning',
        logger.warn(`Preview-only (no restore support yet): ${previewOnly.join(', ')}`),
      );
      yield* writeLog(
        'render snapshot restore preview hint',
        logger.tip(
          'the Apple catalog captures a summary-grade record; restore is wired for the App Store listing + Play catalog',
        ),
      );
    }
    yield* writeLog('render snapshot restore', logger.gap());
    if (dryRun) {
      if (actionCount > 0)
        yield* writeLog(
          'render snapshot restore preview',
          logger.note('(dry-run - re-run with --yes to apply)'),
        );
      return;
    }
    const appliedCount = sourceRestores.reduce(
      (totalApplied, sourceRestore) =>
        totalApplied +
        sourceRestore.actions.filter((restoreAction) => restoreAction.status === 'applied').length,
      0,
    );
    const failedCount = sourceRestores.reduce(
      (totalFailed, sourceRestore) =>
        totalFailed +
        sourceRestore.actions.filter((restoreAction) => restoreAction.status === 'failed').length,
      0,
    );
    let failureSuffix = '';
    if (failedCount > 0) failureSuffix = `, ${failedCount} failed`;
    yield* writeLog(
      'render snapshot restore summary',
      logger.note(`Restored ${appliedCount} change(s)${failureSuffix}.`),
    );
  });

/** Restore restorable saved surfaces after showing the live-state preview. */
const restoreSnapshot = (commandInput: Extract<SnapshotCommandInput, { operation: 'restore' }>) =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const savedSnapshot = yield* loadSnapshot(commandInput.name);
    if (savedSnapshot === null) {
      yield* reportMissingSnapshot(logger, commandInput.name);
      return;
    }
    yield* Effect.sync(registerBuiltinSources);
    const snapshotSources = listSnapshotSources();
    const restorableSources = snapshotSources
      .filter(
        (snapshotSource): snapshotSource is RestorableSource =>
          typeof snapshotSource.restore === 'function',
      )
      .filter((snapshotSource) => {
        if (commandInput.source === undefined) return true;
        return snapshotSource.id === commandInput.source;
      })
      .filter(
        (snapshotSource) =>
          savedEntitiesFor(savedSnapshot, snapshotSource.id, commandInput.app).length > 0,
      );
    const storeSession = yield* loadSnapshotStoreSession(commandInput.app);
    const captureContext = captureContextFromSession(storeSession);
    const restoreContext = restoreContextFromSession(storeSession);
    const liveCapture = yield* captureSnapshot(captureContext, snapshotSources, {
      name: LIVE_SNAPSHOT,
      capturedAt: yield* currentIsoTime(),
    });
    const preview = diffSnapshots(savedSnapshot, liveCapture.snapshot);
    const dryRun = commandInput.yes !== true;
    const sourceRestores = yield* Effect.forEach(
      restorableSources,
      (snapshotSource) =>
        snapshotSource
          .restore({
            ctx: restoreContext,
            saved: savedEntitiesFor(savedSnapshot, snapshotSource.id, commandInput.app),
            dryRun,
          })
          .pipe(
            Effect.mapError((cause) => snapshotFailure(`restore ${snapshotSource.id}`, cause)),
            Effect.map((restoreReport) => ({
              source: snapshotSource.id,
              title: snapshotSource.title,
              actions: restoreReport.actions,
            })),
          ),
      { concurrency: 1 },
    );
    if (commandInput.json === true)
      yield* writeLog(
        'render snapshot restore JSON',
        logger.line(JSON.stringify({ preview, restored: sourceRestores, dryRun }, null, 2)),
      );
    else
      yield* renderRestore(
        logger,
        savedSnapshot,
        commandInput.name,
        sourceRestores,
        dryRun,
        commandInput.source,
      );
    const restoreFailed = sourceRestores.some((sourceRestore) =>
      sourceRestore.actions.some((restoreAction) => restoreAction.status === 'failed'),
    );
    if (restoreFailed) yield* completeCommand(1);
  });

/** Execute one decoded snapshot operation. */
const executeSnapshotCommand = (commandInput: SnapshotCommandInput) => {
  switch (commandInput.operation) {
    case 'create':
      return createSnapshot(commandInput);
    case 'list':
      return listSavedSnapshots(commandInput.json);
    case 'diff':
      return diffSnapshot(commandInput);
    case 'export':
      return exportSnapshot(commandInput);
    case 'delete':
      return removeSnapshot(commandInput);
    case 'prune':
      return pruneSnapshots(commandInput.options);
    case 'restore':
      return restoreSnapshot(commandInput);
  }
};

/** Decode and execute one snapshot command operation. */
export const snapshotCommandProgram = (rawCommandInput: unknown) =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(SnapshotCommandInputSchema)(rawCommandInput);
    return yield* executeSnapshotCommand(commandInput);
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(CommandExitSchema)(cause)) return cause;
      if (Schema.is(SnapshotCommandFailureSchema)(cause)) return cause;
      return snapshotFailure('run snapshot command', cause);
    }),
  );
