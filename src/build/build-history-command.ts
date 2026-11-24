// Lists, shows, and prunes binaries Launch has already stored for an app.

import { loadConfig } from '../config/config.ts';
import { readStorageProvider } from '../distribution/storage.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { executeCommand } from '../services/platform/execute-command.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import { detectHostOperatingSystem } from '../services/platform/host-operating-system.ts';
import { parsePlatform } from '../services/stores/platform.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { pathExists } from '../path-exists.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import type { Platform } from '../types/app.ts';
import type { LaunchConfig } from '../types/config.ts';
import type { BuildArtifact, PrunedArtifact } from '../types/artifacts.ts';
import type { StorageProvider } from '../types/providers.ts';
import { readCommandRetentionDays } from './artifact-retention.ts';
import { buildLogId, buildLogPath, readBuildLog } from './build-log.ts';
import { sizeSummary, worstDownloadBytes } from './pipeline-artifact.ts';
import { mb } from './pipeline-providers.ts';
import { hasMessage } from '../services/platform/error-message.ts';
import { alignTableColumns, type Column } from '../terminal/table.ts';

type BuildRow = Readonly<{
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

export type PruneCommandOptions = Readonly<{
  app?: string;
  platform?: string;
  days?: string;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
}>;

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

type BuildStorageSession = Readonly<{
  config: LaunchConfig;
  storageProvider: StorageProvider;
}>;

type BuildHistoryTools = {
  logger: Logger;
  currentTime: () => number;
  terminalIsInteractive: boolean;
  confirmDeletion: (message: string) => Promise<boolean>;
  cancelDeletion: () => void;
  logFileExists: (logPath: string) => Promise<boolean>;
  readLog: (buildIdentifier: string) => Promise<string | null>;
  openLog: (logPath: string) => Promise<void>;
};

function buildHistoryFailure(operation: string, cause: unknown, fallbackMessage?: string): Error {
  const hasFallbackMessage = fallbackMessage != null;

  if (hasFallbackMessage) {
    return new Error(fallbackMessage, { cause });
  }

  const causeHasMessage = hasMessage(cause);

  if (causeHasMessage) {
    return new Error(cause.message, { cause });
  }

  const looseMessage = readLooseMessage(cause);
  const hasLooseMessage = looseMessage != null;

  if (hasLooseMessage) {
    return new Error(looseMessage, { cause });
  }

  return new Error(`${operation} failed.`, { cause });
}

function readLooseMessage(cause: unknown): string | undefined {
  if (typeof cause != 'object') {
    return undefined;
  }

  if (cause == null) {
    return undefined;
  }

  if ('message' in cause == false) {
    return undefined;
  }

  if (typeof cause.message != 'string') {
    return undefined;
  }

  return cause.message;
}

export function buildId(artifact: BuildArtifact): string {
  return buildLogId(artifact);
}

export function readBuildRow(artifact: BuildArtifact): BuildRow {
  const buildRow: BuildRow = {
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

  if (artifact.prunedAt == null) {
    return buildRow;
  }

  return { ...buildRow, prunedAt: artifact.prunedAt };
}

function appFilterDiffers(wantedApp: string | undefined, appName: string): boolean {
  if (wantedApp == null) {
    return false;
  }

  return appName != wantedApp;
}

function platformFilterDiffers(wantedPlatform: Platform | undefined, platform: Platform): boolean {
  if (wantedPlatform == null) {
    return false;
  }

  return platform != wantedPlatform;
}

export function filterBuilds(
  storedBuilds: readonly BuildArtifact[],
  filters: Readonly<{ app?: string; platform?: Platform }>,
): BuildArtifact[] {
  return storedBuilds.filter(function keepBuild(storedBuild: BuildArtifact): boolean {
    const appDiffers = appFilterDiffers(filters.app, storedBuild.appName);

    if (appDiffers) {
      return false;
    }

    const platformDiffers = platformFilterDiffers(filters.platform, storedBuild.platform);

    if (platformDiffers) {
      return false;
    }

    return true;
  });
}

export function findBuild(
  storedBuilds: readonly BuildArtifact[],
  reference: string,
): BuildArtifact | undefined {
  if (reference == 'latest') {
    return storedBuilds[0];
  }

  return storedBuilds.find(function sameBuild(storedBuild: BuildArtifact): boolean {
    const sameId = buildId(storedBuild) == reference;

    if (sameId) {
      return true;
    }

    return String(storedBuild.buildNumber) == reference;
  });
}

function formatDate(isoTimestamp: string): string {
  const hasClock = isoTimestamp.length >= 16;

  if (hasClock) {
    return `${isoTimestamp.slice(0, 10)} ${isoTimestamp.slice(11, 16)}`;
  }

  return isoTimestamp;
}

export function buildKindLabel(flags: Readonly<{ clean: boolean; prunedAt?: string }>): string {
  if (flags.prunedAt != null) {
    return 'pruned';
  }

  if (flags.clean) {
    return 'clean';
  }

  return 'incremental';
}

const buildColumns: readonly Column<BuildRow>[] = [
  {
    header: 'BUILD',
    cell: function buildNumberCell(buildRow: BuildRow) {
      return String(buildRow.buildNumber);
    },
  },
  {
    header: 'APP',
    cell: function appCell(buildRow: BuildRow) {
      return buildRow.app;
    },
  },
  {
    header: 'VERSION',
    cell: function versionCell(buildRow: BuildRow) {
      return buildRow.version;
    },
  },
  {
    header: 'PLATFORM',
    cell: function platformCell(buildRow: BuildRow) {
      return buildRow.platform;
    },
  },
  {
    header: 'DOWNLOAD',
    cell: function downloadCell(buildRow: BuildRow) {
      return mb(buildRow.downloadBytes);
    },
  },
  {
    header: 'CREATED',
    cell: function createdCell(buildRow: BuildRow) {
      return formatDate(buildRow.createdAt);
    },
  },
  {
    header: 'TYPE',
    cell: function typeCell(buildRow: BuildRow) {
      return buildKindLabel(buildRow);
    },
  },
];

const pruneColumns: readonly Column<PrunedArtifact>[] = [
  {
    header: 'BUILD',
    cell: function buildNumberCell(prunedArtifact: PrunedArtifact) {
      return String(prunedArtifact.buildNumber);
    },
  },
  {
    header: 'APP',
    cell: function appCell(prunedArtifact: PrunedArtifact) {
      return prunedArtifact.app;
    },
  },
  {
    header: 'VERSION',
    cell: function versionCell(prunedArtifact: PrunedArtifact) {
      return prunedArtifact.version;
    },
  },
  {
    header: 'PLATFORM',
    cell: function platformCell(prunedArtifact: PrunedArtifact) {
      return prunedArtifact.platform;
    },
  },
  {
    header: 'SIZE',
    cell: function sizeCell(prunedArtifact: PrunedArtifact) {
      return mb(prunedArtifact.bytes);
    },
  },
];

export function formatBuildsTable(buildRows: readonly BuildRow[]): string {
  return alignTableColumns(buildColumns, buildRows);
}

export function formatPrunePreview(prunedArtifacts: readonly PrunedArtifact[]): string {
  return alignTableColumns(pruneColumns, prunedArtifacts);
}

export function formatBuildDetail(artifact: BuildArtifact): string {
  let artifactLine = `  artifact: ${artifact.path}`;

  if (artifact.prunedAt != null) {
    artifactLine = `  artifact: pruned ${formatDate(artifact.prunedAt)} - binary removed to save disk; rebuild to ship`;
  }

  const detailLines = [
    `${artifact.appName} ${artifact.version} (build ${artifact.buildNumber}) - ${artifact.platform}`,
    `  ${sizeSummary(artifact.sizeReport)}`,
    `  profile:  ${artifact.profile}`,
    `  built:    ${formatDate(artifact.createdAt)}  (${buildKindLabel(artifact)})`,
    `  id:       ${buildId(artifact)}`,
    artifactLine,
  ];
  const hasDeviceSizes = artifact.sizeReport.entries.length > 0;

  if (hasDeviceSizes == false) {
    return detailLines.join('\n');
  }

  detailLines.push('  per-device download / install:');

  for (const sizeEntry of artifact.sizeReport.entries) {
    const megabytes = mb(sizeEntry.downloadBytes);
    detailLines.push(
      `    ${sizeEntry.device}  download ${megabytes}  install ${mb(sizeEntry.installBytes)}`,
    );
  }

  return detailLines.join('\n');
}

function parsePlatformFilter(platformText: string | undefined): Platform | undefined {
  if (platformText == null) {
    return undefined;
  }

  try {
    const platform = parsePlatform(platformText);

    return platform;
  } catch (error) {
    let failureMessage = 'Could not parse the build platform.';

    if (hasMessage(error)) {
      failureMessage = error.message;
    }

    throw buildHistoryFailure('parse build platform', error, failureMessage);
  }
}

function isPositiveWholeDayCount(retentionDays: number): boolean {
  const isWhole = Number.isInteger(retentionDays);

  if (isWhole == false) {
    return false;
  }

  return retentionDays >= 1;
}

export function parsePruneDays(daysText: string | undefined): number | undefined {
  if (daysText == null) {
    return undefined;
  }

  const retentionDays = Number(daysText);

  const isValidRetention = isPositiveWholeDayCount(retentionDays);

  if (isValidRetention) {
    return retentionDays;
  }

  throw new Error(`Invalid --days "${daysText}". Use a positive whole number of days.`, {
    cause: daysText,
  });
}

async function loadBuildStorageSession(): Promise<BuildStorageSession> {
  try {
    var loadedConfiguration = await loadConfig();
  } catch (error) {
    throw buildHistoryFailure('load Launch configuration', error);
  }

  try {
    var storageProvider = await readStorageProvider(loadedConfiguration.config);
  } catch (error) {
    throw buildHistoryFailure('resolve storage provider', error);
  }

  return { config: loadedConfiguration.config, storageProvider };
}

async function loadHistory(): Promise<readonly BuildArtifact[]> {
  const storageSession = await loadBuildStorageSession();

  try {
    const storedBuilds = await storageSession.storageProvider.list();

    return storedBuilds;
  } catch (error) {
    throw buildHistoryFailure('read build history', error);
  }
}

async function requireStoredBuild(reference: string): Promise<BuildArtifact> {
  const storedBuilds = await loadHistory();
  const storedBuild = findBuild(storedBuilds, reference);

  if (storedBuild == null) {
    throw buildHistoryFailure(
      'find stored build',
      reference,
      `No build matches "${reference}". Run \`launch-store builds list\` to see what's available.`,
    );
  }

  return storedBuild;
}

export function buildsLabel(count: number): string {
  if (count == 1) {
    return '1 build';
  }

  return `${count} builds`;
}

export function pruneConfirmationBlocked(
  commandOptions: Readonly<{ yes?: boolean; json?: boolean }>,
  terminalIsInteractive: boolean,
): boolean {
  if (commandOptions.yes == true) {
    return false;
  }

  if (commandOptions.json == true) {
    return true;
  }

  if (terminalIsInteractive == false) {
    return true;
  }

  return false;
}

function isNonBlankEditor(editorCommand: string | undefined): editorCommand is string {
  if (editorCommand == null) {
    return false;
  }

  return editorCommand != '';
}

function readBuildHistoryTools(): BuildHistoryTools {
  const logger = createLogger(false);

  async function confirmDeletion(message: string): Promise<boolean> {
    try {
      const confirmed = await new LaunchPrompt().confirm(message);

      return confirmed;
    } catch (error) {
      throw buildHistoryFailure('confirm build cleanup', error);
    }
  }

  function cancelDeletion(): void {
    new LaunchPrompt().cancel('Nothing deleted.');
  }

  async function logFileExists(logPath: string): Promise<boolean> {
    try {
      const exists = await pathExists(logPath);

      return exists;
    } catch (error) {
      throw buildHistoryFailure('find build log', error);
    }
  }

  async function openLogWithCommand(editorCommand: string, logPath: string): Promise<void> {
    try {
      await executeCommand(editorCommand, [logPath]);
    } catch (error) {
      throw buildHistoryFailure('open build log', error);
    }
  }

  async function openLog(logPath: string): Promise<void> {
    const editorCommand = readLaunchEnvironment().values.editorCommand;

    if (isNonBlankEditor(editorCommand)) {
      await openLogWithCommand(editorCommand, logPath);
      return;
    }

    const operatingSystem = detectHostOperatingSystem();

    if (operatingSystem == 'macos') {
      await openLogWithCommand('open', logPath);
      return;
    }

    if (operatingSystem == 'linux') {
      await openLogWithCommand('xdg-open', logPath);
      return;
    }

    logger.line(`Log file: ${logPath}  (set $EDITOR to open it automatically)`);
  }

  return {
    logger,
    currentTime: function currentTime() {
      return Date.now();
    },
    terminalIsInteractive: checkTerminalIsInteractive(),
    confirmDeletion,
    cancelDeletion,
    logFileExists,
    readLog: readBuildLog,
    openLog,
  };
}

type PrunePreview = {
  pruned: readonly PrunedArtifact[];
  freedBytes: number;
};

async function runPrune(commandOptions: PruneCommandOptions): Promise<void> {
  const tools = readBuildHistoryTools();
  const platform = parsePlatformFilter(commandOptions.platform);
  const requestedRetentionDays = parsePruneDays(commandOptions.days);
  const storageSession = await loadBuildStorageSession();

  if (storageSession.storageProvider.prune == null) {
    throw buildHistoryFailure(
      'prune build history',
      storageSession.config.storage,
      `\`builds prune\` applies only to the local artifact store; storage "${storageSession.config.storage}" manages retention through its own bucket lifecycle rules.`,
    );
  }

  const retentionDays = readCommandRetentionDays(storageSession.config, requestedRetentionDays);
  const pruneFilter: {
    now: number;
    retentionDays: number;
    app?: string;
    platform?: Platform;
    dryRun?: boolean;
  } = { now: tools.currentTime(), retentionDays };

  if (commandOptions.app != null) {
    pruneFilter.app = commandOptions.app;
  }

  if (platform != null) {
    pruneFilter.platform = platform;
  }

  try {
    var prunePreview = await storageSession.storageProvider.prune({ ...pruneFilter, dryRun: true });
  } catch (error) {
    throw buildHistoryFailure('preview build cleanup', error);
  }

  const nothingToPrune = prunePreview.pruned.length == 0;

  if (nothingToPrune) {
    renderEmptyPrune(commandOptions, tools.logger, prunePreview, retentionDays);
    return;
  }

  const isDryRun = commandOptions.dryRun == true;

  if (isDryRun) {
    renderDryRunPrune(commandOptions, tools.logger, prunePreview);
    return;
  }

  const confirmationBlocked = pruneConfirmationBlocked(commandOptions, tools.terminalIsInteractive);

  if (confirmationBlocked) {
    throw buildHistoryFailure(
      'confirm build cleanup',
      commandOptions,
      'Refusing to delete without confirmation. Re-run with --yes (or --dry-run to preview).',
    );
  }

  const skipPrompt = commandOptions.yes == true;

  if (skipPrompt == false) {
    tools.logger.line(formatPrunePreview(prunePreview.pruned));

    const megabytes = mb(prunePreview.freedBytes);
    const confirmed = await tools.confirmDeletion(
      `Delete ${buildsLabel(prunePreview.pruned.length)}, freeing ${megabytes}?`,
    );

    if (confirmed == false) {
      tools.cancelDeletion();
      return;
    }
  }

  try {
    var pruneOutcome = await storageSession.storageProvider.prune({
      ...pruneFilter,
      dryRun: false,
    });
  } catch (error) {
    throw buildHistoryFailure('prune build history', error);
  }

  const wantsJson = commandOptions.json == true;

  if (wantsJson) {
    const serialized = JSON.stringify(pruneOutcome, null, 2);
    tools.logger.line(serialized);
    return;
  }

  const megabytes = mb(pruneOutcome.freedBytes);

  tools.logger.line(
    `Pruned ${buildsLabel(pruneOutcome.pruned.length)}, freed ${megabytes}. History kept (shown as "pruned" in \`builds list\`).`,
  );
}

function renderEmptyPrune(
  commandOptions: PruneCommandOptions,
  logger: Logger,
  prunePreview: PrunePreview,
  retentionDays: number,
): void {
  const wantsJson = commandOptions.json == true;

  if (wantsJson) {
    const serialized = JSON.stringify(prunePreview, null, 2);
    logger.line(serialized);
    return;
  }

  logger.line(
    `Nothing to prune - no builds older than ${retentionDays}d (the newest per app+platform is always kept).`,
  );
}

function renderDryRunPrune(
  commandOptions: PruneCommandOptions,
  logger: Logger,
  prunePreview: PrunePreview,
): void {
  const wantsJson = commandOptions.json == true;

  if (wantsJson) {
    const serialized = JSON.stringify(prunePreview, null, 2);
    logger.line(serialized);
    return;
  }

  logger.line(formatPrunePreview(prunePreview.pruned));

  const megabytes = mb(prunePreview.freedBytes);

  logger.line(
    `\nDry run - would remove ${buildsLabel(prunePreview.pruned.length)}, freeing ${megabytes}. Nothing deleted.`,
  );
}

async function listBuilds(
  commandInput: Extract<BuildHistoryCommandInput, { operation: 'list' }>,
): Promise<void> {
  const tools = readBuildHistoryTools();
  const platform = parsePlatformFilter(commandInput.platform);
  const storedBuilds = await loadHistory();
  const buildFilters: { app?: string; platform?: Platform } = {};

  if (commandInput.app != null) {
    buildFilters.app = commandInput.app;
  }

  if (platform != null) {
    buildFilters.platform = platform;
  }

  const buildRows = filterBuilds(storedBuilds, buildFilters).map(readBuildRow);

  const wantsJson = commandInput.json == true;

  if (wantsJson) {
    const serialized = JSON.stringify(buildRows, null, 2);
    tools.logger.line(serialized);
    return;
  }

  const isEmpty = buildRows.length == 0;

  if (isEmpty) {
    tools.logger.line('No builds yet. Run `launch-store build ios` (or android) to create one.');
    return;
  }

  const buildsTable = formatBuildsTable(buildRows);

  tools.logger.line(buildsTable);
  tools.logger.line(`\n${buildsLabel(buildRows.length)}.`);
}

async function viewBuild(
  commandInput: Extract<BuildHistoryCommandInput, { operation: 'view' }>,
): Promise<void> {
  const tools = readBuildHistoryTools();
  const storedBuild = await requireStoredBuild(commandInput.reference);

  const wantsJson = commandInput.json == true;

  if (wantsJson) {
    const buildRow = readBuildRow(storedBuild);
    const serialized = JSON.stringify(buildRow, null, 2);
    tools.logger.line(serialized);
    return;
  }

  const buildDetail = formatBuildDetail(storedBuild);

  tools.logger.line(buildDetail);
}

function hasLogBody(logText: string | null): logText is string {
  if (logText == null) {
    return false;
  }

  return logText.trim() != '';
}

async function showBuildLog(
  commandInput: Extract<BuildHistoryCommandInput, { operation: 'log' }>,
): Promise<void> {
  const tools = readBuildHistoryTools();
  const storedBuild = await requireStoredBuild(commandInput.reference);
  const buildIdentifier = buildId(storedBuild);
  const logPath = buildLogPath(buildIdentifier);
  const logExists = await tools.logFileExists(logPath);

  if (logExists == false) {
    throw buildHistoryFailure(
      'find build log',
      logPath,
      `No stored log for build ${buildIdentifier}. Logs are captured for local builds (run under the progress spinner); CI / --verbose builds stream their output to stdout instead.`,
    );
  }

  if (commandInput.open) {
    await tools.openLog(logPath);
    return;
  }

  const logText = await tools.readLog(buildIdentifier);

  if (hasLogBody(logText)) {
    tools.logger.line(logText);
    return;
  }

  tools.logger.line('(log is empty)');
}

export async function buildHistoryCommandProgram(
  commandInput: BuildHistoryCommandInput,
): Promise<void> {
  switch (commandInput.operation) {
    case 'list':
      await listBuilds(commandInput);
      return;
    case 'view':
      await viewBuild(commandInput);
      return;
    case 'log':
      await showBuildLog(commandInput);
      return;
    case 'prune':
      await runPrune(commandInput.options);
      return;
  }
}
