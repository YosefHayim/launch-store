import { randomUUID } from 'node:crypto';
import { type FileSystem, type Path, Terminal } from '@effect/platform';
import type * as PlatformCommandExecutor from '@effect/platform/CommandExecutor';
import { Context, Data, Effect, Layer, Schema } from 'effect';
import { selectApp } from '../build/pipelineEnv.js';
import { ensureCodeSigner, type CodeSigner } from '../credentials/codeSign.js';
import {
  assembleRollbackDirective,
  historyIndexKey,
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
  rollbackDirectiveKey,
  type ManifestAsset,
  type UpdateHistoryEntry,
  type UpdateManifest,
} from '../distribution/otaManifest.js';
import { isCloudStorage, resolveStorageProvider } from '../distribution/storage.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import type { LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService, pickOne } from '../services/prompt.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import type { Platform } from '../types/app.js';
import type { StorageProvider } from '../types/providers.js';
import { loadConfig } from './config.js';

const ManifestAssetSchema = Schema.Struct({
  key: Schema.String,
  contentType: Schema.String,
  url: Schema.String,
  fileExtension: Schema.optional(Schema.String),
});

const UpdateManifestSchema = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  runtimeVersion: Schema.String,
  launchAsset: ManifestAssetSchema,
  assets: Schema.Array(ManifestAssetSchema),
  metadata: Schema.Struct({}),
  extra: Schema.Struct({}),
});

const UpdateHistoryEntrySchema = Schema.Struct({
  id: Schema.String,
  runtimeVersion: Schema.String,
  createdAt: Schema.String,
  active: Schema.Boolean,
  signed: Schema.Boolean,
  kind: Schema.Literal('publish', 'rollback'),
});

const UpdateHistorySchema = Schema.Array(UpdateHistoryEntrySchema);
const StoredRollbackDirectiveSchema = Schema.Struct({
  active: Schema.Boolean,
  body: Schema.String,
  signature: Schema.optional(Schema.String),
});

/** Update history entry tagged with its source platform. */
export type UpdateRow = UpdateHistoryEntry & Readonly<{ platform: Platform }>;

/** One operation in the `updates` command family. */
export type UpdatesCommandInput =
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
export const makeUpdatesCommandFailure =
  Data.tagged<UpdatesCommandFailure>('UpdatesCommandFailure');

/** Runtime-only update command capabilities. */
export type UpdatesCommandDependencies = Readonly<{
  logger: Logger;
  terminalIsInteractive: boolean;
  createUpdateId: () => string;
  currentIsoTime: () => string;
  confirmRollback: (message: string) => Effect.Effect<boolean, UpdatesCommandFailure>;
  cancelRollback: () => Effect.Effect<void>;
}>;

/** Injectable terminal, clock, and identifier boundary for update history. */
export type UpdatesCommandService = UpdatesCommandDependencies;
export const UpdatesCommandService =
  Context.GenericTag<UpdatesCommandService>('UpdatesCommandService');

/** Convert an unknown failure to the update command's tagged channel. */
const updatesFailure = (
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): UpdatesCommandFailure => {
  let message = fallbackMessage;
  if (message === undefined && cause instanceof Error) message = cause.message;
  if (message === undefined) message = `${operation} failed.`;
  return makeUpdatesCommandFailure({ operation, message, cause });
};

/** Map one terminal write into the update command's error channel. */
const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, UpdatesCommandFailure> =>
  logWrite.pipe(Effect.mapError((cause) => updatesFailure(operation, cause)));

/** Decode persisted JSON through the schema that owns its boundary. */
const decodeJson = <Decoded>(
  operation: string,
  schema: Schema.Schema<Decoded>,
  jsonText: string,
): Effect.Effect<Decoded, UpdatesCommandFailure> =>
  Schema.decodeUnknown(Schema.parseJson(schema))(jsonText).pipe(
    Effect.mapError((cause) => updatesFailure(operation, cause)),
  );

/** Copy a decoded manifest into the mutable legacy domain shape. */
const toUpdateManifest = (
  decodedManifest: Schema.Schema.Type<typeof UpdateManifestSchema>,
): UpdateManifest => {
  const copyAsset = (
    decodedAsset: Schema.Schema.Type<typeof ManifestAssetSchema>,
  ): ManifestAsset => {
    const manifestAsset: ManifestAsset = {
      key: decodedAsset.key,
      contentType: decodedAsset.contentType,
      url: decodedAsset.url,
    };
    if (decodedAsset.fileExtension !== undefined)
      manifestAsset.fileExtension = decodedAsset.fileExtension;
    return manifestAsset;
  };
  return {
    id: decodedManifest.id,
    createdAt: decodedManifest.createdAt,
    runtimeVersion: decodedManifest.runtimeVersion,
    launchAsset: copyAsset(decodedManifest.launchAsset),
    assets: decodedManifest.assets.map(copyAsset),
    metadata: {},
    extra: {},
  };
};

/** Abbreviate an update id for compact terminal display. */
export const shortId = (updateId: string): string => updateId.slice(0, 8);

/** Render an ISO timestamp as `YYYY-MM-DD HH:MM`. */
const formatDate = (isoTimestamp: string): string => {
  if (isoTimestamp.length >= 16)
    return `${isoTimestamp.slice(0, 10)} ${isoTimestamp.slice(11, 16)}`;
  return isoTimestamp;
};

/** Parse the optional two-platform filter. */
const parsePlatformFilter = (
  platformText: string | undefined,
): Effect.Effect<readonly Platform[], UpdatesCommandFailure> => {
  if (platformText === undefined) return Effect.succeed(['ios', 'android']);
  if (platformText === 'ios') return Effect.succeed(['ios']);
  if (platformText === 'android') return Effect.succeed(['android']);
  return Effect.fail(
    updatesFailure(
      'parse update platform',
      platformText,
      `Unknown --platform "${platformText}". Use "ios" or "android".`,
    ),
  );
};

type UpdateColumn = Readonly<{
  header: string;
  cell: (updateRow: UpdateRow) => string;
}>;

const UPDATE_COLUMNS: readonly UpdateColumn[] = [
  { header: 'UPDATE', cell: (updateRow) => shortId(updateRow.id) },
  { header: 'PLATFORM', cell: (updateRow) => updateRow.platform },
  { header: 'RUNTIME', cell: (updateRow) => updateRow.runtimeVersion },
  { header: 'CREATED', cell: (updateRow) => formatDate(updateRow.createdAt) },
  {
    header: 'ACTIVE',
    cell: (updateRow) => {
      if (updateRow.active) return 'yes';
      return '';
    },
  },
  { header: 'KIND', cell: (updateRow) => updateRow.kind },
];

/** Render update history as a padded text table. */
export const formatUpdatesTable = (updateRows: readonly UpdateRow[]): string => {
  const widths = UPDATE_COLUMNS.map((column) =>
    Math.max(column.header.length, ...updateRows.map((updateRow) => column.cell(updateRow).length)),
  );
  const renderCells = (cells: readonly string[]): string =>
    cells
      .map((cell, columnIndex) => {
        const width = widths[columnIndex];
        if (width === undefined) return cell;
        return cell.padEnd(width);
      })
      .join('  ')
      .trimEnd();
  return [
    renderCells(UPDATE_COLUMNS.map((column) => column.header)),
    ...updateRows.map((updateRow) =>
      renderCells(UPDATE_COLUMNS.map((column) => column.cell(updateRow))),
    ),
  ].join('\n');
};

/** Render one update plus the optional immutable manifest snapshot. */
export const formatUpdateDetail = (
  updateRow: UpdateRow,
  updateManifest: UpdateManifest | null,
): string => {
  let activityLabel = '';
  if (updateRow.active) activityLabel = ', active';
  let signedLabel = 'no';
  if (updateRow.signed) signedLabel = 'yes';
  const detailLines = [
    `update ${updateRow.id} - ${updateRow.platform} - runtime ${updateRow.runtimeVersion}`,
    `  created: ${formatDate(updateRow.createdAt)}  (${updateRow.kind}${activityLabel})`,
    `  signed:  ${signedLabel}`,
  ];
  if (updateManifest !== null) {
    detailLines.push(`  bundle:  ${updateManifest.launchAsset.url}`);
    detailLines.push(`  assets:  ${updateManifest.assets.length}`);
  }
  return detailLines.join('\n');
};

/** Require cloud-backed storage for publicly served OTA updates. */
const requireCloudStorage = (storageName: string): Effect.Effect<void, UpdatesCommandFailure> => {
  if (storageName !== 'local') return Effect.void;
  return Effect.fail(
    updatesFailure(
      'resolve update storage',
      storageName,
      'OTA updates need a cloud storage provider. Set `storage: "s3"` (or `supabase`) in launch.config.ts.',
    ),
  );
};

/** Read one per-platform history index, treating an absent or unreadable index as empty. */
const readHistory = (
  storageProvider: StorageProvider,
  channel: string,
  platform: Platform,
): Effect.Effect<readonly UpdateHistoryEntry[], UpdatesCommandFailure> =>
  Effect.gen(function* () {
    const storedIndex = yield* storageProvider
      .getObject(historyIndexKey(channel, platform))
      .pipe(Effect.mapError((cause) => updatesFailure('read update history', cause)));
    if (storedIndex === null) return [];
    return yield* decodeJson(
      'decode update history',
      UpdateHistorySchema,
      storedIndex.toString('utf8'),
    ).pipe(Effect.catchAll(() => Effect.succeed([])));
  });

/** Read and merge platform histories newest first. */
const loadEntries = (
  storageProvider: StorageProvider,
  channel: string,
  platforms: readonly Platform[],
): Effect.Effect<UpdateRow[], UpdatesCommandFailure> =>
  Effect.gen(function* () {
    const platformHistories = yield* Effect.forEach(
      platforms,
      (platform) =>
        readHistory(storageProvider, channel, platform).pipe(
          Effect.map((historyEntries) =>
            historyEntries.map((historyEntry) => ({ ...historyEntry, platform })),
          ),
        ),
      { concurrency: 2 },
    );
    return platformHistories
      .flat()
      .sort((leftEntry, rightEntry) => rightEntry.createdAt.localeCompare(leftEntry.createdAt));
  });

/** Resolve an update reference against newest-first history. */
const findUpdate = (updateRows: readonly UpdateRow[], reference: string): UpdateRow | undefined => {
  if (reference === 'latest') return updateRows[0];
  const exactMatch = updateRows.find((updateRow) => updateRow.id === reference);
  if (exactMatch !== undefined) return exactMatch;
  return updateRows.find((updateRow) => updateRow.id.startsWith(reference));
};

/** Write one update history index. */
const writeHistory = (
  storageProvider: StorageProvider,
  channel: string,
  platform: Platform,
  historyEntries: readonly UpdateHistoryEntry[],
): Effect.Effect<void, UpdatesCommandFailure> =>
  storageProvider
    .putObject(
      historyIndexKey(channel, platform),
      JSON.stringify(historyEntries, null, 2),
      'application/json',
    )
    .pipe(
      Effect.asVoid,
      Effect.mapError((cause) => updatesFailure('write update history', cause)),
    );

/** Clear an active rollback directive after a successful republish. */
const clearRollbackDirective = (
  storageProvider: StorageProvider,
  channel: string,
  platform: Platform,
  runtimeVersion: string,
): Effect.Effect<void, UpdatesCommandFailure> =>
  Effect.gen(function* () {
    const directiveKey = rollbackDirectiveKey(channel, platform, runtimeVersion);
    const storedDirective = yield* storageProvider
      .getObject(directiveKey)
      .pipe(Effect.mapError((cause) => updatesFailure('read rollback directive', cause)));
    if (storedDirective === null) return;
    const rollbackDirective = yield* decodeJson(
      'decode rollback directive',
      StoredRollbackDirectiveSchema,
      storedDirective.toString('utf8'),
    ).pipe(Effect.catchAll(() => Effect.succeed({ active: true, body: '' })));
    if (!rollbackDirective.active) return;
    yield* storageProvider
      .putObject(
        directiveKey,
        JSON.stringify({ active: false, body: '' }, null, 2),
        'application/json',
      )
      .pipe(
        Effect.asVoid,
        Effect.mapError((cause) => updatesFailure('clear rollback directive', cause)),
      );
  });

/** Republish one immutable manifest snapshot as the active update. */
const republishUpdate = (
  storageProvider: StorageProvider,
  channel: string,
  target: UpdateRow,
  newId: string,
  createdAt: string,
  signer: CodeSigner | null,
): Effect.Effect<UpdateHistoryEntry, UpdatesCommandFailure> =>
  Effect.gen(function* () {
    const snapshotKey = historySnapshotKey(
      channel,
      target.platform,
      target.runtimeVersion,
      target.id,
    );
    const storedSnapshot = yield* storageProvider
      .getObject(snapshotKey)
      .pipe(Effect.mapError((cause) => updatesFailure('read update snapshot', cause)));
    if (storedSnapshot === null) {
      return yield* Effect.fail(
        updatesFailure(
          'read update snapshot',
          target,
          `No snapshot for update ${target.id} (runtime ${target.runtimeVersion}) - its history record cannot be rolled back to.`,
        ),
      );
    }
    const decodedManifest = yield* decodeJson(
      'decode update snapshot',
      UpdateManifestSchema,
      storedSnapshot.toString('utf8'),
    );
    const previousManifest = toUpdateManifest(decodedManifest);
    const updateManifest: UpdateManifest = { ...previousManifest, id: newId, createdAt };
    const manifestJson = JSON.stringify(updateManifest);
    yield* Effect.all(
      [
        storageProvider.putObject(
          manifestKey(channel, target.platform, target.runtimeVersion),
          manifestJson,
          'application/json',
        ),
        storageProvider.putObject(
          historySnapshotKey(channel, target.platform, target.runtimeVersion, newId),
          manifestJson,
          'application/json',
        ),
      ],
      { concurrency: 2 },
    ).pipe(Effect.mapError((cause) => updatesFailure('write rollback manifest', cause)));
    if (signer !== null) {
      yield* storageProvider
        .putObject(
          manifestSignatureKey(channel, target.platform, target.runtimeVersion),
          signer.sign(manifestJson),
          'text/plain',
        )
        .pipe(Effect.mapError((cause) => updatesFailure('sign rollback manifest', cause)));
    }
    const rollbackEntry: UpdateHistoryEntry = {
      id: newId,
      runtimeVersion: target.runtimeVersion,
      createdAt,
      active: true,
      signed: signer !== null,
      kind: 'rollback',
    };
    const currentHistory = yield* readHistory(storageProvider, channel, target.platform);
    const inactiveHistory = currentHistory.map((historyEntry) => {
      if (historyEntry.runtimeVersion !== target.runtimeVersion) return historyEntry;
      if (!historyEntry.active) return historyEntry;
      return { ...historyEntry, active: false };
    });
    yield* writeHistory(storageProvider, channel, target.platform, [
      rollbackEntry,
      ...inactiveHistory,
    ]);
    yield* clearRollbackDirective(storageProvider, channel, target.platform, target.runtimeVersion);
    return rollbackEntry;
  });

/** Publish a rollback-to-embedded directive for one platform and runtime version. */
const setRollbackToEmbedded = (
  storageProvider: StorageProvider,
  channel: string,
  platform: Platform,
  runtimeVersion: string,
  commitTime: string,
  signer: CodeSigner | null,
): Effect.Effect<void, UpdatesCommandFailure> =>
  Effect.gen(function* () {
    const directiveJson = JSON.stringify(assembleRollbackDirective(commitTime));
    const storedDirective: { active: boolean; body: string; signature?: string } = {
      active: true,
      body: directiveJson,
    };
    if (signer !== null) storedDirective.signature = signer.sign(directiveJson);
    yield* storageProvider
      .putObject(
        rollbackDirectiveKey(channel, platform, runtimeVersion),
        JSON.stringify(storedDirective, null, 2),
        'application/json',
      )
      .pipe(
        Effect.asVoid,
        Effect.mapError((cause) => updatesFailure('write rollback directive', cause)),
      );
  });

/** Confirm a destructive rollback or fail safely in non-interactive use. */
const requireRollbackConfirmation = (
  commandService: UpdatesCommandDependencies,
  yes: boolean,
  message: string,
): Effect.Effect<boolean, UpdatesCommandFailure> =>
  Effect.gen(function* () {
    if (yes) return true;
    if (!commandService.terminalIsInteractive) {
      return yield* Effect.fail(
        updatesFailure(
          'confirm update rollback',
          message,
          'Rollback needs confirmation. Re-run with --yes to proceed non-interactively.',
        ),
      );
    }
    const confirmed = yield* commandService.confirmRollback(message);
    if (confirmed) return true;
    yield* commandService.cancelRollback();
    return false;
  });

/** Resolve a runtime version without trusting an absent app field. */
const resolveRuntimeVersion = (
  appVersion: string | undefined,
  runtimeVersion: string | undefined,
): Effect.Effect<string, UpdatesCommandFailure> => {
  if (runtimeVersion !== undefined) return Effect.succeed(runtimeVersion);
  if (appVersion !== undefined) return Effect.succeed(appVersion);
  return Effect.fail(
    updatesFailure(
      'resolve runtime version',
      appVersion,
      'Could not resolve a runtime version. Pass --runtime-version <v> (e.g. 1.0.0).',
    ),
  );
};

/** Execute one update history operation. */
export const updatesCommandProgram = (
  commandInput: UpdatesCommandInput,
): Effect.Effect<
  void,
  UpdatesCommandFailure,
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | PlatformCommandExecutor.CommandExecutor
  | Terminal.Terminal
  | UpdatesCommandService
> =>
  Effect.gen(function* () {
    const commandService = yield* UpdatesCommandService;
    const loadedConfiguration = yield* loadConfig().pipe(
      Effect.mapError((cause) => updatesFailure('load Launch configuration', cause)),
    );
    yield* requireCloudStorage(loadedConfiguration.config.storage);
    if (!isCloudStorage(loadedConfiguration.config)) {
      return yield* Effect.fail(
        updatesFailure('resolve update storage', loadedConfiguration.config.storage),
      );
    }
    const storageProvider = yield* resolveStorageProvider(loadedConfiguration.config).pipe(
      Effect.mapError((cause) => updatesFailure('resolve storage provider', cause)),
    );
    switch (commandInput.operation) {
      case 'list': {
        const platforms = yield* parsePlatformFilter(commandInput.platform);
        let updateRows = yield* loadEntries(storageProvider, commandInput.channel, platforms);
        if (commandInput.runtimeVersion !== undefined) {
          updateRows = updateRows.filter(
            (updateRow) => updateRow.runtimeVersion === commandInput.runtimeVersion,
          );
        }
        if (commandInput.json) {
          yield* writeLog(
            'render update history',
            commandService.logger.line(JSON.stringify(updateRows, null, 2)),
          );
          return;
        }
        if (updateRows.length === 0) {
          yield* writeLog(
            'render update history',
            commandService.logger.line(
              `No updates on channel "${commandInput.channel}". Run \`launch update\` to publish one.`,
            ),
          );
          return;
        }
        yield* writeLog(
          'render update history',
          commandService.logger.line(formatUpdatesTable(updateRows)),
        );
        let updateNoun = 'updates';
        if (updateRows.length === 1) updateNoun = 'update';
        yield* writeLog(
          'render update history summary',
          commandService.logger.line(
            `\n${updateRows.length} ${updateNoun} on "${commandInput.channel}".`,
          ),
        );
        return;
      }
      case 'view': {
        const updateRows = yield* loadEntries(storageProvider, commandInput.channel, [
          'ios',
          'android',
        ]);
        const updateRow = findUpdate(updateRows, commandInput.reference);
        if (updateRow === undefined) {
          return yield* Effect.fail(
            updatesFailure(
              'find published update',
              commandInput.reference,
              `No update matches "${commandInput.reference}" on "${commandInput.channel}". Run \`launch updates list\` to see what's available.`,
            ),
          );
        }
        const storedSnapshot = yield* storageProvider
          .getObject(
            historySnapshotKey(
              commandInput.channel,
              updateRow.platform,
              updateRow.runtimeVersion,
              updateRow.id,
            ),
          )
          .pipe(Effect.mapError((cause) => updatesFailure('read update snapshot', cause)));
        let updateManifest: UpdateManifest | null = null;
        if (storedSnapshot !== null) {
          const decodedManifest = yield* decodeJson(
            'decode update snapshot',
            UpdateManifestSchema,
            storedSnapshot.toString('utf8'),
          );
          updateManifest = toUpdateManifest(decodedManifest);
        }
        if (commandInput.json) {
          yield* writeLog(
            'render update detail',
            commandService.logger.line(
              JSON.stringify({ ...updateRow, manifest: updateManifest }, null, 2),
            ),
          );
          return;
        }
        yield* writeLog(
          'render update detail',
          commandService.logger.line(formatUpdateDetail(updateRow, updateManifest)),
        );
        return;
      }
      case 'rollback': {
        const platforms = yield* parsePlatformFilter(commandInput.platform);
        if (commandInput.toEmbedded) {
          const selectedApp = yield* selectApp(loadedConfiguration.apps, commandInput.app).pipe(
            Effect.mapError((cause) => updatesFailure('select app', cause, cause.message)),
          );
          const runtimeVersion = yield* resolveRuntimeVersion(
            selectedApp.version,
            commandInput.runtimeVersion,
          );
          const confirmed = yield* requireRollbackConfirmation(
            commandService,
            commandInput.yes,
            `Roll ${commandInput.channel} / ${platforms.join('+')} (runtime ${runtimeVersion}) back to the EMBEDDED bundle?`,
          );
          if (!confirmed) return;
          const commitTime = commandService.currentIsoTime();
          yield* Effect.forEach(
            platforms,
            (platform) =>
              Effect.gen(function* () {
                const historyEntries = yield* readHistory(
                  storageProvider,
                  commandInput.channel,
                  platform,
                );
                const runtimeEntry = historyEntries.find(
                  (historyEntry) => historyEntry.runtimeVersion === runtimeVersion,
                );
                let signed = true;
                if (runtimeEntry !== undefined) signed = runtimeEntry.signed;
                else if (historyEntries[0] !== undefined) signed = historyEntries[0].signed;
                let signer: CodeSigner | null = null;
                if (signed) {
                  signer = yield* ensureCodeSigner(false, commandService.logger).pipe(
                    Effect.mapError((cause) => updatesFailure('resolve update signer', cause)),
                  );
                }
                yield* setRollbackToEmbedded(
                  storageProvider,
                  commandInput.channel,
                  platform,
                  runtimeVersion,
                  commitTime,
                  signer,
                );
                yield* writeLog(
                  'render embedded rollback step',
                  commandService.logger.step(
                    'rollback',
                    `${platform} - runtime ${runtimeVersion} -> embedded`,
                    'ota-update',
                  ),
                );
              }),
            { concurrency: 1 },
          );
          yield* writeLog(
            'render embedded rollback outcome',
            commandService.logger.note(
              'Clients drop to the embedded build on next poll. The next `launch update` publish clears this.',
            ),
          );
          return;
        }
        const updateRows = yield* loadEntries(storageProvider, commandInput.channel, platforms);
        let targetUpdate: UpdateRow | undefined;
        if (commandInput.to !== undefined) {
          targetUpdate = findUpdate(updateRows, commandInput.to);
          if (targetUpdate === undefined) {
            return yield* Effect.fail(
              updatesFailure(
                'find rollback target',
                commandInput.to,
                `No update matches --to "${commandInput.to}" on "${commandInput.channel}".`,
              ),
            );
          }
        } else {
          const rollbackCandidates = updateRows.filter((updateRow) => !updateRow.active);
          if (rollbackCandidates.length === 0) {
            return yield* Effect.fail(
              updatesFailure(
                'find rollback target',
                commandInput.channel,
                `No prior update to roll back to on "${commandInput.channel}". Need a non-active update in history.`,
              ),
            );
          }
          targetUpdate = yield* pickOne<UpdateRow>({
            message: 'Pick an update to roll back to',
            choices: rollbackCandidates.map((updateRow) => {
              let hint = formatDate(updateRow.createdAt);
              if (updateRow.kind === 'rollback') hint += ' - rollback';
              return {
                selection: updateRow,
                label: `${shortId(updateRow.id)} - ${updateRow.platform} - runtime ${updateRow.runtimeVersion}`,
                hint,
              };
            }),
            canPrompt: commandService.terminalIsInteractive,
            nonInteractive: {
              kind: 'require',
              flagHint: 'Pass --to <id> (see `launch updates list`).',
            },
          }).pipe(
            Effect.mapError((cause) =>
              updatesFailure('select rollback target', cause, cause.message),
            ),
          );
        }
        const confirmed = yield* requireRollbackConfirmation(
          commandService,
          commandInput.yes,
          `Republish ${shortId(targetUpdate.id)} (${targetUpdate.platform}, runtime ${targetUpdate.runtimeVersion}) as the active update on "${commandInput.channel}"?`,
        );
        if (!confirmed) return;
        let signer: CodeSigner | null = null;
        if (targetUpdate.signed) {
          signer = yield* ensureCodeSigner(false, commandService.logger).pipe(
            Effect.mapError((cause) => updatesFailure('resolve update signer', cause)),
          );
        }
        const rollbackEntry = yield* republishUpdate(
          storageProvider,
          commandInput.channel,
          targetUpdate,
          commandService.createUpdateId(),
          commandService.currentIsoTime(),
          signer,
        );
        yield* writeLog(
          'render update rollback step',
          commandService.logger.step(
            'rollback',
            `${targetUpdate.platform} - republished ${shortId(targetUpdate.id)} as ${shortId(rollbackEntry.id)}`,
            'ota-update',
          ),
        );
        yield* writeLog(
          'render update rollback outcome',
          commandService.logger.note(
            'Active manifest updated - clients pull the prior bundle on next poll.',
          ),
        );
        if (platforms.length > 1)
          yield* writeLog(
            'render update rollback hint',
            commandService.logger.note(
              'Rolled back one platform; rerun for the other if both shipped the bad update.',
            ),
          );
      }
    }
  });

/** Live update command dependencies backed by the terminal and system clock. */
export const UpdatesCommandServiceLive = Layer.effect(
  UpdatesCommandService,
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const terminal = yield* Terminal.Terminal;
    const terminalIsInteractive = yield* terminal.isTTY;
    const launchPrompt = yield* LaunchPrompt;
    return {
      logger,
      terminalIsInteractive,
      createUpdateId: () => randomUUID(),
      currentIsoTime: () => new Date().toISOString(),
      confirmRollback: (message) =>
        launchPrompt
          .confirm(message)
          .pipe(Effect.mapError((cause) => updatesFailure('confirm update rollback', cause))),
      cancelRollback: () => launchPrompt.cancel('Cancelled - nothing changed.'),
    } satisfies UpdatesCommandDependencies;
  }),
);
