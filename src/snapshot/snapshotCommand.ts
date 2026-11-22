import { writeFile } from 'node:fs/promises';
import { loadConfig } from '../config/config.ts';
import { loadActiveAscKey } from '../credentials/accounts.ts';
import { hasMessage } from '../services/platform/errorMessage.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import {
  AppleStoreClientService,
  type EffectAppStoreConnectClient,
} from '../services/stores/appleStoreClient.ts';
import { createPlayClientResolver } from '../store/shared/storeClients.ts';
import { selectApps } from '../store/shared/syncJobs.ts';
import { completeCommand, isCommandExit } from '../terminal/commandExit.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { LaunchConfig } from '../types/config.ts';
import type { ActionStatus, PlannedAction } from '../types/reconcile.ts';
import type {
  AppEntities,
  CaptureReport,
  RestoreContext,
  Snapshot,
  SnapshotContext,
  SnapshotSource,
  SnapshotStore,
} from '../types/snapshot.ts';
import { AUTO_SNAPSHOT_PREFIX } from './autoSnapshot.ts';
import { diffSnapshots, type DiffChange, type SnapshotDiff } from './diff.ts';
import { captureSnapshot, type CaptureResult } from './orchestrator.ts';
import { listSnapshotSources, registerBuiltinSources } from './registry.ts';
import {
  deleteSnapshot,
  listSnapshots,
  loadSnapshot,
  planPrune,
  saveSnapshot,
  type PruneCriteria,
} from './store.ts';

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

type CreateCommand = {
  operation: 'create';
  name?: string;
  app?: string;
  json?: boolean;
};

type ListCommand = {
  operation: 'list';
  json?: boolean;
};

type DiffCommand = {
  operation: 'diff';
  baseline: string;
  against: string;
  app?: string;
  json?: boolean;
};

type ExportCommand = {
  operation: 'export';
  name: string;
  out?: string;
};

type DeleteCommand = {
  operation: 'delete';
  name: string;
  json?: boolean;
};

type PruneOptions = {
  keep?: string;
  olderThan?: string;
  yes?: boolean;
  json?: boolean;
};

type PruneCommand = {
  operation: 'prune';
  options: PruneOptions;
};

type RestoreCommand = {
  operation: 'restore';
  name: string;
  app?: string;
  source?: string;
  yes?: boolean;
  json?: boolean;
};

type SnapshotCommandInput =
  | CreateCommand
  | ListCommand
  | DiffCommand
  | ExportCommand
  | DeleteCommand
  | PruneCommand
  | RestoreCommand;

export type SnapshotCommandFailure = {
  readonly _tag: 'SnapshotCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
};

type RestorableSource = SnapshotSource & {
  restore: NonNullable<SnapshotSource['restore']>;
};

type SourceRestore = Readonly<{
  source: string;
  title: string;
  actions: readonly PlannedAction[];
}>;

type PlayClientResolver = ReturnType<typeof createPlayClientResolver>;

type SnapshotStoreSession = Readonly<{
  config: LaunchConfig;
  apps: readonly AppDescriptor[];
  ascClient: EffectAppStoreConnectClient | null;
  playClient: PlayClientResolver;
}>;

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (typeof candidate != 'object') {
    return false;
  }

  if (candidate == null) {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function readExactOptionalString(record: Record<string, unknown>, key: string): string | null {
  if (Object.hasOwn(record, key) == false) {
    return null;
  }

  const field = record[key];

  if (typeof field != 'string') {
    throw new Error(`Snapshot command ${key} must be a string.`);
  }

  return field;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const text = readExactOptionalString(record, key);

  if (text == null) {
    throw new Error(`Snapshot command ${key} is required.`);
  }

  return text;
}

function readExactOptionalBoolean(record: Record<string, unknown>, key: string): boolean | null {
  if (Object.hasOwn(record, key) == false) {
    return null;
  }

  const field = record[key];

  if (typeof field != 'boolean') {
    throw new Error(`Snapshot command ${key} must be a boolean.`);
  }

  return field;
}

function readPruneOptions(record: Record<string, unknown>): PruneOptions {
  const options = record['options'];

  if (isRecord(options) == false) {
    throw new Error('Snapshot command prune options are missing.');
  }

  const pruneOptions: PruneOptions = {};
  const keep = readExactOptionalString(options, 'keep');
  const olderThan = readExactOptionalString(options, 'olderThan');
  const yes = readExactOptionalBoolean(options, 'yes');
  const json = readExactOptionalBoolean(options, 'json');

  if (keep != null) {
    pruneOptions.keep = keep;
  }

  if (olderThan != null) {
    pruneOptions.olderThan = olderThan;
  }

  if (yes != null) {
    pruneOptions.yes = yes;
  }

  if (json != null) {
    pruneOptions.json = json;
  }

  return pruneOptions;
}

function decodeCreate(record: Record<string, unknown>): CreateCommand {
  const command: CreateCommand = { operation: 'create' };
  const name = readExactOptionalString(record, 'name');
  const app = readExactOptionalString(record, 'app');
  const json = readExactOptionalBoolean(record, 'json');

  if (name != null) {
    command.name = name;
  }

  if (app != null) {
    command.app = app;
  }

  if (json != null) {
    command.json = json;
  }

  return command;
}

function decodeList(record: Record<string, unknown>): ListCommand {
  const command: ListCommand = { operation: 'list' };
  const json = readExactOptionalBoolean(record, 'json');

  if (json != null) {
    command.json = json;
  }

  return command;
}

function decodeDiff(record: Record<string, unknown>): DiffCommand {
  const command: DiffCommand = {
    operation: 'diff',
    baseline: readRequiredString(record, 'baseline'),
    against: readRequiredString(record, 'against'),
  };
  const app = readExactOptionalString(record, 'app');
  const json = readExactOptionalBoolean(record, 'json');

  if (app != null) {
    command.app = app;
  }

  if (json != null) {
    command.json = json;
  }

  return command;
}

function decodeExport(record: Record<string, unknown>): ExportCommand {
  const command: ExportCommand = {
    operation: 'export',
    name: readRequiredString(record, 'name'),
  };
  const out = readExactOptionalString(record, 'out');

  if (out != null) {
    command.out = out;
  }

  return command;
}

function decodeDelete(record: Record<string, unknown>): DeleteCommand {
  const command: DeleteCommand = {
    operation: 'delete',
    name: readRequiredString(record, 'name'),
  };
  const json = readExactOptionalBoolean(record, 'json');

  if (json != null) {
    command.json = json;
  }

  return command;
}

function decodePrune(record: Record<string, unknown>): PruneCommand {
  return { operation: 'prune', options: readPruneOptions(record) };
}

function decodeRestore(record: Record<string, unknown>): RestoreCommand {
  const command: RestoreCommand = {
    operation: 'restore',
    name: readRequiredString(record, 'name'),
  };
  const app = readExactOptionalString(record, 'app');
  const source = readExactOptionalString(record, 'source');
  const yes = readExactOptionalBoolean(record, 'yes');
  const json = readExactOptionalBoolean(record, 'json');

  if (app != null) {
    command.app = app;
  }

  if (source != null) {
    command.source = source;
  }

  if (yes != null) {
    command.yes = yes;
  }

  if (json != null) {
    command.json = json;
  }

  return command;
}

function decodeSnapshotCommandInput(rawCommand: unknown): SnapshotCommandInput {
  if (isRecord(rawCommand) == false) {
    throw new Error('Snapshot command input is malformed.');
  }

  const operation = rawCommand['operation'];

  if (operation == 'create') {
    return decodeCreate(rawCommand);
  }

  if (operation == 'list') {
    return decodeList(rawCommand);
  }

  if (operation == 'diff') {
    return decodeDiff(rawCommand);
  }

  if (operation == 'export') {
    return decodeExport(rawCommand);
  }

  if (operation == 'delete') {
    return decodeDelete(rawCommand);
  }

  if (operation == 'prune') {
    return decodePrune(rawCommand);
  }

  if (operation == 'restore') {
    return decodeRestore(rawCommand);
  }

  throw new Error('Snapshot command operation is unknown.');
}

export const SnapshotCommandInputSchema = decodeSnapshotCommandInput;

function makeSnapshotCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): SnapshotCommandFailure {
  return {
    _tag: 'SnapshotCommandFailure',
    operation: fields.operation,
    message: fields.message,
    cause: fields.cause,
  };
}

function isSnapshotCommandFailure(cause: unknown): cause is SnapshotCommandFailure {
  if (isRecord(cause) == false) {
    return false;
  }

  return cause['_tag'] == 'SnapshotCommandFailure';
}

function snapshotFailure(
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): SnapshotCommandFailure {
  return makeSnapshotCommandFailure({
    operation,
    message: failureMessage(operation, cause, fallbackMessage),
    cause,
  });
}

function failureMessage(operation: string, cause: unknown, fallbackMessage?: string): string {
  if (fallbackMessage != null) {
    return fallbackMessage;
  }

  if (hasMessage(cause)) {
    return cause.message;
  }

  return `${operation} failed.`;
}

function currentIsoTime(): string {
  return new Date(Date.now()).toISOString();
}

async function selectSnapshotApps(
  discoveredApps: readonly AppDescriptor[],
  appSelector: string | undefined,
): Promise<readonly AppDescriptor[]> {
  try {
    return await selectApps(discoveredApps, appSelector);
  } catch (cause) {
    throw snapshotFailure('select snapshot apps', cause);
  }
}

function createAscClient(ascKey: NonNullable<Awaited<ReturnType<typeof loadActiveAscKey>>>) {
  try {
    return AppleStoreClientService.createEffectClient(ascKey);
  } catch (cause) {
    throw snapshotFailure('create App Store client', cause);
  }
}

async function loadSnapshotStoreSession(
  appSelector: string | undefined,
): Promise<SnapshotStoreSession> {
  let loadedConfiguration: Awaited<ReturnType<typeof loadConfig>>;

  try {
    loadedConfiguration = await loadConfig();
  } catch (cause) {
    throw snapshotFailure('load Launch configuration', cause);
  }

  let ascKey: Awaited<ReturnType<typeof loadActiveAscKey>>;

  try {
    ascKey = await loadActiveAscKey();
  } catch (cause) {
    throw snapshotFailure('load active Apple account', cause);
  }

  let ascClient: EffectAppStoreConnectClient | null = null;

  if (ascKey != null) {
    ascClient = createAscClient(ascKey);
  }

  const playClient = createPlayClientResolver();
  const selectedApps = await selectSnapshotApps(loadedConfiguration.apps, appSelector);

  return {
    config: loadedConfiguration.config,
    apps: selectedApps,
    ascClient,
    playClient,
  };
}

function captureContextFromSession(storeSession: SnapshotStoreSession): SnapshotContext {
  return {
    config: storeSession.config,
    apps: storeSession.apps,
    resolveAscApi: function resolveAscApi() {
      return Promise.resolve(storeSession.ascClient);
    },
    resolvePlayApi: storeSession.playClient,
  };
}

function restoreContextFromSession(storeSession: SnapshotStoreSession): RestoreContext {
  return {
    config: storeSession.config,
    apps: storeSession.apps,
    resolveAscWriteClient: function resolveAscWriteClient() {
      return Promise.resolve(storeSession.ascClient);
    },
    resolvePlayWriteClient: storeSession.playClient,
  };
}

export function defaultSnapshotName(capturedAt: string): string {
  // Replaces colons and dots so the timestamp can be a file name.
  return `snapshot-${capturedAt.replace(/[:.]/g, '-')}`;
}

export function countEntities(snapshot: Snapshot): number {
  let entityCount = 0;

  for (const captureReport of snapshot.reports) {
    entityCount += capturedEntityCount(captureReport);
  }

  return entityCount;
}

function capturedEntityCount(captureReport: CaptureReport): number {
  if (captureReport.outcome.state != 'captured') {
    return 0;
  }

  let entityCount = 0;

  for (const appEntities of captureReport.outcome.apps) {
    entityCount += appEntities.entities.length;
  }

  return entityCount;
}

function storeLabel(snapshotStore: SnapshotStore): string {
  if (snapshotStore == 'appstore') {
    return 'App Store';
  }

  return 'Google Play';
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

async function createSnapshot(command: CreateCommand): Promise<void> {
  const logger = createLogger(false);
  registerBuiltinSources();
  const capturedAt = currentIsoTime();
  let snapshotName = command.name;

  if (snapshotName == null) {
    snapshotName = defaultSnapshotName(capturedAt);
  }

  const storeSession = await loadSnapshotStoreSession(command.app);
  const captureOutcome = await captureSnapshot(
    captureContextFromSession(storeSession),
    listSnapshotSources(),
    { name: snapshotName, capturedAt },
  );
  let snapshotPath: string;

  try {
    snapshotPath = await saveSnapshot(captureOutcome.snapshot);
  } catch (cause) {
    throw snapshotFailure('save store snapshot', cause);
  }

  if (command.json == true) {
    logger.line(JSON.stringify({ ...captureOutcome, file: snapshotPath }, null, 2));
  }

  if (command.json != true) {
    renderCapture(logger, captureOutcome, snapshotPath);
  }

  completeCommand(captureOutcome.exitCode);
}

function renderDiff(
  logger: Logger,
  snapshotDiff: SnapshotDiff,
  baselineName: string,
  againstName: string,
): void {
  logger.note(`${baselineName} -> ${againstName}`);

  if (snapshotDiff.entries.length == 0) {
    logger.note('In sync - no differences.');

    return;
  }

  for (const snapshotStore of SNAPSHOT_STORES) {
    const storeEntries = snapshotDiff.entries.filter(function sameStore(diffEntry) {
      return diffEntry.store == snapshotStore;
    });

    if (storeEntries.length == 0) {
      continue;
    }

    logger.note(storeLabel(snapshotStore));

    for (const diffEntry of storeEntries) {
      logger.note(
        `  ${DIFF_MARKER[diffEntry.change]} ${diffEntry.app} ${diffEntry.key} - ${diffEntry.summary}`,
      );
    }
  }

  logger.gap();
  logger.note(
    `Diff: ${snapshotDiff.addedCount} added, ${snapshotDiff.changedCount} changed, ${snapshotDiff.removedCount} removed`,
  );
}

function reportMissingSnapshot(logger: Logger, snapshotName: string): void {
  logger.error(`No snapshot named "${snapshotName}".`);
  logger.tip('run `launch snapshot list` to see saved snapshots');
  completeCommand(1);
}

async function readComparisonSnapshot(
  command: DiffCommand,
  logger: Logger,
): Promise<Snapshot | null> {
  if (command.against == LIVE_SNAPSHOT) {
    registerBuiltinSources();
    const storeSession = await loadSnapshotStoreSession(command.app);
    const liveCapture = await captureSnapshot(
      captureContextFromSession(storeSession),
      listSnapshotSources(),
      { name: LIVE_SNAPSHOT, capturedAt: currentIsoTime() },
    );

    return liveCapture.snapshot;
  }

  const savedComparison = await loadSnapshot(command.against);

  if (savedComparison == null) {
    reportMissingSnapshot(logger, command.against);

    return null;
  }

  return savedComparison;
}

async function diffSnapshot(command: DiffCommand): Promise<void> {
  const logger = createLogger(false);
  const baselineSnapshot = await loadSnapshot(command.baseline);

  if (baselineSnapshot == null) {
    reportMissingSnapshot(logger, command.baseline);

    return;
  }

  const againstSnapshot = await readComparisonSnapshot(command, logger);

  if (againstSnapshot == null) {
    return;
  }

  const snapshotDiff = diffSnapshots(baselineSnapshot, againstSnapshot);

  if (command.json == true) {
    logger.line(JSON.stringify(snapshotDiff, null, 2));

    return;
  }

  renderDiff(logger, snapshotDiff, command.baseline, command.against);
}

async function exportSnapshot(command: ExportCommand): Promise<void> {
  const logger = createLogger(false);
  const savedSnapshot = await loadSnapshot(command.name);

  if (savedSnapshot == null) {
    reportMissingSnapshot(logger, command.name);

    return;
  }

  const snapshotJson = JSON.stringify(savedSnapshot, null, 2);

  if (command.out == null) {
    logger.line(snapshotJson);

    return;
  }

  try {
    await writeFile(command.out, snapshotJson);
  } catch (cause) {
    throw snapshotFailure('write snapshot export', cause);
  }

  logger.note(`Exported "${command.name}" to ${command.out}`);
}

async function listSavedSnapshots(json: boolean | undefined): Promise<void> {
  const logger = createLogger(false);
  const savedSnapshots = await listSnapshots();

  if (json == true) {
    logger.line(
      JSON.stringify(
        savedSnapshots.map(function listEntry(savedSnapshot) {
          return {
            name: savedSnapshot.name,
            capturedAt: savedSnapshot.capturedAt,
            entityCount: countEntities(savedSnapshot),
          };
        }),
        null,
        2,
      ),
    );

    return;
  }

  if (savedSnapshots.length == 0) {
    logger.note('No snapshots yet. Capture one with `launch snapshot create`.');

    return;
  }

  for (const savedSnapshot of savedSnapshots) {
    logger.step(
      'snapshot',
      `${savedSnapshot.name} - ${savedSnapshot.capturedAt} - ${countEntities(savedSnapshot)} item(s)`,
    );
  }
}

async function removeSnapshot(command: DeleteCommand): Promise<void> {
  const logger = createLogger(false);
  const savedSnapshot = await loadSnapshot(command.name);

  if (savedSnapshot == null) {
    reportMissingSnapshot(logger, command.name);

    return;
  }

  const deleted = await deleteSnapshot(command.name);

  if (command.json == true) {
    logger.line(JSON.stringify({ deleted, name: command.name }, null, 2));

    return;
  }

  logger.note(`Deleted snapshot "${command.name}".`);
}

export function parsePruneCount(countText: string, flagName: string): number {
  const count = Number(countText);
  const isWholeCount = Number.isInteger(count);

  if (isWholeCount == false) {
    throw snapshotFailure(
      'parse snapshot prune option',
      countText,
      `${flagName} must be a non-negative integer.`,
    );
  }

  const isNegative = count < 0;

  if (isNegative) {
    throw snapshotFailure(
      'parse snapshot prune option',
      countText,
      `${flagName} must be a non-negative integer.`,
    );
  }

  return count;
}

function hasPruneBound(pruneOptions: PruneOptions): boolean {
  if (pruneOptions.keep != null) {
    return true;
  }

  return pruneOptions.olderThan != null;
}

function isUserSnapshot(savedSnapshot: Snapshot): boolean {
  return savedSnapshot.name.startsWith(AUTO_SNAPSHOT_PREFIX) == false;
}

async function pruneUserSnapshots(pruneOptions: PruneOptions): Promise<void> {
  const logger = createLogger(false);
  if (hasPruneBound(pruneOptions) == false) {
    throw snapshotFailure(
      'prune snapshots',
      pruneOptions,
      'Specify at least one of --keep or --older-than.',
    );
  }

  const pruneCriteria = readPruneCriteria(pruneOptions);
  const savedSnapshots = await listSnapshots();
  const userSnapshots = savedSnapshots.filter(isUserSnapshot);
  const snapshotsToPrune = planPrune(userSnapshots, pruneCriteria, new Date(Date.now()));
  const dryRun = pruneOptions.yes != true;

  if (dryRun == false) {
    for (const savedSnapshot of snapshotsToPrune) {
      await deleteSnapshot(savedSnapshot.name);
    }
  }

  if (pruneOptions.json == true) {
    logger.line(
      JSON.stringify(
        {
          pruned: snapshotsToPrune.map(function snapshotName(savedSnapshot) {
            return savedSnapshot.name;
          }),
          dryRun,
        },
        null,
        2,
      ),
    );

    return;
  }

  if (snapshotsToPrune.length == 0) {
    logger.note('Nothing to prune.');

    return;
  }

  for (const savedSnapshot of snapshotsToPrune) {
    let operationLabel = 'deleted';

    if (dryRun) {
      operationLabel = 'would delete';
    }

    logger.step(operationLabel, `${savedSnapshot.name} - ${savedSnapshot.capturedAt}`);
  }

  logger.gap();

  if (dryRun) {
    logger.note(
      `${snapshotsToPrune.length} snapshot(s) would be deleted (dry-run - re-run with --yes to delete)`,
    );

    return;
  }

  logger.note(`Pruned ${snapshotsToPrune.length} snapshot(s).`);
}

function readPruneCriteria(pruneOptions: PruneOptions): PruneCriteria {
  const pruneCriteria: PruneCriteria = {};

  if (pruneOptions.keep != null) {
    pruneCriteria.keep = parsePruneCount(pruneOptions.keep, '--keep');
  }

  if (pruneOptions.olderThan != null) {
    pruneCriteria.olderThanDays = parsePruneCount(pruneOptions.olderThan, '--older-than');
  }

  return pruneCriteria;
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
      `  ${RESTORE_MARKER[restoreAction.status]} ${restoreAction.description}${errorSuffix}`,
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

async function restoreSnapshot(command: RestoreCommand): Promise<void> {
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
  const liveCapture = await captureSnapshot(
    captureContextFromSession(storeSession),
    listSnapshotSources(),
    { name: LIVE_SNAPSHOT, capturedAt: currentIsoTime() },
  );
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
    logger.line(JSON.stringify({ preview, restored: sourceRestores, dryRun }, null, 2));
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

async function executeSnapshotCommand(command: SnapshotCommandInput): Promise<void> {
  switch (command.operation) {
    case 'create':
      await createSnapshot(command);
      return;
    case 'list':
      await listSavedSnapshots(command.json);
      return;
    case 'diff':
      await diffSnapshot(command);
      return;
    case 'export':
      await exportSnapshot(command);
      return;
    case 'delete':
      await removeSnapshot(command);
      return;
    case 'prune':
      await pruneUserSnapshots(command.options);
      return;
    case 'restore':
      await restoreSnapshot(command);
      return;
  }
}

export async function snapshotCommandProgram(rawCommand: unknown): Promise<void> {
  try {
    const command = decodeSnapshotCommandInput(rawCommand);
    await executeSnapshotCommand(command);
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    if (isSnapshotCommandFailure(cause)) {
      throw cause;
    }

    throw snapshotFailure('run snapshot command', cause);
  }
}
