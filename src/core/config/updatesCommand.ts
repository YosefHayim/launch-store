import { randomUUID } from 'node:crypto';
import { type FileSystem, type Path, Terminal } from '@effect/platform';
import type * as PlatformCommandExecutor from '@effect/platform/CommandExecutor';
import { Context, Data, Effect, Layer, Schema } from 'effect';
import { selectApp } from '../build/pipelineEnv.js';
import { ensureCodeSigner, type CodeSigner } from '../credentials/codeSign.js';
import {
  historySnapshotKey,
  type UpdateHistoryEntry,
  type UpdateManifest,
} from '../distribution/otaManifest.js';
import { isCloudStorage, resolveStorageProvider } from '../distribution/storage.js';
import {
  findHistoryEntry,
  readHistory,
  republishUpdate,
  setRollbackToEmbedded,
} from '../distribution/updateHistory.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import type { LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService, pickOne } from '../services/prompt.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import type { Platform } from '../types/app.js';
import type { StorageProvider } from '../types/providers.js';
import { loadConfig, type LoadedConfig } from './config.js';

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

/** Injectable terminal, clock, and identifier boundary for update history. */
export type UpdatesCommandService = Readonly<{
  logger: Logger;
  terminalIsInteractive: boolean;
  createUpdateId: () => string;
  currentIsoTime: () => string;
  confirmRollback: (message: string) => Effect.Effect<boolean, UpdatesCommandFailure>;
  cancelRollback: () => Effect.Effect<void>;
}>;
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
  if (
    message === undefined &&
    typeof cause === 'object' &&
    cause !== null &&
    'message' in cause &&
    typeof cause.message === 'string'
  ) {
    message = cause.message;
  }
  if (message === undefined) message = `${operation} failed.`;
  return makeUpdatesCommandFailure({ operation, message, cause });
};

/** Map one terminal write into the update command's error channel. */
const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, UpdatesCommandFailure> =>
  logWrite.pipe(Effect.mapError((cause) => updatesFailure(operation, cause)));

/** Decode a persisted update snapshot for human/json view. */
const decodeManifestSnapshot = (
  snapshotText: string,
): Effect.Effect<UpdateManifest, UpdatesCommandFailure> =>
  Schema.decodeUnknown(Schema.parseJson(UpdateManifestSchema))(snapshotText).pipe(
    Effect.map((decodedManifest) => {
      const copyAsset = (
        decodedAsset: Schema.Schema.Type<typeof ManifestAssetSchema>,
      ): UpdateManifest['launchAsset'] => {
        const manifestAsset: UpdateManifest['launchAsset'] = {
          key: decodedAsset.key,
          contentType: decodedAsset.contentType,
          url: decodedAsset.url,
        };
        if (decodedAsset.fileExtension !== undefined) {
          manifestAsset.fileExtension = decodedAsset.fileExtension;
        }
        return manifestAsset;
      };
      const updateManifest: UpdateManifest = {
        id: decodedManifest.id,
        createdAt: decodedManifest.createdAt,
        runtimeVersion: decodedManifest.runtimeVersion,
        launchAsset: copyAsset(decodedManifest.launchAsset),
        assets: decodedManifest.assets.map(copyAsset),
        metadata: {},
        extra: {},
      };
      return updateManifest;
    }),
    Effect.mapError((cause) => updatesFailure('decode update snapshot', cause)),
  );

/** Abbreviate an update id for compact terminal display. */
export const shortId = (updateId: string): string => updateId.slice(0, 8);

/** Render an ISO timestamp as `YYYY-MM-DD HH:MM`. */
const formatDate = (isoTimestamp: string): string => {
  if (isoTimestamp.length >= 16) {
    return `${isoTimestamp.slice(0, 10)} ${isoTimestamp.slice(11, 16)}`;
  }
  return isoTimestamp;
};

/** Parse the optional two-platform filter. */
export const platformsForUpdatesFilter = (
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

/** Fail when storage cannot serve public OTA clients. */
const requireCloudStorage = (
  storageName: string,
  cloudBacked: boolean,
): Effect.Effect<void, UpdatesCommandFailure> => {
  if (cloudBacked) return Effect.void;
  return Effect.fail(
    updatesFailure(
      'resolve update storage',
      storageName,
      'OTA updates need a cloud storage provider. Set `storage: "s3"` (or `supabase`) in launch.config.ts.',
    ),
  );
};

/** Read and merge platform histories newest first. */
const loadUpdateRows = (
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
          Effect.mapError((cause) => updatesFailure('read update history', cause)),
        ),
      { concurrency: 2 },
    );
    return platformHistories
      .flat()
      .sort((leftEntry, rightEntry) => rightEntry.createdAt.localeCompare(leftEntry.createdAt));
  });

/** Confirm a destructive rollback or fail safely in non-interactive use. */
const requireRollbackConfirmation = (
  commandService: UpdatesCommandService,
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

/** Prefer an explicit runtime version flag, then the selected app marketing version. */
const embeddedRollbackRuntimeVersion = (
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

/** Infer whether rollback-to-embedded should sign from prior history rows. */
const signingPreferenceFromHistory = (
  historyEntries: readonly UpdateHistoryEntry[],
  runtimeVersion: string,
): boolean => {
  const runtimeEntry = historyEntries.find(
    (historyEntry) => historyEntry.runtimeVersion === runtimeVersion,
  );
  if (runtimeEntry !== undefined) return runtimeEntry.signed;
  const newestEntry = historyEntries[0];
  if (newestEntry !== undefined) return newestEntry.signed;
  return true;
};

/** Load optional code signing when history says the channel was signed. */
const loadUpdateSigner = (
  signed: boolean,
  logger: Logger,
): Effect.Effect<
  CodeSigner | null,
  UpdatesCommandFailure,
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchSecretStoreService
  | Path.Path
  | PlatformCommandExecutor.CommandExecutor
> => {
  if (!signed) return Effect.succeed(null);
  return ensureCodeSigner(false, logger).pipe(
    Effect.mapError((cause) => updatesFailure('resolve update signer', cause)),
  );
};

/** Shared requirements for every updates subcommand. */
type UpdatesProgramRequirements =
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | PlatformCommandExecutor.CommandExecutor
  | Terminal.Terminal
  | UpdatesCommandService;

/** Loaded project config plus cloud storage for one updates command run. */
type UpdatesSession = Readonly<{
  loadedConfiguration: LoadedConfig;
  storageProvider: StorageProvider;
}>;

/** Open cloud storage for the updates command after loading Launch config. */
const openUpdatesSession = (): Effect.Effect<
  UpdatesSession,
  UpdatesCommandFailure,
  UpdatesProgramRequirements
> =>
  Effect.gen(function* () {
    const loadedConfiguration = yield* loadConfig().pipe(
      Effect.mapError((cause) => updatesFailure('load Launch configuration', cause)),
    );
    yield* requireCloudStorage(
      loadedConfiguration.config.storage,
      isCloudStorage(loadedConfiguration.config),
    );
    const storageProvider = yield* resolveStorageProvider(loadedConfiguration.config).pipe(
      Effect.mapError((cause) => updatesFailure('resolve storage provider', cause)),
    );
    return { loadedConfiguration, storageProvider };
  });

/** List published updates for a channel, optionally filtered by platform and runtime. */
const listUpdates = (
  commandInput: Extract<UpdatesCommandInput, { operation: 'list' }>,
  commandService: UpdatesCommandService,
  storageProvider: StorageProvider,
): Effect.Effect<void, UpdatesCommandFailure> =>
  Effect.gen(function* () {
    const platforms = yield* platformsForUpdatesFilter(commandInput.platform);
    let updateRows = yield* loadUpdateRows(storageProvider, commandInput.channel, platforms);
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
  });

/** Show one published update and its optional immutable snapshot. */
const viewUpdate = (
  commandInput: Extract<UpdatesCommandInput, { operation: 'view' }>,
  commandService: UpdatesCommandService,
  storageProvider: StorageProvider,
): Effect.Effect<void, UpdatesCommandFailure> =>
  Effect.gen(function* () {
    const updateRows = yield* loadUpdateRows(storageProvider, commandInput.channel, [
      'ios',
      'android',
    ]);
    const updateRow = findHistoryEntry([...updateRows], commandInput.reference);
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
      updateManifest = yield* decodeManifestSnapshot(storedSnapshot.toString('utf8'));
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
  });

/** Roll clients back to the bundle embedded in the installed binary. */
const rollbackToEmbedded = (
  commandInput: Extract<UpdatesCommandInput, { operation: 'rollback' }>,
  commandService: UpdatesCommandService,
  updatesSession: UpdatesSession,
): Effect.Effect<void, UpdatesCommandFailure, UpdatesProgramRequirements> =>
  Effect.gen(function* () {
    const platforms = yield* platformsForUpdatesFilter(commandInput.platform);
    const selectedApp = yield* selectApp(
      updatesSession.loadedConfiguration.apps,
      commandInput.app,
    ).pipe(Effect.mapError((cause) => updatesFailure('select app', cause, cause.message)));
    const runtimeVersion = yield* embeddedRollbackRuntimeVersion(
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
            updatesSession.storageProvider,
            commandInput.channel,
            platform,
          ).pipe(Effect.mapError((cause) => updatesFailure('read update history', cause)));
          const signer = yield* loadUpdateSigner(
            signingPreferenceFromHistory(historyEntries, runtimeVersion),
            commandService.logger,
          );
          yield* setRollbackToEmbedded({
            storage: updatesSession.storageProvider,
            channel: commandInput.channel,
            platform,
            runtimeVersion,
            commitTime,
            signer,
          }).pipe(Effect.mapError((cause) => updatesFailure('write rollback directive', cause)));
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
  });

/** Pick or resolve the history row that a republish rollback should restore. */
const selectRollbackTarget = (
  commandInput: Extract<UpdatesCommandInput, { operation: 'rollback' }>,
  commandService: UpdatesCommandService,
  updateRows: readonly UpdateRow[],
): Effect.Effect<UpdateRow, UpdatesCommandFailure, LaunchPromptService | Logger> =>
  Effect.gen(function* () {
    if (commandInput.to !== undefined) {
      const targetUpdate = findHistoryEntry([...updateRows], commandInput.to);
      if (targetUpdate === undefined) {
        return yield* Effect.fail(
          updatesFailure(
            'find rollback target',
            commandInput.to,
            `No update matches --to "${commandInput.to}" on "${commandInput.channel}".`,
          ),
        );
      }
      return targetUpdate;
    }
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
    return yield* pickOne<UpdateRow>({
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
      Effect.mapError((cause) => updatesFailure('select rollback target', cause, cause.message)),
    );
  });

/** Republish a prior immutable snapshot as the active update. */
const rollbackToPriorUpdate = (
  commandInput: Extract<UpdatesCommandInput, { operation: 'rollback' }>,
  commandService: UpdatesCommandService,
  storageProvider: StorageProvider,
): Effect.Effect<void, UpdatesCommandFailure, UpdatesProgramRequirements> =>
  Effect.gen(function* () {
    const platforms = yield* platformsForUpdatesFilter(commandInput.platform);
    const updateRows = yield* loadUpdateRows(storageProvider, commandInput.channel, platforms);
    const targetUpdate = yield* selectRollbackTarget(commandInput, commandService, updateRows);
    const confirmed = yield* requireRollbackConfirmation(
      commandService,
      commandInput.yes,
      `Republish ${shortId(targetUpdate.id)} (${targetUpdate.platform}, runtime ${targetUpdate.runtimeVersion}) as the active update on "${commandInput.channel}"?`,
    );
    if (!confirmed) return;
    const signer = yield* loadUpdateSigner(targetUpdate.signed, commandService.logger);
    const republishedUpdate = yield* republishUpdate({
      storage: storageProvider,
      channel: commandInput.channel,
      platform: targetUpdate.platform,
      target: targetUpdate,
      newId: commandService.createUpdateId(),
      createdAt: commandService.currentIsoTime(),
      signer,
    }).pipe(Effect.mapError((cause) => updatesFailure('republish update', cause)));
    yield* writeLog(
      'render update rollback step',
      commandService.logger.step(
        'rollback',
        `${targetUpdate.platform} - republished ${shortId(targetUpdate.id)} as ${shortId(republishedUpdate.entry.id)}`,
        'ota-update',
      ),
    );
    yield* writeLog(
      'render update rollback outcome',
      commandService.logger.note(
        'Active manifest updated - clients pull the prior bundle on next poll.',
      ),
    );
    if (platforms.length > 1) {
      yield* writeLog(
        'render update rollback hint',
        commandService.logger.note(
          'Rolled back one platform; rerun for the other if both shipped the bad update.',
        ),
      );
    }
  });

/** Execute one update history operation. */
export const updatesCommandProgram = (
  commandInput: UpdatesCommandInput,
): Effect.Effect<void, UpdatesCommandFailure, UpdatesProgramRequirements> =>
  Effect.gen(function* () {
    const commandService = yield* UpdatesCommandService;
    const updatesSession = yield* openUpdatesSession();
    switch (commandInput.operation) {
      case 'list':
        yield* listUpdates(commandInput, commandService, updatesSession.storageProvider);
        return;
      case 'view':
        yield* viewUpdate(commandInput, commandService, updatesSession.storageProvider);
        return;
      case 'rollback': {
        if (commandInput.toEmbedded) {
          yield* rollbackToEmbedded(commandInput, commandService, updatesSession);
          return;
        }
        yield* rollbackToPriorUpdate(commandInput, commandService, updatesSession.storageProvider);
        return;
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
    } satisfies UpdatesCommandService;
  }),
);
