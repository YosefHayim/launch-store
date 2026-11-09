import { Data, Effect, Schema } from 'effect';
import { loadConfig } from '../config/config.js';
import { loadAscKeyForAccount } from '../credentials/accounts.js';
import {
  AppleStoreClientService,
  type AppleStoreClientService as AppleStoreClientRequirements,
} from '../services/appleStoreClient.js';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { notify } from '../services/notify.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { CommandExitSchema, completeCommand, type CommandExit } from '../terminal/commandExit.js';
import { alignTableColumns, type Column } from '../terminal/table.js';
import { endWithUsageFailure, makeUsageFailure } from '../terminal/usageFailure.js';
import type { AppDescriptor } from '../types/app.js';
import type { BuildResource } from '../types/appleCatalog.js';
import type { LaunchConfig } from '../types/config.js';
import {
  type AscReleaseApi,
  IOS_PLATFORM,
  readAppStoreAppId,
  readReleaseStatusForApp,
  type ReleaseStatus,
  waitForValidBuild,
} from './appStoreRelease.js';
import { createTransitionTracker, planTransitionNotifications } from './releaseNotify.js';

const WATCH_INTERVAL_MS = 30_000;
const NO_IOS_APPS_MESSAGE =
  'No iOS apps discovered. Add an app with an ios.bundleIdentifier in app.json.';

const StatusFlagsSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  account: Schema.optionalWith(Schema.String, { exact: true }),
  watch: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  build: Schema.optionalWith(Schema.NumberFromString.pipe(Schema.int(), Schema.positive()), {
    exact: true,
  }),
  builds: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  json: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});

type StatusFlags = Schema.Schema.Type<typeof StatusFlagsSchema>;

export type StatusCommandFlags = Schema.Schema.Encoded<typeof StatusFlagsSchema>;

type StatusApp = Readonly<{ name: string; bundleId: string }>;

type AppReleaseStatus = Readonly<{
  appName: string;
  releaseStatus: ReleaseStatus;
  recentBuilds?: readonly BuildResource[];
}>;

type StatusCommandFailure = Readonly<{
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

const isStatusCommandFailure = (cause: unknown): cause is StatusCommandFailure =>
  Schema.is(StatusCommandFailureSchema)(cause);

const isCommandExit = (cause: unknown): cause is CommandExit => Schema.is(CommandExitSchema)(cause);

type AccountRequirements = Effect.Effect.Context<ReturnType<typeof loadAscKeyForAccount>>;
type NotifyRequirements = Effect.Effect.Context<ReturnType<typeof notify>>;

type StatusCommandRequirements =
  | AccountRequirements
  | AppleStoreClientRequirements
  | LaunchPathsService
  | Logger
  | NotifyRequirements;

const createStatusFailure = (operation: string, cause: unknown): StatusCommandFailure =>
  makeStatusCommandFailure({ operation, message: errorMessage(cause), cause });

export const selectIosApps = (
  discoveredApps: readonly AppDescriptor[],
  appSelector: string | undefined,
): Effect.Effect<StatusApp[], StatusCommandFailure> => {
  const iosApps: StatusApp[] = [];
  for (const discoveredApp of discoveredApps) {
    const { bundleId } = discoveredApp;
    const isIosApp = bundleId !== undefined;
    if (isIosApp) iosApps.push({ name: discoveredApp.name, bundleId });
  }

  const isAppSelectorMissing = appSelector === undefined;
  if (isAppSelectorMissing) return Effect.succeed(iosApps);
  const requestedNames = appSelector
    .split(',')
    .map((appName) => appName.trim())
    .filter((appName) => appName.length > 0);
  const iosAppsByName = new Map(iosApps.map((iosApp) => [iosApp.name, iosApp]));
  const selectedApps: StatusApp[] = [];
  for (const requestedName of requestedNames) {
    const selectedApp = iosAppsByName.get(requestedName);
    const isAppFound = selectedApp !== undefined;
    if (isAppFound) {
      selectedApps.push(selectedApp);
      continue;
    }
    const isThereIosApp = iosApps.length > 0;
    const availableApps = isThereIosApp ? iosApps.map((iosApp) => iosApp.name).join(', ') : 'none';
    return Effect.fail(
      createStatusFailure(
        'select iOS apps',
        new Error(`Unknown iOS app "${requestedName}". iOS apps: ${availableApps}.`),
      ),
    );
  }
  return Effect.succeed(selectedApps);
};

const describeAttachedBuild = (releaseStatus: ReleaseStatus): string => {
  const isNoBuildAttached = releaseStatus.buildNumber === null;
  if (isNoBuildAttached) return 'no build';
  const isBuildStillProcessing =
    releaseStatus.buildProcessingState !== null && releaseStatus.buildProcessingState !== 'VALID';
  if (isBuildStillProcessing) {
    return `build ${releaseStatus.buildNumber} (${releaseStatus.buildProcessingState})`;
  }
  return `build ${releaseStatus.buildNumber}`;
};

const describeReleaseStatus = (releaseStatus: ReleaseStatus): string => {
  const isVersionPresent = releaseStatus.versionString !== null;
  const versionPart = isVersionPresent ? `v${releaseStatus.versionString}` : 'no App Store version';
  const statusParts = [versionPart, releaseStatus.verdict.label];
  if (isVersionPresent) statusParts.push(describeAttachedBuild(releaseStatus));
  const isPhasedReleaseKnown = releaseStatus.phasedReleaseState !== null;
  if (isPhasedReleaseKnown) statusParts.push(`phased: ${releaseStatus.phasedReleaseState}`);
  return statusParts.join(' - ');
};

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

const worstExitCode = (exitCodes: readonly number[]): number => {
  let worstCode = 0;
  for (const exitCode of exitCodes) {
    if (exitCodeRank(exitCode) > exitCodeRank(worstCode)) worstCode = exitCode;
  }
  return worstCode;
};

const readAppId = (appleClient: AscReleaseApi, selectedApp: StatusApp) =>
  readAppStoreAppId(appleClient, selectedApp.bundleId).pipe(
    Effect.mapError((cause) =>
      createStatusFailure(`find App Store app for ${selectedApp.name}`, cause),
    ),
  );

const listRecentBuilds = (
  appleClient: AscReleaseApi,
  appId: string,
  appName: string,
): Effect.Effect<BuildResource[], StatusCommandFailure> => {
  const recentBuildCount = 25;
  return appleClient
    .listBuilds(appId, recentBuildCount)
    .pipe(Effect.mapError((cause) => createStatusFailure(`list builds for ${appName}`, cause)));
};

const describeUploadTime = (uploadedDate: string | undefined): string => {
  const isUploadTimeMissing = uploadedDate === undefined;
  if (isUploadTimeMissing) return '-';
  return new Date(uploadedDate).toISOString().slice(0, 16).replace('T', ' ');
};

const describeRecentBuilds = (recentBuilds: readonly BuildResource[]): string => {
  const isThereNoBuild = recentBuilds.length === 0;
  if (isThereNoBuild) return '  no builds uploaded yet';
  const recentBuildColumns: readonly Column<BuildResource>[] = [
    { header: 'VERSION', cell: (build) => build.marketingVersion ?? '-' },
    { header: 'BUILD', cell: (build) => build.version },
    { header: 'PROCESSING', cell: (build) => build.processingState },
    { header: 'UPLOADED (UTC)', cell: (build) => describeUploadTime(build.uploadedDate) },
  ];
  return alignTableColumns(recentBuildColumns, recentBuilds);
};

const readOneAppStatus = (
  appleClient: AscReleaseApi,
  selectedApp: StatusApp,
  isBuildListWanted: boolean,
): Effect.Effect<AppReleaseStatus, StatusCommandFailure> =>
  Effect.gen(function* () {
    const appId = yield* readAppId(appleClient, selectedApp);
    const releaseStatus = yield* readReleaseStatusForApp(
      appleClient,
      appId,
      selectedApp.bundleId,
      IOS_PLATFORM,
    ).pipe(
      Effect.mapError((cause) =>
        createStatusFailure(`read App Store status for ${selectedApp.name}`, cause),
      ),
    );

    const isBuildListSkipped = !isBuildListWanted;
    if (isBuildListSkipped) return { appName: selectedApp.name, releaseStatus };
    const recentBuilds = yield* listRecentBuilds(appleClient, appId, selectedApp.name);
    return { appName: selectedApp.name, releaseStatus, recentBuilds };
  });

const readSelectedStatuses = (
  appleClient: AscReleaseApi,
  selectedApps: readonly StatusApp[],
  isBuildListWanted: boolean,
): Effect.Effect<AppReleaseStatus[], StatusCommandFailure> =>
  Effect.forEach(
    selectedApps,
    (selectedApp) => readOneAppStatus(appleClient, selectedApp, isBuildListWanted),
    { concurrency: 'unbounded' },
  );

const printOneAppStatus = (
  logger: Logger,
  appStatus: AppReleaseStatus,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    yield* logger.step(appStatus.appName, describeReleaseStatus(appStatus.releaseStatus));
    const isBuildListPresent = appStatus.recentBuilds !== undefined;
    if (!isBuildListPresent) return;
    yield* logger.line(describeRecentBuilds(appStatus.recentBuilds));
  });

const printStatusBatch = (
  logger: Logger,
  appStatuses: readonly AppReleaseStatus[],
): Effect.Effect<void, unknown> =>
  Effect.forEach(appStatuses, (appStatus) => printOneAppStatus(logger, appStatus), {
    concurrency: 1,
    discard: true,
  });

const createStatusJsonRow = (appStatus: AppReleaseStatus) => {
  const isBuildListPresent = appStatus.recentBuilds !== undefined;
  if (!isBuildListPresent) return appStatus.releaseStatus;
  return { ...appStatus.releaseStatus, recentBuilds: appStatus.recentBuilds };
};

const watchReleaseStatuses = (
  readStatuses: () => Effect.Effect<AppReleaseStatus[], StatusCommandFailure>,
  logger: Logger,
  launchConfiguration: LaunchConfig,
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

      const isEveryAppDone = appStatuses.every((appStatus) => appStatus.releaseStatus.verdict.done);
      if (isEveryAppDone) {
        return worstExitCode(
          appStatuses.map((appStatus) => appStatus.releaseStatus.verdict.exitCode),
        );
      }
      yield* Effect.sleep(WATCH_INTERVAL_MS);
    }
  }).pipe(
    Effect.mapError((cause) => {
      if (isStatusCommandFailure(cause)) return cause;
      return createStatusFailure('watch App Store status', cause);
    }),
  );

type BuildWatchRequest = Readonly<{
  appleClient: AscReleaseApi;
  selectedApp: StatusApp;
  buildNumber: number;
  logger: Logger;
  isJson: boolean;
}>;

const watchBuildProcessing = (
  buildWatchRequest: BuildWatchRequest,
): Effect.Effect<BuildResource, StatusCommandFailure> =>
  Effect.gen(function* () {
    const { appleClient, selectedApp, buildNumber, logger, isJson } = buildWatchRequest;
    const appId = yield* readAppId(appleClient, selectedApp);

    const isProgressShown = !isJson;
    const reportProgress = (processingState: string) => {
      if (!isProgressShown) return Effect.void;
      return logger
        .step(selectedApp.name, `build ${buildNumber} is ${processingState}`)
        .pipe(Effect.orDie);
    };
    const storeBuild = yield* waitForValidBuild(appleClient, appId, buildNumber, {
      onTick: reportProgress,
    }).pipe(
      Effect.mapError((cause) =>
        createStatusFailure(`wait for build ${buildNumber} of ${selectedApp.name}`, cause),
      ),
    );
    return storeBuild;
  });

const reportValidBuild = (
  buildWatchRequest: BuildWatchRequest,
  storeBuild: BuildResource,
): Effect.Effect<void, StatusCommandFailure> =>
  Effect.gen(function* () {
    const { logger, selectedApp, buildNumber, isJson } = buildWatchRequest;
    if (isJson) {
      const validBuildReport = {
        ok: true,
        appName: selectedApp.name,
        buildNumber,
        processingState: storeBuild.processingState,
      };
      yield* logger.line(JSON.stringify(validBuildReport, null, 2)).pipe(Effect.orDie);
      return;
    }
    yield* logger
      .step(
        selectedApp.name,
        `build ${buildNumber} is ${storeBuild.processingState} - ready to release`,
      )
      .pipe(Effect.orDie);
  });

const reportFailedBuildWatch = (
  buildWatchRequest: BuildWatchRequest,
  watchFailure: StatusCommandFailure,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { logger, selectedApp, buildNumber, isJson } = buildWatchRequest;
    const isHumanOutput = !isJson;
    if (isHumanOutput) return;
    const failedBuildReport = {
      ok: false,
      appName: selectedApp.name,
      buildNumber,
      error: watchFailure.message,
    };
    yield* logger.line(JSON.stringify(failedBuildReport, null, 2)).pipe(Effect.orDie);
  });

const findStatusUsageProblem = (statusFlags: StatusFlags, iosAppCount: number): string | null => {
  const isBuildWithoutWatch = statusFlags.build !== undefined && !statusFlags.watch;
  if (isBuildWithoutWatch) {
    return '--build needs --watch: it waits for that build to finish processing.';
  }
  const isBuildsWithWatch = statusFlags.builds && statusFlags.watch;
  if (isBuildsWithWatch) return '--builds lists builds without waiting: drop --watch to list them.';
  const isBuildForSeveralApps = statusFlags.build !== undefined && iosAppCount > 1;
  if (isBuildForSeveralApps) return '--build waits on one build of one app: pass --app <name>.';
  return null;
};

export const statusCommandProgram = (
  flagsFromCli: StatusCommandFlags,
): Effect.Effect<void, CommandExit | StatusCommandFailure, StatusCommandRequirements> =>
  Effect.gen(function* () {
    const isJsonRequested = flagsFromCli.json === true;
    const statusFlags = yield* Schema.decodeUnknown(StatusFlagsSchema)(flagsFromCli).pipe(
      Effect.catchTag('ParseError', () =>
        endWithUsageFailure(
          makeUsageFailure({ message: '--build takes a whole number above 0, such as 42.' }),
          isJsonRequested,
        ),
      ),
    );
    const launchPaths = yield* LaunchPaths;
    const logger = yield* createLogger(false);
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory);
    const selectedApps = yield* selectIosApps(loadedConfiguration.apps, statusFlags.app);

    const usageProblem = findStatusUsageProblem(statusFlags, selectedApps.length);
    const isUsageProblemFound = usageProblem !== null;
    if (isUsageProblemFound) {
      return yield* endWithUsageFailure(
        makeUsageFailure({ message: usageProblem }),
        statusFlags.json,
      );
    }

    const isThereNoSelectedApp = selectedApps.length === 0;
    const isBuildWatchWithNoApp = isThereNoSelectedApp && statusFlags.build !== undefined;
    if (isBuildWatchWithNoApp) {
      return yield* Effect.fail(
        createStatusFailure('find iOS app', new Error(NO_IOS_APPS_MESSAGE)),
      );
    }
    if (isThereNoSelectedApp) {
      yield* logger.note(NO_IOS_APPS_MESSAGE);
      return;
    }

    const ascKey = yield* loadAscKeyForAccount(statusFlags.account);
    const isThereNoAscKey = ascKey === null;
    if (isThereNoAscKey) {
      return yield* Effect.fail(
        createStatusFailure(
          'load Apple account',
          new Error(
            'No Apple account key found. Run `launch creds set-key`, or pick one with --account.',
          ),
        ),
      );
    }
    const appleStoreClients = yield* AppleStoreClientService;
    const appleClient = yield* appleStoreClients.createClient(ascKey);

    const [onlySelectedApp] = selectedApps;
    const watchedBuildNumber = statusFlags.build;
    const isBuildWatch = watchedBuildNumber !== undefined && onlySelectedApp !== undefined;
    if (isBuildWatch) {
      const buildWatchRequest: BuildWatchRequest = {
        appleClient,
        selectedApp: onlySelectedApp,
        buildNumber: watchedBuildNumber,
        logger,
        isJson: statusFlags.json,
      };
      const storeBuild = yield* watchBuildProcessing(buildWatchRequest).pipe(
        Effect.tapError((watchFailure) => reportFailedBuildWatch(buildWatchRequest, watchFailure)),
      );
      return yield* reportValidBuild(buildWatchRequest, storeBuild);
    }

    const isWatchingInTerminal = statusFlags.watch && !statusFlags.json;
    if (isWatchingInTerminal) {
      const isBuildListWanted = false;
      const readStatuses = () => readSelectedStatuses(appleClient, selectedApps, isBuildListWanted);
      const watchExitCode = yield* watchReleaseStatuses(
        readStatuses,
        logger,
        loadedConfiguration.config,
      );
      return yield* completeCommand(watchExitCode);
    }

    const appStatuses = yield* readSelectedStatuses(appleClient, selectedApps, statusFlags.builds);
    const isJsonOutput = statusFlags.json;
    if (isJsonOutput) {
      yield* logger.line(JSON.stringify(appStatuses.map(createStatusJsonRow), null, 2));
    }

    const isHumanOutput = !isJsonOutput;
    if (isHumanOutput) yield* printStatusBatch(logger, appStatuses);
    const statusExitCode = worstExitCode(
      appStatuses.map((appStatus) => appStatus.releaseStatus.verdict.exitCode),
    );
    return yield* completeCommand(statusExitCode);
  }).pipe(
    Effect.mapError((cause) => {
      if (isCommandExit(cause)) return cause;
      if (isStatusCommandFailure(cause)) return cause;
      return createStatusFailure('read App Store status', cause);
    }),
  );
