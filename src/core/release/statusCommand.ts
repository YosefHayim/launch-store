import { Data, Effect, Schema } from 'effect';
import { loadConfig } from '../config/config.js';
import { loadAscKeyForAccount } from '../credentials/accounts.js';
import {
  AppleStoreClientService,
  appRecordMissingMessage,
  type AppleStoreClientService as AppleStoreClientRequirements,
} from '../services/appleStoreClient.js';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { notify } from '../services/notify.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { CommandExitSchema, completeCommand, type CommandExit } from '../terminal/commandExit.js';
import { type Column, formatTable } from '../terminal/table.js';
import { endWithUsageFailure, makeUsageFailure } from '../terminal/usageFailure.js';
import type { AppDescriptor } from '../types/app.js';
import type { BuildResource } from '../types/appleCatalog.js';
import type { LaunchConfig } from '../types/config.js';
import {
  type AscReleaseApi,
  IOS_PLATFORM,
  readReleaseStatus,
  type ReleaseStatus,
  waitForValidBuild,
  type WaitOptions,
} from './appStoreRelease.js';
import { createTransitionTracker, planTransitionNotifications } from './releaseNotify.js';

const WATCH_INTERVAL_MS = 30_000;

export const StatusCommandInputSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  account: Schema.optionalWith(Schema.String, { exact: true }),
  watch: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  build: Schema.optionalWith(Schema.NumberFromString.pipe(Schema.int(), Schema.positive()), {
    exact: true,
  }),
  builds: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  json: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});

export type StatusCommandInput = Schema.Schema.Type<typeof StatusCommandInputSchema>;

/** The options as the CLI passes them, before decoding: `--build` arrives as text. */
export type StatusCommandOptions = Schema.Schema.Encoded<typeof StatusCommandInputSchema>;

/** One discovered iOS app reduced to status-read identity. */
export type StatusApp = Readonly<{ name: string; bundleId: string }>;

/** One app and its latest App Store status, with its recent builds when `--builds` asked for them. */
export type AppReleaseStatus = Readonly<{
  appName: string;
  releaseStatus: ReleaseStatus;
  recentBuilds?: readonly BuildResource[];
}>;

/** Reading or watching App Store status failed. */
export type StatusCommandFailure = Readonly<{
  readonly _tag: 'StatusCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

const makeStatusCommandFailure = Data.tagged<StatusCommandFailure>('StatusCommandFailure');

const StatusCommandFailureSchema: Schema.Schema<StatusCommandFailure> = Schema.Struct({
  _tag: Schema.Literal('StatusCommandFailure'),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
});

type AccountRequirements = Effect.Effect.Context<ReturnType<typeof loadAscKeyForAccount>>;
type NotifyRequirements = Effect.Effect.Context<ReturnType<typeof notify>>;

type StatusCommandRequirements =
  | AccountRequirements
  | AppleStoreClientRequirements
  | LaunchPathsService
  | Logger
  | NotifyRequirements;

/** Normalize one status command failure. */
const statusFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): StatusCommandFailure => {
  let message = errorMessage(cause);
  if (explicitMessage !== undefined) message = explicitMessage;
  return makeStatusCommandFailure({ operation, message, cause });
};

/** Select iOS apps from discovery and an optional comma-separated handle list. */
export const selectIosApps = (
  discoveredApps: readonly AppDescriptor[],
  appSelector: string | undefined,
): Effect.Effect<StatusApp[], StatusCommandFailure> => {
  const iosApps: StatusApp[] = [];
  for (const discoveredApp of discoveredApps) {
    if (discoveredApp.bundleId === undefined) continue;
    iosApps.push({ name: discoveredApp.name, bundleId: discoveredApp.bundleId });
  }
  if (appSelector === undefined) return Effect.succeed(iosApps);
  const requestedNames = appSelector
    .split(',')
    .map((appName) => appName.trim())
    .filter((appName) => appName.length > 0);
  const iosAppsByName = new Map(iosApps.map((iosApp) => [iosApp.name, iosApp]));
  const selectedApps: StatusApp[] = [];
  for (const requestedName of requestedNames) {
    const selectedApp = iosAppsByName.get(requestedName);
    if (selectedApp !== undefined) {
      selectedApps.push(selectedApp);
      continue;
    }
    let availableApps = 'none';
    if (iosApps.length > 0) availableApps = iosApps.map((iosApp) => iosApp.name).join(', ');
    return Effect.fail(
      statusFailure(
        'select iOS apps',
        requestedName,
        `Unknown iOS app "${requestedName}". iOS apps: ${availableApps}.`,
      ),
    );
  }
  return Effect.succeed(selectedApps);
};

/** The build attached to the version: `build 42`, with its state while not VALID, or `no build`. */
const formatAttachedBuild = (releaseStatus: ReleaseStatus): string => {
  const isNoBuildAttached = releaseStatus.buildNumber === null;
  if (isNoBuildAttached) return 'no build';
  const isBuildStillProcessing =
    releaseStatus.buildProcessingState !== null && releaseStatus.buildProcessingState !== 'VALID';
  if (isBuildStillProcessing) {
    return `build ${releaseStatus.buildNumber} (${releaseStatus.buildProcessingState})`;
  }
  return `build ${releaseStatus.buildNumber}`;
};

/** Format one human-readable App Store status line. */
export const formatStatusLine = (releaseStatus: ReleaseStatus): string => {
  const isVersionMissing = releaseStatus.versionString === null;
  const versionPart = isVersionMissing ? 'no App Store version' : `v${releaseStatus.versionString}`;
  const statusParts = [versionPart, releaseStatus.verdict.label];
  if (!isVersionMissing) statusParts.push(formatAttachedBuild(releaseStatus));
  const isPhasedReleaseKnown = releaseStatus.phasedReleaseState !== null;
  if (isPhasedReleaseKnown) statusParts.push(`phased: ${releaseStatus.phasedReleaseState}`);
  return statusParts.join(' - ');
};

/** Rank process exit codes from most severe to least severe. */
const exitCodeRank = (exitCode: number): number => {
  switch (exitCode) {
    case 1:
      return 3;
    case 2:
      return 2;
    case 3:
      return 1;
    default:
      return 0;
  }
};

/** Return the most severe exit code in a status batch. */
export const worstExitCode = (exitCodes: readonly number[]): number => {
  let worstCode = 0;
  for (const exitCode of exitCodes) {
    if (exitCodeRank(exitCode) > exitCodeRank(worstCode)) worstCode = exitCode;
  }
  return worstCode;
};

/** Find an iOS app's App Store id; fails when App Store Connect has no record of the app. */
const readAppId = (appleClient: AscReleaseApi, selectedApp: StatusApp) =>
  Effect.gen(function* () {
    const appId = yield* appleClient
      .getAppId(selectedApp.bundleId)
      .pipe(
        Effect.mapError((cause) =>
          statusFailure(`find App Store app for ${selectedApp.name}`, cause),
        ),
      );
    const isThereNoAppRecord = appId === null;
    if (isThereNoAppRecord) {
      return yield* Effect.fail(
        statusFailure(
          `find App Store app for ${selectedApp.name}`,
          selectedApp.bundleId,
          appRecordMissingMessage(selectedApp.bundleId, 'launch status'),
        ),
      );
    }
    return appId;
  });

/** Upload time in milliseconds; a build with no upload time counts as the oldest. */
const uploadTimeMilliseconds = (build: BuildResource): number => {
  const isUploadTimeMissing = build.uploadedDate === undefined;
  if (isUploadTimeMissing) return 0;
  return Date.parse(build.uploadedDate);
};

/** Read an app's most recent builds from App Store Connect, newest upload first. */
export const readRecentBuilds = (
  appleClient: AscReleaseApi,
  selectedApp: StatusApp,
): Effect.Effect<BuildResource[], StatusCommandFailure> =>
  Effect.gen(function* () {
    const appId = yield* readAppId(appleClient, selectedApp);
    const recentBuildCount = 25;
    const storeBuilds = yield* appleClient
      .listBuilds(appId, recentBuildCount)
      .pipe(
        Effect.mapError((cause) => statusFailure(`list builds for ${selectedApp.name}`, cause)),
      );
    return [...storeBuilds].sort(
      (firstBuild, secondBuild) =>
        uploadTimeMilliseconds(secondBuild) - uploadTimeMilliseconds(firstBuild),
    );
  });

/** Upload time in UTC, to the minute, so the column reads the same on every machine. */
const formatUploadTime = (uploadedDate: string | undefined): string => {
  const isUploadTimeMissing = uploadedDate === undefined;
  if (isUploadTimeMissing) return '-';
  return new Date(uploadedDate).toISOString().slice(0, 16).replace('T', ' ');
};

const RECENT_BUILD_COLUMNS: readonly Column<BuildResource>[] = [
  { header: 'VERSION', cell: (build) => build.marketingVersion ?? '-' },
  { header: 'BUILD', cell: (build) => build.version },
  { header: 'PROCESSING', cell: (build) => build.processingState },
  { header: 'UPLOADED (UTC)', cell: (build) => formatUploadTime(build.uploadedDate) },
];

/** Render an app's recent builds as a table, in the order given; says so when there are none. */
export const formatRecentBuilds = (recentBuilds: readonly BuildResource[]): string => {
  const isThereNoBuild = recentBuilds.length === 0;
  if (isThereNoBuild) return '  no builds uploaded yet';
  return formatTable(RECENT_BUILD_COLUMNS, recentBuilds);
};

/** Read one app's status, plus its recent builds when they were asked for. */
const readOneAppStatus = (
  appleClient: AscReleaseApi,
  selectedApp: StatusApp,
  shouldListBuilds: boolean,
): Effect.Effect<AppReleaseStatus, StatusCommandFailure> =>
  Effect.gen(function* () {
    const releaseStatus = yield* readReleaseStatus(
      appleClient,
      selectedApp.bundleId,
      IOS_PLATFORM,
    ).pipe(
      Effect.mapError((cause) =>
        statusFailure(`read App Store status for ${selectedApp.name}`, cause),
      ),
    );
    const isBuildListSkipped = !shouldListBuilds;
    if (isBuildListSkipped) return { appName: selectedApp.name, releaseStatus };
    const recentBuilds = yield* readRecentBuilds(appleClient, selectedApp);
    return { appName: selectedApp.name, releaseStatus, recentBuilds };
  });

/** Read every selected app concurrently through the shared Apple transport. */
const readSelectedStatuses = (
  appleClient: AscReleaseApi,
  selectedApps: readonly StatusApp[],
  shouldListBuilds: boolean,
): Effect.Effect<AppReleaseStatus[], StatusCommandFailure> =>
  Effect.forEach(
    selectedApps,
    (selectedApp) => readOneAppStatus(appleClient, selectedApp, shouldListBuilds),
    { concurrency: 'unbounded' },
  );

/** Print one app's status line, then its build table when `--builds` asked for it. */
const printOneAppStatus = (
  logger: Logger,
  appStatus: AppReleaseStatus,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    yield* logger.step(appStatus.appName, formatStatusLine(appStatus.releaseStatus));
    const isBuildListPresent = appStatus.recentBuilds !== undefined;
    if (!isBuildListPresent) return;
    yield* logger.line(formatRecentBuilds(appStatus.recentBuilds));
  });

/** Print one human-readable status batch. */
const printStatusBatch = (
  logger: Logger,
  appStatuses: readonly AppReleaseStatus[],
): Effect.Effect<void, unknown> =>
  Effect.forEach(appStatuses, (appStatus) => printOneAppStatus(logger, appStatus), {
    concurrency: 1,
    discard: true,
  });

/** The JSON row for one app: its release status, plus its recent builds when they were asked for. */
const toStatusJsonRow = (appStatus: AppReleaseStatus) => {
  const isBuildListPresent = appStatus.recentBuilds !== undefined;
  if (!isBuildListPresent) return appStatus.releaseStatus;
  return { ...appStatus.releaseStatus, recentBuilds: appStatus.recentBuilds };
};

/** Poll until every selected app reaches a terminal verdict. */
export const watchReleaseStatuses = (
  readStatuses: () => Effect.Effect<AppReleaseStatus[], StatusCommandFailure>,
  logger: Logger,
  launchConfiguration: LaunchConfig,
  sleepBetweenPolls: () => Effect.Effect<void> = () => Effect.sleep(WATCH_INTERVAL_MS),
): Effect.Effect<number, StatusCommandFailure, NotifyRequirements> =>
  Effect.gen(function* () {
    const transitionTracker = createTransitionTracker();
    for (;;) {
      const appStatuses = yield* readStatuses();
      yield* logger.gap();
      yield* printStatusBatch(logger, appStatuses);
      for (const appStatus of appStatuses) {
        const notificationEvents = planTransitionNotifications(
          appStatus.appName,
          appStatus.releaseStatus,
          transitionTracker,
        );
        yield* Effect.forEach(
          notificationEvents,
          (notificationEvent) => notify(launchConfiguration, notificationEvent),
          { concurrency: 1, discard: true },
        );
      }
      const allDone = appStatuses.every((appStatus) => appStatus.releaseStatus.verdict.done);
      if (allDone) {
        return worstExitCode(
          appStatuses.map((appStatus) => appStatus.releaseStatus.verdict.exitCode),
        );
      }
      yield* sleepBetweenPolls();
    }
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(StatusCommandFailureSchema)(cause)) return cause;
      return statusFailure('watch App Store status', cause);
    }),
  );

/** What `--watch --build` waits on: the app, the build number, and where progress is written. */
export type BuildWatchRequest = Readonly<{
  appleClient: AscReleaseApi;
  selectedApp: StatusApp;
  buildNumber: number;
  logger: Logger;
  isJson: boolean;
}>;

/**
 * Poll one build until App Store Connect reports it VALID. Fails on FAILED or INVALID, and when the
 * build is still missing or processing once the wait runs out. `--json` runs print no progress lines.
 */
export const watchBuildProcessing = (
  buildWatchRequest: BuildWatchRequest,
  pollOptions: Omit<WaitOptions, 'onTick'> = {},
): Effect.Effect<BuildResource, StatusCommandFailure> =>
  Effect.gen(function* () {
    const { appleClient, selectedApp, buildNumber, logger, isJson } = buildWatchRequest;
    const appId = yield* readAppId(appleClient, selectedApp);
    const isProgressHidden = isJson;
    const reportProgress = (processingState: string) => {
      if (isProgressHidden) return Effect.void;
      return logger
        .step(selectedApp.name, `build ${buildNumber} is ${processingState}`)
        .pipe(Effect.orDie);
    };
    const storeBuild = yield* waitForValidBuild(appleClient, appId, buildNumber, {
      ...pollOptions,
      onTick: reportProgress,
    }).pipe(
      Effect.mapError((cause) =>
        statusFailure(`wait for build ${buildNumber} of ${selectedApp.name}`, cause),
      ),
    );
    return storeBuild;
  });

/** Print the watched build's outcome: a VALID result as a line or JSON object, or the failure as JSON. */
const reportBuildWatchOutcome = (
  buildWatchRequest: BuildWatchRequest,
  storeBuild: BuildResource,
): Effect.Effect<void, StatusCommandFailure> =>
  Effect.gen(function* () {
    const { logger, selectedApp, buildNumber, isJson } = buildWatchRequest;
    if (isJson) {
      const buildOutcome = {
        appName: selectedApp.name,
        buildNumber: storeBuild.version,
        processingState: storeBuild.processingState,
      };
      yield* logger.line(JSON.stringify(buildOutcome, null, 2)).pipe(Effect.orDie);
      return;
    }
    yield* logger
      .step(
        selectedApp.name,
        `build ${buildNumber} is ${storeBuild.processingState} - ready to release`,
      )
      .pipe(Effect.orDie);
  });

/** Print a failed build wait as JSON when `--json` asked for machine output; the command still fails. */
const reportBuildWatchFailure = (
  buildWatchRequest: BuildWatchRequest,
  watchFailure: StatusCommandFailure,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { logger, selectedApp, buildNumber, isJson } = buildWatchRequest;
    if (!isJson) return;
    const failureOutcome = {
      appName: selectedApp.name,
      buildNumber,
      error: watchFailure.message,
    };
    yield* logger.line(JSON.stringify(failureOutcome, null, 2)).pipe(Effect.orDie);
  });

/** Explain a flag combination the status command cannot run, or return null when the flags fit together. */
export const findStatusUsageProblem = (
  commandInput: StatusCommandInput,
  selectedApps: readonly StatusApp[],
): string | null => {
  const isBuildWithoutWatch = commandInput.build !== undefined && !commandInput.watch;
  if (isBuildWithoutWatch)
    return '--build needs --watch: it waits for that build to finish processing.';
  const isBuildsWithWatch = commandInput.builds && commandInput.watch;
  if (isBuildsWithWatch) return '--builds lists builds without waiting: drop --watch to list them.';
  const isBuildForSeveralApps = commandInput.build !== undefined && selectedApps.length !== 1;
  if (isBuildForSeveralApps) return '--build waits on one build of one app: pass --app <name>.';
  return null;
};

/** Run the schema-decoded App Store status command. */
export const statusCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, CommandExit | StatusCommandFailure, StatusCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(StatusCommandInputSchema)(rawCommandInput);
    const launchPaths = yield* LaunchPaths;
    const logger = yield* createLogger(false);
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory);
    const selectedApps = yield* selectIosApps(loadedConfiguration.apps, commandInput.app);
    const isThereNoSelectedApp = selectedApps.length === 0;
    if (isThereNoSelectedApp) {
      yield* logger.note(
        'No iOS apps discovered. Add an app with an ios.bundleIdentifier in app.json.',
      );
      return;
    }
    const usageProblem = findStatusUsageProblem(commandInput, selectedApps);
    const isUsageProblemFound = usageProblem !== null;
    if (isUsageProblemFound) {
      return yield* endWithUsageFailure(
        makeUsageFailure({ message: usageProblem }),
        commandInput.json,
      );
    }
    const ascKey = yield* loadAscKeyForAccount(commandInput.account);
    const isThereNoAscKey = ascKey === null;
    if (isThereNoAscKey) {
      return yield* Effect.fail(
        statusFailure(
          'load Apple account',
          'missing-account',
          'No Apple account key found. Run `launch creds set-key`, or pick one with --account.',
        ),
      );
    }
    const appleStoreClients = yield* AppleStoreClientService;
    const appleClient = yield* appleStoreClients.createClient(ascKey);
    const watchedBuildNumber = commandInput.build;
    const [onlySelectedApp] = selectedApps;
    const isBuildWatch = watchedBuildNumber !== undefined && onlySelectedApp !== undefined;
    if (isBuildWatch) {
      const buildWatchRequest: BuildWatchRequest = {
        appleClient,
        selectedApp: onlySelectedApp,
        buildNumber: watchedBuildNumber,
        logger,
        isJson: commandInput.json,
      };
      const storeBuild = yield* watchBuildProcessing(buildWatchRequest).pipe(
        Effect.tapError((watchFailure) => reportBuildWatchFailure(buildWatchRequest, watchFailure)),
      );
      return yield* reportBuildWatchOutcome(buildWatchRequest, storeBuild);
    }
    const isWatchingInTerminal = commandInput.watch && !commandInput.json;
    if (isWatchingInTerminal) {
      const readStatuses = () => readSelectedStatuses(appleClient, selectedApps, false);
      const watchExitCode = yield* watchReleaseStatuses(
        readStatuses,
        logger,
        loadedConfiguration.config,
      );
      return yield* completeCommand(watchExitCode);
    }
    const appStatuses = yield* readSelectedStatuses(appleClient, selectedApps, commandInput.builds);
    const isJsonOutput = commandInput.json;
    if (isJsonOutput) {
      yield* logger.line(JSON.stringify(appStatuses.map(toStatusJsonRow), null, 2));
    }
    if (!isJsonOutput) yield* printStatusBatch(logger, appStatuses);
    const statusExitCode = worstExitCode(
      appStatuses.map((appStatus) => appStatus.releaseStatus.verdict.exitCode),
    );
    yield* completeCommand(statusExitCode);
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(CommandExitSchema)(cause)) return cause;
      if (Schema.is(StatusCommandFailureSchema)(cause)) return cause;
      return statusFailure('read App Store status', cause);
    }),
  );
