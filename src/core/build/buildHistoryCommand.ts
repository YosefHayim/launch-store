import { FileSystem, Terminal } from '@effect/platform';
import type * as PlatformCommandExecutor from '@effect/platform/CommandExecutor';
import { Context, Data, Effect, Layer } from 'effect';
import { loadConfig } from '../config/config.js';
import {
  resolveStorageProvider,
  type StorageResolverRequirements,
} from '../distribution/storage.js';
import { LaunchEnvironment } from '../services/environment.js';
import { executeCommand } from '../services/exec.js';
import { createLogger, type Logger } from '../services/logger.js';
import { detectHostOperatingSystem } from '../services/os.js';
import { parsePlatform } from '../services/platform.js';
import { LaunchPrompt } from '../services/prompt.js';
import type { Platform } from '../types/app.js';
import type { BuildArtifact, PrunedArtifact } from '../types/artifacts.js';
import { resolveCommandRetentionDays } from './artifactRetention.js';
import { buildLogId, buildLogPath, readBuildLog } from './buildLog.js';
import { sizeSummary, worstDownloadBytes } from './pipelineArtifact.js';
import { mb } from './pipelineProviders.js';

/** Stable presentation shape emitted by `builds list --json`. */
export type BuildRow = Readonly<{
  id: string;
  app: string;
  version: string;
  platform: Platform;
  buildNumber: number;
  downloadBytes: number;
  artifactBytes: number;
  clean: boolean;
  createdAt: string;
  path: string;
  prunedAt?: string;
}>;

/** Options shared with the interactive cleanup entry point. */
export type PruneCommandOptions = Readonly<{
  app?: string;
  platform?: string;
  days?: string;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
}>;

/** One build-history operation selected by Commander or an interactive caller. */
export type BuildHistoryCommandInput =
  | Readonly<{
      operation: 'list';
      app?: string;
      platform?: string;
      json: boolean;
    }>
  | Readonly<{ operation: 'view'; reference: string; json: boolean }>
  | Readonly<{ operation: 'log'; reference: string; open: boolean }>
  | Readonly<{ operation: 'prune'; options: PruneCommandOptions }>;

/** A build-history command could not satisfy its requested operation. */
export type BuildHistoryCommandFailure = Readonly<{
  readonly _tag: 'BuildHistoryCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeBuildHistoryCommandFailure = Data.tagged<BuildHistoryCommandFailure>(
  'BuildHistoryCommandFailure',
);

/** Runtime-only terminal and filesystem capabilities used by build history. */
export type BuildHistoryCommandDependencies = Readonly<{
  logger: Logger;
  currentTime: () => number;
  terminalIsInteractive: boolean;
  confirmDeletion: (message: string) => Effect.Effect<boolean, BuildHistoryCommandFailure>;
  cancelDeletion: () => Effect.Effect<void>;
  logFileExists: (logPath: string) => Effect.Effect<boolean, BuildHistoryCommandFailure>;
  readLog: (buildIdentifier: string) => Effect.Effect<string | null>;
  openLog: (
    logPath: string,
  ) => Effect.Effect<void, BuildHistoryCommandFailure, PlatformCommandExecutor.CommandExecutor>;
}>;

/** Injectable runtime boundary for build-history presentation and local I/O. */
export type BuildHistoryCommandService = BuildHistoryCommandDependencies;
export const BuildHistoryCommandService = Context.GenericTag<BuildHistoryCommandService>(
  'BuildHistoryCommandService',
);

/** Convert an unknown dependency failure to the build-history error channel. */
const buildHistoryFailure = (
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): BuildHistoryCommandFailure => {
  let message = fallbackMessage;
  if (message === undefined && cause instanceof Error) message = cause.message;
  if (message === undefined) message = `${operation} failed.`;
  return makeBuildHistoryCommandFailure({ operation, message, cause });
};

/** Map one terminal write into the build-history error channel. */
const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, BuildHistoryCommandFailure> =>
  logWrite.pipe(Effect.mapError((cause) => buildHistoryFailure(operation, cause)));

/** Stable provider-independent identifier for one stored build. */
export const buildId = (artifact: BuildArtifact): string => buildLogId(artifact);

/** Project one persisted build into the stable presentation shape. */
export const toBuildRow = (artifact: BuildArtifact): BuildRow => {
  const buildRow: {
    id: string;
    app: string;
    version: string;
    platform: Platform;
    buildNumber: number;
    downloadBytes: number;
    artifactBytes: number;
    clean: boolean;
    createdAt: string;
    path: string;
    prunedAt?: string;
  } = {
    id: buildId(artifact),
    app: artifact.appName,
    version: artifact.version,
    platform: artifact.platform,
    buildNumber: artifact.buildNumber,
    downloadBytes: worstDownloadBytes(artifact.sizeReport),
    artifactBytes: artifact.sizeReport.artifactBytes,
    clean: artifact.clean,
    createdAt: artifact.createdAt,
    path: artifact.path,
  };
  if (artifact.prunedAt !== undefined) buildRow.prunedAt = artifact.prunedAt;
  return buildRow;
};

/** Narrow build history to the requested app and platform. */
export const filterBuilds = (
  storedBuilds: BuildArtifact[],
  filters: Readonly<{ app?: string; platform?: Platform }>,
): BuildArtifact[] =>
  storedBuilds.filter((storedBuild) => {
    if (filters.app !== undefined && storedBuild.appName !== filters.app) return false;
    if (filters.platform !== undefined && storedBuild.platform !== filters.platform) return false;
    return true;
  });

/** Resolve a full id, build number, or `latest` against newest-first history. */
export const findBuild = (
  storedBuilds: BuildArtifact[],
  reference: string,
): BuildArtifact | undefined => {
  if (reference === 'latest') return storedBuilds[0];
  return storedBuilds.find((storedBuild) => {
    if (buildId(storedBuild) === reference) return true;
    return String(storedBuild.buildNumber) === reference;
  });
};

/** Render an ISO timestamp as `YYYY-MM-DD HH:MM`. */
const formatDate = (isoTimestamp: string): string => {
  if (isoTimestamp.length >= 16)
    return `${isoTimestamp.slice(0, 10)} ${isoTimestamp.slice(11, 16)}`;
  return isoTimestamp;
};

/** A table column and its domain-specific cell renderer. */
type Column<TableEntry> = Readonly<{
  header: string;
  cell: (tableEntry: TableEntry) => string;
}>;

/** Render a non-empty collection as a padded text table. */
const formatTable = <TableEntry>(
  columns: readonly Column<TableEntry>[],
  tableEntries: readonly TableEntry[],
): string => {
  const widths = columns.map((column) =>
    Math.max(
      column.header.length,
      ...tableEntries.map((tableEntry) => column.cell(tableEntry).length),
    ),
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
    renderCells(columns.map((column) => column.header)),
    ...tableEntries.map((tableEntry) =>
      renderCells(columns.map((column) => column.cell(tableEntry))),
    ),
  ].join('\n');
};

const BUILD_COLUMNS: readonly Column<BuildRow>[] = [
  { header: 'BUILD', cell: (buildRow) => String(buildRow.buildNumber) },
  { header: 'APP', cell: (buildRow) => buildRow.app },
  { header: 'VERSION', cell: (buildRow) => buildRow.version },
  { header: 'PLATFORM', cell: (buildRow) => buildRow.platform },
  { header: 'DOWNLOAD', cell: (buildRow) => mb(buildRow.downloadBytes) },
  { header: 'CREATED', cell: (buildRow) => formatDate(buildRow.createdAt) },
  {
    header: 'TYPE',
    cell: (buildRow) => {
      if (buildRow.prunedAt !== undefined) return 'pruned';
      if (buildRow.clean) return 'clean';
      return 'incremental';
    },
  },
];

const PRUNE_COLUMNS: readonly Column<PrunedArtifact>[] = [
  { header: 'BUILD', cell: (prunedArtifact) => String(prunedArtifact.buildNumber) },
  { header: 'APP', cell: (prunedArtifact) => prunedArtifact.app },
  { header: 'VERSION', cell: (prunedArtifact) => prunedArtifact.version },
  { header: 'PLATFORM', cell: (prunedArtifact) => prunedArtifact.platform },
  { header: 'SIZE', cell: (prunedArtifact) => mb(prunedArtifact.bytes) },
];

/** Render build history as a compact table. */
export const formatBuildsTable = (buildRows: readonly BuildRow[]): string =>
  formatTable(BUILD_COLUMNS, buildRows);

/** Render the binaries selected by a prune preview. */
export const formatPrunePreview = (prunedArtifacts: readonly PrunedArtifact[]): string =>
  formatTable(PRUNE_COLUMNS, prunedArtifacts);

/** Render the detail block for one stored build. */
export const formatBuildDetail = (artifact: BuildArtifact): string => {
  let buildKind = 'incremental';
  if (artifact.clean) buildKind = 'clean';
  let artifactLine = `  artifact: ${artifact.path}`;
  if (artifact.prunedAt !== undefined) {
    artifactLine = `  artifact: pruned ${formatDate(artifact.prunedAt)} - binary removed to save disk; rebuild to ship`;
  }
  const detailLines = [
    `${artifact.appName} ${artifact.version} (build ${artifact.buildNumber}) - ${artifact.platform}`,
    `  ${sizeSummary(artifact.sizeReport)}`,
    `  profile:  ${artifact.profile}`,
    `  built:    ${formatDate(artifact.createdAt)}  (${buildKind})`,
    `  id:       ${buildId(artifact)}`,
    artifactLine,
  ];
  if (artifact.sizeReport.entries.length === 0) return detailLines.join('\n');
  detailLines.push('  per-device download / install:');
  for (const sizeEntry of artifact.sizeReport.entries) {
    detailLines.push(
      `    ${sizeEntry.device}  download ${mb(sizeEntry.downloadBytes)}  install ${mb(sizeEntry.installBytes)}`,
    );
  }
  return detailLines.join('\n');
};

/** Parse an optional platform filter through the shared platform decoder. */
const parsePlatformFilter = (
  platformText: string | undefined,
): Effect.Effect<Platform | undefined, BuildHistoryCommandFailure> => {
  if (platformText === undefined) return Effect.succeed(undefined);
  return parsePlatform(platformText).pipe(
    Effect.mapError((cause) => buildHistoryFailure('parse build platform', cause, cause.message)),
  );
};

/** Parse an optional positive retention-day override. */
const parsePruneDays = (
  daysText: string | undefined,
): Effect.Effect<number | undefined, BuildHistoryCommandFailure> => {
  if (daysText === undefined) return Effect.succeed(undefined);
  const retentionDays = Number(daysText);
  if (Number.isInteger(retentionDays) && retentionDays >= 1) return Effect.succeed(retentionDays);
  return Effect.fail(
    buildHistoryFailure(
      'parse prune retention',
      daysText,
      `Invalid --days "${daysText}". Use a positive whole number of days.`,
    ),
  );
};

/** Load newest-first history from the configured storage provider. */
const loadHistory = (): Effect.Effect<
  BuildArtifact[],
  BuildHistoryCommandFailure,
  FileSystem.FileSystem | StorageResolverRequirements
> =>
  Effect.gen(function* () {
    const loadedConfiguration = yield* loadConfig().pipe(
      Effect.mapError((cause) => buildHistoryFailure('load Launch configuration', cause)),
    );
    const storageProvider = yield* resolveStorageProvider(loadedConfiguration.config).pipe(
      Effect.mapError((cause) => buildHistoryFailure('resolve storage provider', cause)),
    );
    return yield* storageProvider
      .list()
      .pipe(Effect.mapError((cause) => buildHistoryFailure('read build history', cause)));
  });

/** Render a grammatically correct build-count label. */
const buildsLabel = (count: number): string => {
  if (count === 1) return '1 build';
  return `${count} builds`;
};

/** Count binaries eligible for the default cleanup policy. */
export const countPrunableBuilds = (): Effect.Effect<
  number,
  BuildHistoryCommandFailure,
  FileSystem.FileSystem | StorageResolverRequirements
> =>
  Effect.gen(function* () {
    const loadedConfiguration = yield* loadConfig().pipe(
      Effect.mapError((cause) => buildHistoryFailure('load Launch configuration', cause)),
    );
    const storageProvider = yield* resolveStorageProvider(loadedConfiguration.config).pipe(
      Effect.mapError((cause) => buildHistoryFailure('resolve storage provider', cause)),
    );
    if (storageProvider.prune === undefined) return 0;
    const prunePreview = yield* storageProvider
      .prune({
        now: Date.now(),
        retentionDays: resolveCommandRetentionDays(loadedConfiguration.config),
        dryRun: true,
      })
      .pipe(Effect.mapError((cause) => buildHistoryFailure('preview build cleanup', cause)));
    return prunePreview.pruned.length;
  });

/** Execute build cleanup for CLI and wizard callers. */
export const runPrune = (
  commandOptions: PruneCommandOptions,
): Effect.Effect<
  void,
  BuildHistoryCommandFailure,
  BuildHistoryCommandService | FileSystem.FileSystem | StorageResolverRequirements
> =>
  Effect.gen(function* () {
    const commandService = yield* BuildHistoryCommandService;
    const platform = yield* parsePlatformFilter(commandOptions.platform);
    const requestedRetentionDays = yield* parsePruneDays(commandOptions.days);
    const loadedConfiguration = yield* loadConfig().pipe(
      Effect.mapError((cause) => buildHistoryFailure('load Launch configuration', cause)),
    );
    const storageProvider = yield* resolveStorageProvider(loadedConfiguration.config).pipe(
      Effect.mapError((cause) => buildHistoryFailure('resolve storage provider', cause)),
    );
    if (storageProvider.prune === undefined) {
      return yield* Effect.fail(
        buildHistoryFailure(
          'prune build history',
          loadedConfiguration.config.storage,
          `\`builds prune\` applies only to the local artifact store; storage "${loadedConfiguration.config.storage}" manages retention through its own bucket lifecycle rules.`,
        ),
      );
    }
    const retentionDays = resolveCommandRetentionDays(
      loadedConfiguration.config,
      requestedRetentionDays,
    );
    const pruneFilter: {
      now: number;
      retentionDays: number;
      app?: string;
      platform?: Platform;
    } = { now: commandService.currentTime(), retentionDays };
    if (commandOptions.app !== undefined) pruneFilter.app = commandOptions.app;
    if (platform !== undefined) pruneFilter.platform = platform;
    const prunePreview = yield* storageProvider
      .prune({ ...pruneFilter, dryRun: true })
      .pipe(Effect.mapError((cause) => buildHistoryFailure('preview build cleanup', cause)));
    if (prunePreview.pruned.length === 0) {
      if (commandOptions.json === true)
        yield* writeLog(
          'render build cleanup preview',
          commandService.logger.line(JSON.stringify(prunePreview, null, 2)),
        );
      else
        yield* writeLog(
          'render build cleanup preview',
          commandService.logger.line(
            `Nothing to prune - no builds older than ${retentionDays}d (the newest per app+platform is always kept).`,
          ),
        );
      return;
    }
    if (commandOptions.dryRun === true) {
      if (commandOptions.json === true) {
        yield* writeLog(
          'render build cleanup preview',
          commandService.logger.line(JSON.stringify(prunePreview, null, 2)),
        );
        return;
      }
      yield* writeLog(
        'render build cleanup preview',
        commandService.logger.line(formatPrunePreview(prunePreview.pruned)),
      );
      yield* writeLog(
        'render build cleanup summary',
        commandService.logger.line(
          `\nDry run - would remove ${buildsLabel(prunePreview.pruned.length)}, freeing ${mb(prunePreview.freedBytes)}. Nothing deleted.`,
        ),
      );
      return;
    }
    if (commandOptions.yes !== true) {
      let confirmationBlocked = !commandService.terminalIsInteractive;
      if (commandOptions.json === true) confirmationBlocked = true;
      if (confirmationBlocked) {
        return yield* Effect.fail(
          buildHistoryFailure(
            'confirm build cleanup',
            commandOptions,
            'Refusing to delete without confirmation. Re-run with --yes (or --dry-run to preview).',
          ),
        );
      }
      yield* writeLog(
        'render build cleanup preview',
        commandService.logger.line(formatPrunePreview(prunePreview.pruned)),
      );
      const confirmed = yield* commandService.confirmDeletion(
        `Delete ${buildsLabel(prunePreview.pruned.length)}, freeing ${mb(prunePreview.freedBytes)}?`,
      );
      if (!confirmed) {
        yield* commandService.cancelDeletion();
        return;
      }
    }
    const pruneOutcome = yield* storageProvider
      .prune({ ...pruneFilter, dryRun: false })
      .pipe(Effect.mapError((cause) => buildHistoryFailure('prune build history', cause)));
    if (commandOptions.json === true) {
      yield* writeLog(
        'render build cleanup outcome',
        commandService.logger.line(JSON.stringify(pruneOutcome, null, 2)),
      );
      return;
    }
    yield* writeLog(
      'render build cleanup outcome',
      commandService.logger.line(
        `Pruned ${buildsLabel(pruneOutcome.pruned.length)}, freed ${mb(pruneOutcome.freedBytes)}. History kept (shown as "pruned" in \`builds list\`).`,
      ),
    );
  });

/** Run one build-history command operation. */
export const buildHistoryCommandProgram = (
  commandInput: BuildHistoryCommandInput,
): Effect.Effect<
  void,
  BuildHistoryCommandFailure,
  | BuildHistoryCommandService
  | FileSystem.FileSystem
  | PlatformCommandExecutor.CommandExecutor
  | StorageResolverRequirements
  | Effect.Effect.Context<ReturnType<typeof buildLogPath>>
> =>
  Effect.gen(function* () {
    const commandService = yield* BuildHistoryCommandService;
    switch (commandInput.operation) {
      case 'list': {
        const platform = yield* parsePlatformFilter(commandInput.platform);
        const storedBuilds = yield* loadHistory();
        const buildFilters: { app?: string; platform?: Platform } = {};
        if (commandInput.app !== undefined) buildFilters.app = commandInput.app;
        if (platform !== undefined) buildFilters.platform = platform;
        const matchedBuilds = filterBuilds(storedBuilds, buildFilters);
        const buildRows = matchedBuilds.map(toBuildRow);
        if (commandInput.json) {
          yield* writeLog(
            'render build history',
            commandService.logger.line(JSON.stringify(buildRows, null, 2)),
          );
          return;
        }
        if (buildRows.length === 0) {
          yield* writeLog(
            'render build history',
            commandService.logger.line(
              'No builds yet. Run `launch build ios` (or android) to create one.',
            ),
          );
          return;
        }
        yield* writeLog(
          'render build history',
          commandService.logger.line(formatBuildsTable(buildRows)),
        );
        yield* writeLog(
          'render build history summary',
          commandService.logger.line(`\n${buildsLabel(buildRows.length)}.`),
        );
        return;
      }
      case 'view': {
        const storedBuild = findBuild(yield* loadHistory(), commandInput.reference);
        if (storedBuild === undefined) {
          return yield* Effect.fail(
            buildHistoryFailure(
              'find stored build',
              commandInput.reference,
              `No build matches "${commandInput.reference}". Run \`launch builds list\` to see what's available.`,
            ),
          );
        }
        if (commandInput.json) {
          yield* writeLog(
            'render build detail',
            commandService.logger.line(JSON.stringify(toBuildRow(storedBuild), null, 2)),
          );
          return;
        }
        yield* writeLog(
          'render build detail',
          commandService.logger.line(formatBuildDetail(storedBuild)),
        );
        return;
      }
      case 'log': {
        const storedBuild = findBuild(yield* loadHistory(), commandInput.reference);
        if (storedBuild === undefined) {
          return yield* Effect.fail(
            buildHistoryFailure(
              'find stored build',
              commandInput.reference,
              `No build matches "${commandInput.reference}". Run \`launch builds list\` to see what's available.`,
            ),
          );
        }
        const buildIdentifier = buildId(storedBuild);
        const logPath = yield* buildLogPath(buildIdentifier);
        if (!(yield* commandService.logFileExists(logPath))) {
          return yield* Effect.fail(
            buildHistoryFailure(
              'find build log',
              logPath,
              `No stored log for build ${buildIdentifier}. Logs are captured for local builds (run under the progress spinner); CI / --verbose builds stream their output to stdout instead.`,
            ),
          );
        }
        if (commandInput.open) {
          yield* commandService.openLog(logPath);
          return;
        }
        const logText = yield* commandService.readLog(buildIdentifier);
        if (logText !== null && logText.trim() !== '') {
          yield* writeLog('render build log', commandService.logger.line(logText));
          return;
        }
        yield* writeLog('render build log', commandService.logger.line('(log is empty)'));
        return;
      }
      case 'prune':
        return yield* runPrune(commandInput.options);
    }
  });

/** Live build-history dependencies backed by Effect platform services. */
export const BuildHistoryCommandServiceLive = Layer.effect(
  BuildHistoryCommandService,
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const launchEnvironment = yield* LaunchEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const terminal = yield* Terminal.Terminal;
    const terminalIsInteractive = yield* terminal.isTTY;
    const launchPrompt = yield* LaunchPrompt;
    type ReadLogRequirements = Effect.Effect.Context<ReturnType<typeof readBuildLog>>;
    const readLogServices = yield* Effect.context<ReadLogRequirements>();
    return {
      logger,
      currentTime: () => Date.now(),
      terminalIsInteractive,
      confirmDeletion: (message) =>
        launchPrompt
          .confirm(message)
          .pipe(Effect.mapError((cause) => buildHistoryFailure('confirm build cleanup', cause))),
      cancelDeletion: () => launchPrompt.cancel('Nothing deleted.'),
      logFileExists: (logPath) =>
        fileSystem
          .exists(logPath)
          .pipe(Effect.mapError((cause) => buildHistoryFailure('find build log', cause))),
      readLog: (buildIdentifier) =>
        readBuildLog(buildIdentifier).pipe(Effect.provide(readLogServices)),
      openLog: (logPath) =>
        Effect.gen(function* () {
          const editorCommand = launchEnvironment.values.editorCommand;
          if (editorCommand !== undefined && editorCommand !== '') {
            return yield* executeCommand(editorCommand, [logPath]).pipe(
              Effect.provideService(LaunchEnvironment, launchEnvironment),
              Effect.mapError((cause) => buildHistoryFailure('open build log', cause)),
            );
          }
          const operatingSystem = yield* detectHostOperatingSystem.pipe(
            Effect.mapError((cause) => buildHistoryFailure('detect host operating system', cause)),
          );
          if (operatingSystem === 'macos') {
            return yield* executeCommand('open', [logPath]).pipe(
              Effect.provideService(LaunchEnvironment, launchEnvironment),
              Effect.mapError((cause) => buildHistoryFailure('open build log', cause)),
            );
          }
          if (operatingSystem === 'linux') {
            return yield* executeCommand('xdg-open', [logPath]).pipe(
              Effect.provideService(LaunchEnvironment, launchEnvironment),
              Effect.mapError((cause) => buildHistoryFailure('open build log', cause)),
            );
          }
          yield* writeLog(
            'render build log path',
            logger.line(`Log file: ${logPath}  (set $EDITOR to open it automatically)`),
          );
        }),
    } satisfies BuildHistoryCommandDependencies;
  }),
);
