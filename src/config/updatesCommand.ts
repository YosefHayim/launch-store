import { randomUUID } from 'node:crypto';
import { selectApp } from '../build/pipelineEnv.ts';
import { ensureCodeSigner, type CodeSigner } from '../credentials/codeSign.ts';
import {
  historySnapshotKey,
  type ManifestAsset,
  type UpdateHistoryEntry,
  type UpdateManifest,
} from '../distribution/otaManifest.ts';
import { isCloudStorage, resolveStorageProvider } from '../distribution/storage.ts';
import {
  findHistoryEntry,
  readHistory,
  republishUpdate,
  setRollbackToEmbedded,
} from '../distribution/updateHistory.ts';
import { Prompts } from '../prompts.ts';
import { hasMessage } from '../services/platform/errorMessage.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import { LaunchPrompt, pickOne } from '../services/platform/prompt.ts';
import type { Platform } from '../types/app.ts';
import type { StorageProvider } from '../types/providers.ts';
import { loadConfig, type LoadedConfig } from './config.ts';

/** Update history entry tagged with its source platform. */
export type UpdateRow = UpdateHistoryEntry & Readonly<{ platform: Platform }>;

/** One operation in the `updates` command family. */
type UpdatesCommandInput =
  | Readonly<{
      operation: 'list';
      channel: string;
      platform?: string;
      runtimeVersion?: string;
      json: boolean;
    }>
  | Readonly<{ operation: 'view'; reference: string; channel: string; json: boolean }>
  | Readonly<{
      operation: 'rollback';
      channel: string;
      platform?: string;
      to?: string;
      toEmbedded: boolean;
      runtimeVersion?: string;
      app?: string;
      yes: boolean;
    }>;

/** An update-history operation failed at a typed boundary. */
export type UpdatesCommandFailure = Readonly<{
  readonly _tag: 'UpdatesCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

/** Injectable terminal, clock, and identifier boundary for update history. */
type UpdatesCommandService = Readonly<{
  logger: Logger;
  terminalIsInteractive: boolean;
  createUpdateId: () => string;
  currentIsoTime: () => string;
  confirmRollback: (message: string) => Promise<boolean>;
  cancelRollback: () => void;
}>;

/** Loaded project config plus cloud storage for one updates command run. */
type UpdatesSession = Readonly<{
  loadedConfiguration: LoadedConfig;
  storageProvider: StorageProvider;
}>;

type UpdateColumn = Readonly<{
  header: string;
  cell: (updateRow: UpdateRow) => string;
}>;

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function isUpdatesCommandFailure(cause: unknown): cause is UpdatesCommandFailure {
  if (isPlainRecord(cause)) {
    return cause['_tag'] == 'UpdatesCommandFailure';
  }

  return false;
}

function failureText(cause: unknown, operation: string, fallbackMessage?: string): string {
  if (fallbackMessage != null) {
    return fallbackMessage;
  }

  if (hasMessage(cause)) {
    return cause.message;
  }

  return `${operation} failed.`;
}

function updatesFailure(
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): UpdatesCommandFailure {
  return {
    _tag: 'UpdatesCommandFailure',
    operation,
    message: failureText(cause, operation, fallbackMessage),
    cause,
  };
}

function wrapUpdatesFailure(operation: string, cause: unknown, fallbackMessage?: string): never {
  if (isUpdatesCommandFailure(cause)) {
    throw cause;
  }

  throw updatesFailure(operation, cause, fallbackMessage);
}

function thrownMessage(cause: unknown, fallback: string): string {
  if (hasMessage(cause)) {
    return cause.message;
  }

  return fallback;
}

function readRequiredString(fields: Record<string, unknown>, fieldName: string): string {
  const field = fields[fieldName];

  if (typeof field == 'string') {
    return field;
  }

  throw updatesFailure(
    'decode update snapshot',
    fieldName,
    `Update snapshot ${fieldName} must be a string.`,
  );
}

function requirePlainObject(fields: Record<string, unknown>, fieldName: string): void {
  if (isPlainRecord(fields[fieldName])) {
    return;
  }

  throw updatesFailure(
    'decode update snapshot',
    fieldName,
    `Update snapshot ${fieldName} must be an object.`,
  );
}

function readFileExtension(fields: Record<string, unknown>): string | undefined {
  if ('fileExtension' in fields == false) {
    return undefined;
  }

  const fileExtension = fields['fileExtension'];

  if (fileExtension == null) {
    return undefined;
  }

  if (typeof fileExtension == 'string') {
    return fileExtension;
  }

  throw updatesFailure(
    'decode update snapshot',
    fileExtension,
    'Update snapshot fileExtension must be a string.',
  );
}

function assetFromRecord(fields: Record<string, unknown>): ManifestAsset {
  const manifestAsset: ManifestAsset = {
    key: readRequiredString(fields, 'key'),
    contentType: readRequiredString(fields, 'contentType'),
    url: readRequiredString(fields, 'url'),
  };
  const fileExtension = readFileExtension(fields);

  if (fileExtension != null) {
    manifestAsset.fileExtension = fileExtension;
  }

  return manifestAsset;
}

function readManifestAsset(candidate: unknown): ManifestAsset {
  if (isPlainRecord(candidate)) {
    return assetFromRecord(candidate);
  }

  throw updatesFailure(
    'decode update snapshot',
    candidate,
    'Update snapshot asset must be an object.',
  );
}

function readAssets(candidate: unknown): ManifestAsset[] {
  if (Array.isArray(candidate)) {
    return candidate.map(readManifestAsset);
  }

  throw updatesFailure(
    'decode update snapshot',
    candidate,
    'Update snapshot assets must be an array.',
  );
}

function manifestFromRecord(fields: Record<string, unknown>): UpdateManifest {
  requirePlainObject(fields, 'metadata');
  requirePlainObject(fields, 'extra');

  return {
    id: readRequiredString(fields, 'id'),
    createdAt: readRequiredString(fields, 'createdAt'),
    runtimeVersion: readRequiredString(fields, 'runtimeVersion'),
    launchAsset: readManifestAsset(fields['launchAsset']),
    assets: readAssets(fields['assets']),
    metadata: {},
    extra: {},
  };
}

function parseSnapshotJson(snapshotText: string): unknown {
  try {
    return JSON.parse(snapshotText);
  } catch (cause) {
    throw updatesFailure('decode update snapshot', cause);
  }
}

function decodeManifestSnapshot(snapshotText: string): UpdateManifest {
  const parsed = parseSnapshotJson(snapshotText);

  if (isPlainRecord(parsed)) {
    return manifestFromRecord(parsed);
  }

  throw updatesFailure('decode update snapshot', parsed, 'Update snapshot must be an object.');
}

/** Abbreviate an update id for compact terminal display. */
export function shortId(updateId: string): string {
  return updateId.slice(0, 8);
}

function formatDate(isoTimestamp: string): string {
  if (isoTimestamp.length >= 16) {
    return `${isoTimestamp.slice(0, 10)} ${isoTimestamp.slice(11, 16)}`;
  }

  return isoTimestamp;
}

/** Parse the optional two-platform filter. */
export function platformsForUpdatesFilter(platformText: string | undefined): readonly Platform[] {
  if (platformText == null) {
    return ['ios', 'android'];
  }

  if (platformText == 'ios') {
    return ['ios'];
  }

  if (platformText == 'android') {
    return ['android'];
  }

  throw updatesFailure(
    'parse update platform',
    platformText,
    `Unknown --platform "${platformText}". Use "ios" or "android".`,
  );
}

function updateIdCell(updateRow: UpdateRow): string {
  return shortId(updateRow.id);
}

function platformCell(updateRow: UpdateRow): string {
  return updateRow.platform;
}

function runtimeCell(updateRow: UpdateRow): string {
  return updateRow.runtimeVersion;
}

function createdCell(updateRow: UpdateRow): string {
  return formatDate(updateRow.createdAt);
}

function activeCell(updateRow: UpdateRow): string {
  if (updateRow.active) {
    return 'yes';
  }

  return '';
}

function kindCell(updateRow: UpdateRow): string {
  return updateRow.kind;
}

const UPDATE_COLUMNS: readonly UpdateColumn[] = [
  { header: 'UPDATE', cell: updateIdCell },
  { header: 'PLATFORM', cell: platformCell },
  { header: 'RUNTIME', cell: runtimeCell },
  { header: 'CREATED', cell: createdCell },
  { header: 'ACTIVE', cell: activeCell },
  { header: 'KIND', cell: kindCell },
];

function columnHeader(column: UpdateColumn): string {
  return column.header;
}

/** Render update history as a padded text table. */
export function formatUpdatesTable(updateRows: readonly UpdateRow[]): string {
  function widestColumn(column: UpdateColumn): number {
    function cellLength(updateRow: UpdateRow): number {
      return column.cell(updateRow).length;
    }

    return Math.max(column.header.length, ...updateRows.map(cellLength));
  }

  const widths = UPDATE_COLUMNS.map(widestColumn);

  function renderCells(cells: readonly string[]): string {
    function padCell(cell: string, columnIndex: number): string {
      const width = widths[columnIndex];

      if (width == null) {
        return cell;
      }

      return cell.padEnd(width);
    }

    return cells.map(padCell).join('  ').trimEnd();
  }

  function renderRow(updateRow: UpdateRow): string {
    function cellText(column: UpdateColumn): string {
      return column.cell(updateRow);
    }

    return renderCells(UPDATE_COLUMNS.map(cellText));
  }

  return [renderCells(UPDATE_COLUMNS.map(columnHeader)), ...updateRows.map(renderRow)].join('\n');
}

function activityLabel(updateRow: UpdateRow): string {
  if (updateRow.active) {
    return ', active';
  }

  return '';
}

function signedLabel(updateRow: UpdateRow): string {
  if (updateRow.signed) {
    return 'yes';
  }

  return 'no';
}

/** Render one update plus the optional immutable manifest snapshot. */
export function formatUpdateDetail(
  updateRow: UpdateRow,
  updateManifest: UpdateManifest | null,
): string {
  const detailLines = [
    `update ${updateRow.id} - ${updateRow.platform} - runtime ${updateRow.runtimeVersion}`,
    `  created: ${formatDate(updateRow.createdAt)}  (${updateRow.kind}${activityLabel(updateRow)})`,
    `  signed:  ${signedLabel(updateRow)}`,
  ];

  if (updateManifest != null) {
    detailLines.push(`  bundle:  ${updateManifest.launchAsset.url}`);
    detailLines.push(`  assets:  ${updateManifest.assets.length}`);
  }

  return detailLines.join('\n');
}

function requireCloudStorage(storageName: string, cloudBacked: boolean): void {
  if (cloudBacked) {
    return;
  }

  throw updatesFailure(
    'resolve update storage',
    storageName,
    'OTA updates need a cloud storage provider. Set `storage: "s3"` (or `supabase`) in launch.config.ts.',
  );
}

async function readPlatformRows(
  storageProvider: StorageProvider,
  channel: string,
  platform: Platform,
): Promise<UpdateRow[]> {
  try {
    const historyEntries = await readHistory(storageProvider, channel, platform);

    function tagPlatform(historyEntry: UpdateHistoryEntry): UpdateRow {
      return { ...historyEntry, platform };
    }

    return historyEntries.map(tagPlatform);
  } catch (cause) {
    wrapUpdatesFailure('read update history', cause);
  }
}

async function loadUpdateRows(
  storageProvider: StorageProvider,
  channel: string,
  platforms: readonly Platform[],
): Promise<UpdateRow[]> {
  function readPlatformHistory(platform: Platform): Promise<UpdateRow[]> {
    return readPlatformRows(storageProvider, channel, platform);
  }

  const platformHistories = await Promise.all(platforms.map(readPlatformHistory));

  function byNewest(leftEntry: UpdateRow, rightEntry: UpdateRow): number {
    return rightEntry.createdAt.localeCompare(leftEntry.createdAt);
  }

  return platformHistories.flat().sort(byNewest);
}

async function confirmRollback(message: string): Promise<boolean> {
  try {
    return await LaunchPrompt.confirm(message);
  } catch (cause) {
    wrapUpdatesFailure('confirm update rollback', cause);
  }
}

function cancelRollback(): void {
  LaunchPrompt.cancel('Cancelled - nothing changed.');
}

function createUpdateId(): string {
  return randomUUID();
}

function currentIsoTime(): string {
  return new Date().toISOString();
}

function createUpdatesCommandService(): UpdatesCommandService {
  return {
    logger: createLogger(false),
    terminalIsInteractive: new Prompts().isInteractive(),
    createUpdateId,
    currentIsoTime,
    confirmRollback,
    cancelRollback,
  };
}

async function requireRollbackConfirmation(
  commandService: UpdatesCommandService,
  yes: boolean,
  message: string,
): Promise<boolean> {
  if (yes) {
    return true;
  }

  if (commandService.terminalIsInteractive == false) {
    throw updatesFailure(
      'confirm update rollback',
      message,
      'Rollback needs confirmation. Re-run with --yes to proceed non-interactively.',
    );
  }

  const confirmed = await commandService.confirmRollback(message);

  if (confirmed) {
    return true;
  }

  commandService.cancelRollback();

  return false;
}

function embeddedRollbackRuntimeVersion(
  appVersion: string | undefined,
  runtimeVersion: string | undefined,
): string {
  if (runtimeVersion != null) {
    return runtimeVersion;
  }

  if (appVersion != null) {
    return appVersion;
  }

  throw updatesFailure(
    'resolve runtime version',
    appVersion,
    'Could not resolve a runtime version. Pass --runtime-version <v> (e.g. 1.0.0).',
  );
}

function matchesRuntime(runtimeVersion: string) {
  return function isRuntime(historyEntry: UpdateHistoryEntry): boolean {
    return historyEntry.runtimeVersion == runtimeVersion;
  };
}

function signingPreferenceFromHistory(
  historyEntries: readonly UpdateHistoryEntry[],
  runtimeVersion: string,
): boolean {
  const runtimeEntry = historyEntries.find(matchesRuntime(runtimeVersion));

  if (runtimeEntry != null) {
    return runtimeEntry.signed;
  }

  const newestEntry = historyEntries[0];

  if (newestEntry != null) {
    return newestEntry.signed;
  }

  return true;
}

async function loadUpdateSigner(signed: boolean, logger: Logger): Promise<CodeSigner | null> {
  if (signed == false) {
    return null;
  }

  try {
    return await ensureCodeSigner(false, logger);
  } catch (cause) {
    wrapUpdatesFailure('resolve update signer', cause);
  }
}

async function openUpdatesSession(): Promise<UpdatesSession> {
  try {
    var loadedConfiguration = await loadConfig();
  } catch (cause) {
    wrapUpdatesFailure('load Launch configuration', cause);
  }

  requireCloudStorage(
    loadedConfiguration.config.storage,
    isCloudStorage(loadedConfiguration.config),
  );

  try {
    const storageProvider = await resolveStorageProvider(loadedConfiguration.config);

    return { loadedConfiguration, storageProvider };
  } catch (cause) {
    wrapUpdatesFailure('resolve storage provider', cause);
  }
}

function rowsForRuntime(updateRows: UpdateRow[], runtimeVersion: string | undefined): UpdateRow[] {
  if (runtimeVersion == null) {
    return updateRows;
  }

  function matchesRequestedRuntime(updateRow: UpdateRow): boolean {
    return updateRow.runtimeVersion == runtimeVersion;
  }

  return updateRows.filter(matchesRequestedRuntime);
}

function updateNoun(updateCount: number): string {
  if (updateCount == 1) {
    return 'update';
  }

  return 'updates';
}

async function listUpdates(
  commandInput: Extract<UpdatesCommandInput, { operation: 'list' }>,
  commandService: UpdatesCommandService,
  storageProvider: StorageProvider,
): Promise<void> {
  const platforms = platformsForUpdatesFilter(commandInput.platform);
  const loadedRows = await loadUpdateRows(storageProvider, commandInput.channel, platforms);
  const updateRows = rowsForRuntime(loadedRows, commandInput.runtimeVersion);

  if (commandInput.json) {
    commandService.logger.line(JSON.stringify(updateRows, null, 2));

    return;
  }

  if (updateRows.length == 0) {
    commandService.logger.line(
      `No updates on channel "${commandInput.channel}". Run \`launch update\` to publish one.`,
    );

    return;
  }

  commandService.logger.line(formatUpdatesTable(updateRows));
  commandService.logger.line(
    `\n${updateRows.length} ${updateNoun(updateRows.length)} on "${commandInput.channel}".`,
  );
}

function snapshotText(storedSnapshot: Buffer): string {
  return storedSnapshot.toString('utf8');
}

async function readStoredSnapshot(
  storageProvider: StorageProvider,
  objectKey: string,
): Promise<Buffer | null> {
  try {
    return await storageProvider.getObject(objectKey);
  } catch (cause) {
    wrapUpdatesFailure('read update snapshot', cause);
  }
}

async function viewUpdate(
  commandInput: Extract<UpdatesCommandInput, { operation: 'view' }>,
  commandService: UpdatesCommandService,
  storageProvider: StorageProvider,
): Promise<void> {
  const updateRows = await loadUpdateRows(storageProvider, commandInput.channel, [
    'ios',
    'android',
  ]);
  const updateRow = findHistoryEntry([...updateRows], commandInput.reference);

  if (updateRow == null) {
    throw updatesFailure(
      'find published update',
      commandInput.reference,
      `No update matches "${commandInput.reference}" on "${commandInput.channel}". Run \`launch updates list\` to see what's available.`,
    );
  }

  const snapshotKey = historySnapshotKey(
    commandInput.channel,
    updateRow.platform,
    updateRow.runtimeVersion,
    updateRow.id,
  );
  const storedSnapshot = await readStoredSnapshot(storageProvider, snapshotKey);
  let updateManifest: UpdateManifest | null = null;

  if (storedSnapshot != null) {
    updateManifest = decodeManifestSnapshot(snapshotText(storedSnapshot));
  }

  if (commandInput.json) {
    commandService.logger.line(JSON.stringify({ ...updateRow, manifest: updateManifest }, null, 2));

    return;
  }

  commandService.logger.line(formatUpdateDetail(updateRow, updateManifest));
}

type EmbeddedRollback = Readonly<{
  commandInput: Extract<UpdatesCommandInput, { operation: 'rollback' }>;
  commandService: UpdatesCommandService;
  updatesSession: UpdatesSession;
  platform: Platform;
  runtimeVersion: string;
  commitTime: string;
}>;

async function rollbackOnePlatform(rollback: EmbeddedRollback): Promise<void> {
  try {
    var historyEntries: UpdateHistoryEntry[] = await readHistory(
      rollback.updatesSession.storageProvider,
      rollback.commandInput.channel,
      rollback.platform,
    );
  } catch (cause) {
    wrapUpdatesFailure('read update history', cause);
  }

  const signer = await loadUpdateSigner(
    signingPreferenceFromHistory(historyEntries, rollback.runtimeVersion),
    rollback.commandService.logger,
  );

  try {
    await setRollbackToEmbedded({
      storage: rollback.updatesSession.storageProvider,
      channel: rollback.commandInput.channel,
      platform: rollback.platform,
      runtimeVersion: rollback.runtimeVersion,
      commitTime: rollback.commitTime,
      signer,
    });
  } catch (cause) {
    wrapUpdatesFailure('write rollback directive', cause);
  }

  rollback.commandService.logger.step(
    'rollback',
    `${rollback.platform} - runtime ${rollback.runtimeVersion} -> embedded`,
    'ota-update',
  );
}

async function rollbackToEmbedded(
  commandInput: Extract<UpdatesCommandInput, { operation: 'rollback' }>,
  commandService: UpdatesCommandService,
  updatesSession: UpdatesSession,
): Promise<void> {
  const platforms = platformsForUpdatesFilter(commandInput.platform);

  try {
    var selectedApp: { version?: string } = await selectApp(
      updatesSession.loadedConfiguration.apps,
      commandInput.app,
    );
  } catch (cause) {
    wrapUpdatesFailure('select app', cause, thrownMessage(cause, 'select app failed.'));
  }

  const runtimeVersion = embeddedRollbackRuntimeVersion(
    selectedApp.version,
    commandInput.runtimeVersion,
  );
  const confirmed = await requireRollbackConfirmation(
    commandService,
    commandInput.yes,
    `Roll ${commandInput.channel} / ${platforms.join('+')} (runtime ${runtimeVersion}) back to the EMBEDDED bundle?`,
  );

  if (confirmed == false) {
    return;
  }

  const commitTime = commandService.currentIsoTime();

  for (const platform of platforms) {
    await rollbackOnePlatform({
      commandInput,
      commandService,
      updatesSession,
      platform,
      runtimeVersion,
      commitTime,
    });
  }

  commandService.logger.note(
    'Clients drop to the embedded build on next poll. The next `launch update` publish clears this.',
  );
}

function isInactive(updateRow: UpdateRow): boolean {
  return updateRow.active == false;
}

function rollbackHint(updateRow: UpdateRow): string {
  const createdLabel = formatDate(updateRow.createdAt);

  if (updateRow.kind == 'rollback') {
    return `${createdLabel} - rollback`;
  }

  return createdLabel;
}

function rollbackChoice(updateRow: UpdateRow) {
  return {
    selection: updateRow,
    label: `${shortId(updateRow.id)} - ${updateRow.platform} - runtime ${updateRow.runtimeVersion}`,
    hint: rollbackHint(updateRow),
  };
}

async function selectRollbackTarget(
  commandInput: Extract<UpdatesCommandInput, { operation: 'rollback' }>,
  commandService: UpdatesCommandService,
  updateRows: readonly UpdateRow[],
): Promise<UpdateRow> {
  if (commandInput.to != null) {
    const targetUpdate = findHistoryEntry([...updateRows], commandInput.to);

    if (targetUpdate == null) {
      throw updatesFailure(
        'find rollback target',
        commandInput.to,
        `No update matches --to "${commandInput.to}" on "${commandInput.channel}".`,
      );
    }

    return targetUpdate;
  }

  const rollbackCandidates = updateRows.filter(isInactive);

  if (rollbackCandidates.length == 0) {
    throw updatesFailure(
      'find rollback target',
      commandInput.channel,
      `No prior update to roll back to on "${commandInput.channel}". Need a non-active update in history.`,
    );
  }

  try {
    return await pickOne<UpdateRow>({
      message: 'Pick an update to roll back to',
      choices: rollbackCandidates.map(rollbackChoice),
      canPrompt: commandService.terminalIsInteractive,
      nonInteractive: {
        kind: 'require',
        flagHint: 'Pass --to <id> (see `launch updates list`).',
      },
    });
  } catch (cause) {
    wrapUpdatesFailure(
      'select rollback target',
      cause,
      thrownMessage(cause, 'select rollback target failed.'),
    );
  }
}

async function rollbackToPriorUpdate(
  commandInput: Extract<UpdatesCommandInput, { operation: 'rollback' }>,
  commandService: UpdatesCommandService,
  storageProvider: StorageProvider,
): Promise<void> {
  const platforms = platformsForUpdatesFilter(commandInput.platform);
  const updateRows = await loadUpdateRows(storageProvider, commandInput.channel, platforms);
  const targetUpdate = await selectRollbackTarget(commandInput, commandService, updateRows);
  const confirmed = await requireRollbackConfirmation(
    commandService,
    commandInput.yes,
    `Republish ${shortId(targetUpdate.id)} (${targetUpdate.platform}, runtime ${targetUpdate.runtimeVersion}) as the active update on "${commandInput.channel}"?`,
  );

  if (confirmed == false) {
    return;
  }

  const signer = await loadUpdateSigner(targetUpdate.signed, commandService.logger);

  try {
    var republishedUpdate: { entry: UpdateHistoryEntry } = await republishUpdate({
      storage: storageProvider,
      channel: commandInput.channel,
      platform: targetUpdate.platform,
      target: targetUpdate,
      newId: commandService.createUpdateId(),
      createdAt: commandService.currentIsoTime(),
      signer,
    });
  } catch (cause) {
    wrapUpdatesFailure('republish update', cause);
  }

  commandService.logger.step(
    'rollback',
    `${targetUpdate.platform} - republished ${shortId(targetUpdate.id)} as ${shortId(republishedUpdate.entry.id)}`,
    'ota-update',
  );
  commandService.logger.note(
    'Active manifest updated - clients pull the prior bundle on next poll.',
  );

  const coversSeveralPlatforms = platforms.length > 1;

  if (coversSeveralPlatforms) {
    commandService.logger.note(
      'Rolled back one platform; rerun for the other if both shipped the bad update.',
    );
  }
}

async function runRollback(
  commandInput: Extract<UpdatesCommandInput, { operation: 'rollback' }>,
  commandService: UpdatesCommandService,
  updatesSession: UpdatesSession,
): Promise<void> {
  if (commandInput.toEmbedded) {
    await rollbackToEmbedded(commandInput, commandService, updatesSession);

    return;
  }

  await rollbackToPriorUpdate(commandInput, commandService, updatesSession.storageProvider);
}

/** Execute one update history operation. */
export async function updatesCommandProgram(commandInput: UpdatesCommandInput): Promise<void> {
  const commandService = createUpdatesCommandService();
  const updatesSession = await openUpdatesSession();

  switch (commandInput.operation) {
    case 'list':
      await listUpdates(commandInput, commandService, updatesSession.storageProvider);

      return;
    case 'view':
      await viewUpdate(commandInput, commandService, updatesSession.storageProvider);

      return;
    case 'rollback':
      await runRollback(commandInput, commandService, updatesSession);

      return;
  }
}
