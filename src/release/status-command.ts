// Prints where each iOS app's current App Store version stands, including review and rollout.

import { loadConfig } from '../config/config.ts';
import { loadAscKeyForAccount } from '../credentials/accounts.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import { notify } from '../services/platform/notify.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { AppleStoreClientService } from '../services/stores/apple-store-client.ts';
import { completeCommand, isCommandExit, makeCommandExit } from '../terminal/command-exit.ts';
import { alignTableColumns, type Column } from '../terminal/table.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { BuildResource } from '../types/apple-catalog.ts';
import type { LaunchConfig } from '../types/config.ts';
import {
  IOS_PLATFORM,
  readAppStoreAppId,
  readReleaseStatusForApp,
  type AscReleaseApi,
  type ReleaseStatus,
  waitForValidBuild,
} from './app-store-release.ts';
import { createTransitionTracker, planTransitionNotifications } from './release-notify.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { isFailureTag } from '../services/platform/tagged-failure.ts';

const NO_IOS_APPS_MESSAGE =
  'No iOS apps discovered. Add an app with an ios.bundleIdentifier in app.json.';

export type StatusCommandFlags = {
  readonly app?: string;
  readonly account?: string;
  readonly watch?: boolean;
  readonly build?: string;
  readonly builds?: boolean;
  readonly json?: boolean;
};

type StatusFlags = {
  readonly app?: string;
  readonly account?: string;
  readonly watch: boolean;
  readonly build?: number;
  readonly builds: boolean;
  readonly json: boolean;
};

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

function makeStatusCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): StatusCommandFailure {
  return {
    _tag: 'StatusCommandFailure',
    operation: fields.operation,
    message: fields.message,
    cause: fields.cause,
  };
}

function isStatusCommandFailure(cause: unknown): cause is StatusCommandFailure {
  return isFailureTag(cause, 'StatusCommandFailure');
}

function createStatusFailure(operation: string, cause: unknown): StatusCommandFailure {
  const failureMessage = errorMessage(cause);
  return makeStatusCommandFailure({ operation, message: failureMessage, cause });
}

function readOptionalText(record: Record<string, unknown>, fieldName: string): string | undefined {
  const hasField = Object.hasOwn(record, fieldName);

  if (hasField == false) {
    return undefined;
  }

  const field = record[fieldName];
  const isText = typeof field == 'string';

  if (isText == false) {
    throw new Error(`Status ${fieldName} must be a string.`);
  }

  return field;
}

function readDefaultBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const hasField = Object.hasOwn(record, fieldName);

  if (hasField == false) {
    return false;
  }

  const field = record[fieldName];

  if (field == null) {
    return false;
  }

  const isBoolean = typeof field == 'boolean';

  if (isBoolean == false) {
    throw new Error(`Status ${fieldName} must be a boolean.`);
  }

  return field;
}

function readOptionalBuild(record: Record<string, unknown>): number | undefined {
  const hasField = Object.hasOwn(record, 'build');

  if (hasField == false) {
    return undefined;
  }

  const field = record['build'];
  const isText = typeof field == 'string';

  if (isText == false) {
    throw new Error('--build takes a whole number above 0, such as 42.');
  }

  // A build number is digits only, greater than zero.
  const isWholeNumber = /^\d+$/.test(field);

  if (isWholeNumber == false) {
    throw new Error('--build takes a whole number above 0, such as 42.');
  }

  const buildNumber = Number.parseInt(field, 10);
  const isPositive = buildNumber > 0;

  if (isPositive == false) {
    throw new Error('--build takes a whole number above 0, such as 42.');
  }

  return buildNumber;
}

function decodeStatusFlags(flagsFromCli: StatusCommandFlags): StatusFlags {
  const flagsFromCliObject = readPlainObject(flagsFromCli);

  if (flagsFromCliObject == null) {
    throw new Error('--build takes a whole number above 0, such as 42.');
  }

  const app = readOptionalText(flagsFromCliObject, 'app');
  const account = readOptionalText(flagsFromCliObject, 'account');
  const decodedFlags: StatusFlags = {
    watch: readDefaultBoolean(flagsFromCliObject, 'watch'),
    builds: readDefaultBoolean(flagsFromCliObject, 'builds'),
    json: readDefaultBoolean(flagsFromCliObject, 'json'),
  };
  const build = readOptionalBuild(flagsFromCliObject);
  let withSelectors: StatusFlags = decodedFlags;

  if (app != null) {
    withSelectors = { ...withSelectors, app };
  }

  if (account != null) {
    withSelectors = { ...withSelectors, account };
  }

  if (build != null) {
    withSelectors = { ...withSelectors, build };
  }

  return withSelectors;
}

function failUsage(message: string, isJson: boolean): never {
  const logger = createLogger(false);

  if (isJson) {
    const serialized = JSON.stringify({ ok: false, error: message });
    logger.line(serialized);
  }

  if (isJson == false) {
    logger.error(message);
  }

  throw makeCommandExit({ exitCode: 2, message });
}

export function selectIosApps(
  discoveredApps: readonly AppDescriptor[],
  appSelector: string | undefined,
): StatusApp[] {
  const iosApps: StatusApp[] = [];

  for (const discoveredApp of discoveredApps) {
    const bundleId = discoveredApp.bundleId;

    const isIosApp = bundleId != null;

    if (isIosApp) {
      iosApps.push({ name: discoveredApp.name, bundleId });
    }
  }

  const isAppSelectorMissing = appSelector == null;

  if (isAppSelectorMissing) {
    return iosApps;
  }

  function trimmedName(appName: string): string {
    return appName.trim();
  }

  function hasName(appName: string): boolean {
    return appName.length > 0;
  }

  const requestedNames = appSelector.split(',').map(trimmedName).filter(hasName);

  function appName(iosApp: StatusApp): string {
    return iosApp.name;
  }

  const iosAppsByName = new Map(
    iosApps.map(function iosAppEntry(iosApp) {
      return [appName(iosApp), iosApp] as const;
    }),
  );
  const selectedApps: StatusApp[] = [];

  for (const requestedName of requestedNames) {
    const selectedApp = iosAppsByName.get(requestedName);

    const isAppFound = selectedApp != null;

    if (isAppFound) {
      selectedApps.push(selectedApp);
      continue;
    }

    const isThereIosApp = iosApps.length > 0;
    let availableApps = 'none';

    if (isThereIosApp) {
      availableApps = iosApps.map(appName).join(', ');
    }

    throw createStatusFailure(
      'select iOS apps',
      new Error(`Unknown iOS app "${requestedName}". iOS apps: ${availableApps}.`),
    );
  }

  return selectedApps;
}

function describeAttachedBuild(releaseStatus: ReleaseStatus): string {
  const isNoBuildAttached = releaseStatus.buildNumber == null;

  if (isNoBuildAttached) {
    return 'no build';
  }

  const processingState = releaseStatus.buildProcessingState;

  const hasProcessingState = processingState != null;

  if (hasProcessingState) {
    const isStillProcessing = processingState != 'VALID';

    if (isStillProcessing) {
      return `build ${releaseStatus.buildNumber} (${processingState})`;
    }
  }

  return `build ${releaseStatus.buildNumber}`;
}

function describeReleaseStatus(releaseStatus: ReleaseStatus): string {
  const isVersionPresent = releaseStatus.versionString != null;
  let versionPart = 'no App Store version';

  if (isVersionPresent) {
    versionPart = `v${releaseStatus.versionString}`;
  }

  const statusParts = [versionPart, releaseStatus.verdict.label];

  if (isVersionPresent) {
    const buildProgram = describeAttachedBuild(releaseStatus);
    statusParts.push(buildProgram);
  }

  const isPhasedReleaseKnown = releaseStatus.phasedReleaseState != null;

  if (isPhasedReleaseKnown) {
    statusParts.push(`phased: ${releaseStatus.phasedReleaseState}`);
  }

  return statusParts.join(' - ');
}

function exitCodeRank(exitCode: number): number {
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
}

function worstExitCode(exitCodes: readonly number[]): number {
  let worstCode = 0;

  for (const exitCode of exitCodes) {
    const isWorse = exitCodeRank(exitCode) > exitCodeRank(worstCode);

    if (isWorse) {
      worstCode = exitCode;
    }
  }

  return worstCode;
}

function describeUploadTime(uploadedDate: string | undefined): string {
  const isUploadTimeMissing = uploadedDate == null;

  if (isUploadTimeMissing) {
    return '-';
  }

  return new Date(uploadedDate).toISOString().slice(0, 16).replace('T', ' ');
}

function describeRecentBuilds(recentBuilds: readonly BuildResource[]): string {
  const isThereNoBuild = recentBuilds.length == 0;

  if (isThereNoBuild) {
    return '  no builds uploaded yet';
  }

  const recentBuildColumns: readonly Column<BuildResource>[] = [
    {
      header: 'VERSION',
      cell: function marketingVersion(build) {
        if (build.marketingVersion == null) {
          return '-';
        }

        return build.marketingVersion;
      },
    },
    {
      header: 'BUILD',
      cell: function buildNumber(build) {
        return build.version;
      },
    },
    {
      header: 'PROCESSING',
      cell: function processingState(build) {
        return build.processingState;
      },
    },
    {
      header: 'UPLOADED (UTC)',
      cell: function uploadedAt(build) {
        return describeUploadTime(build.uploadedDate);
      },
    },
  ];

  return alignTableColumns(recentBuildColumns, recentBuilds);
}

async function readOneAppStatus(
  appleClient: AscReleaseApi,
  selectedApp: StatusApp,
  isBuildListWanted: boolean,
): Promise<AppReleaseStatus> {
  let appId: string;

  try {
    appId = await readAppStoreAppId(appleClient, selectedApp.bundleId);
  } catch (cause) {
    throw createStatusFailure(`find App Store app for ${selectedApp.name}`, cause);
  }

  let releaseStatus: ReleaseStatus;

  try {
    releaseStatus = await readReleaseStatusForApp(
      appleClient,
      appId,
      selectedApp.bundleId,
      IOS_PLATFORM,
    );
  } catch (cause) {
    throw createStatusFailure(`read App Store status for ${selectedApp.name}`, cause);
  }

  if (isBuildListWanted == false) {
    return { appName: selectedApp.name, releaseStatus };
  }

  const recentBuildCount = 25;
  let recentBuilds: BuildResource[];

  try {
    recentBuilds = await appleClient.listBuilds(appId, recentBuildCount);
  } catch (cause) {
    throw createStatusFailure(`list builds for ${selectedApp.name}`, cause);
  }

  return { appName: selectedApp.name, releaseStatus, recentBuilds };
}

function readSelectedStatuses(
  appleClient: AscReleaseApi,
  selectedApps: readonly StatusApp[],
  isBuildListWanted: boolean,
): Promise<AppReleaseStatus[]> {
  function readStatus(selectedApp: StatusApp): Promise<AppReleaseStatus> {
    return readOneAppStatus(appleClient, selectedApp, isBuildListWanted);
  }

  return Promise.all(selectedApps.map(readStatus));
}

function printOneAppStatus(logger: Logger, appStatus: AppReleaseStatus): void {
  logger.step(appStatus.appName, describeReleaseStatus(appStatus.releaseStatus));

  const recentBuilds = appStatus.recentBuilds;
  const isBuildListPresent = recentBuilds != null;

  if (isBuildListPresent == false) {
    return;
  }

  logger.line(describeRecentBuilds(recentBuilds));
}

function printStatusBatch(logger: Logger, appStatuses: readonly AppReleaseStatus[]): void {
  for (const appStatus of appStatuses) {
    printOneAppStatus(logger, appStatus);
  }
}

function createStatusJsonRow(appStatus: AppReleaseStatus):
  | ReleaseStatus
  | (ReleaseStatus & {
      recentBuilds: readonly BuildResource[];
    }) {
  const recentBuilds = appStatus.recentBuilds;
  const isBuildListPresent = recentBuilds != null;

  if (isBuildListPresent == false) {
    return appStatus.releaseStatus;
  }

  return { ...appStatus.releaseStatus, recentBuilds };
}

function sleepMilliseconds(milliseconds: number): Promise<void> {
  return new Promise(function wakeAfterDelay(wakeUp) {
    setTimeout(wakeUp, milliseconds);
  });
}

async function watchReleaseStatuses(
  readStatuses: () => Promise<AppReleaseStatus[]>,
  logger: Logger,
  launchConfiguration: LaunchConfig,
): Promise<number> {
  const transitionTracker = createTransitionTracker();

  for (;;) {
    const appStatuses = await readStatuses();

    logger.gap();
    printStatusBatch(logger, appStatuses);

    for (const appStatus of appStatuses) {
      const notificationEvents = planTransitionNotifications(
        appStatus.appName,
        appStatus.releaseStatus,
        transitionTracker,
      );

      for (const notificationEvent of notificationEvents) {
        await notify(launchConfiguration, notificationEvent);
      }
    }

    function isDone(appStatus: AppReleaseStatus): boolean {
      return appStatus.releaseStatus.verdict.done;
    }

    const isEveryAppDone = appStatuses.every(isDone);

    if (isEveryAppDone) {
      function verdictExitCode(appStatus: AppReleaseStatus): number {
        return appStatus.releaseStatus.verdict.exitCode;
      }

      return worstExitCode(appStatuses.map(verdictExitCode));
    }

    const watchIntervalMs = 30_000;

    await sleepMilliseconds(watchIntervalMs);
  }
}

type BuildWatchRequest = Readonly<{
  appleClient: AscReleaseApi;
  selectedApp: StatusApp;
  buildNumber: number;
  logger: Logger;
  isJson: boolean;
}>;

async function watchBuildProcessing(buildWatchRequest: BuildWatchRequest): Promise<BuildResource> {
  let appId: string;

  try {
    appId = await readAppStoreAppId(
      buildWatchRequest.appleClient,
      buildWatchRequest.selectedApp.bundleId,
    );
  } catch (cause) {
    throw createStatusFailure(
      `find App Store app for ${buildWatchRequest.selectedApp.name}`,
      cause,
    );
  }

  function reportProgress(processingState: string): void {
    if (buildWatchRequest.isJson) {
      return;
    }

    buildWatchRequest.logger.step(
      buildWatchRequest.selectedApp.name,
      `build ${buildWatchRequest.buildNumber} is ${processingState}`,
    );
  }

  try {
    return await waitForValidBuild(
      buildWatchRequest.appleClient,
      appId,
      buildWatchRequest.buildNumber,
      { onTick: reportProgress },
    );
  } catch (cause) {
    throw createStatusFailure(
      `wait for build ${buildWatchRequest.buildNumber} of ${buildWatchRequest.selectedApp.name}`,
      cause,
    );
  }
}

function reportValidBuild(buildWatchRequest: BuildWatchRequest, storeBuild: BuildResource): void {
  const logger = buildWatchRequest.logger;

  if (buildWatchRequest.isJson) {
    const validBuildReport = {
      ok: true,
      appName: buildWatchRequest.selectedApp.name,
      buildNumber: buildWatchRequest.buildNumber,
      processingState: storeBuild.processingState,
    };
    const serialized = JSON.stringify(validBuildReport, null, 2);

    logger.line(serialized);

    return;
  }

  logger.step(
    buildWatchRequest.selectedApp.name,
    `build ${buildWatchRequest.buildNumber} is ${storeBuild.processingState} - ready to release`,
  );
}

function reportFailedBuildWatch(
  buildWatchRequest: BuildWatchRequest,
  watchFailure: StatusCommandFailure,
): void {
  if (buildWatchRequest.isJson == false) {
    return;
  }

  const failedBuildReport = {
    ok: false,
    appName: buildWatchRequest.selectedApp.name,
    buildNumber: buildWatchRequest.buildNumber,
    error: watchFailure.message,
  };
  const serialized = JSON.stringify(failedBuildReport, null, 2);

  buildWatchRequest.logger.line(serialized);
}

function buildWithoutWatch(statusFlags: StatusFlags): boolean {
  if (statusFlags.build == null) {
    return false;
  }

  return statusFlags.watch == false;
}

function buildsWithWatch(statusFlags: StatusFlags): boolean {
  if (statusFlags.builds == false) {
    return false;
  }

  return statusFlags.watch;
}

function buildForSeveralApps(statusFlags: StatusFlags, iosAppCount: number): boolean {
  if (statusFlags.build == null) {
    return false;
  }

  return iosAppCount > 1;
}

function findStatusUsageProblem(statusFlags: StatusFlags, iosAppCount: number): string | null {
  if (buildWithoutWatch(statusFlags)) {
    return '--build needs --watch: it waits for that build to finish processing.';
  }

  if (buildsWithWatch(statusFlags)) {
    return '--builds lists builds without waiting: drop --watch to list them.';
  }

  if (buildForSeveralApps(statusFlags, iosAppCount)) {
    return '--build waits on one build of one app: pass --app <name>.';
  }

  return null;
}

function isSingleBuildWatch(
  buildNumber: number | undefined,
  onlySelectedApp: StatusApp | undefined,
): buildNumber is number {
  if (buildNumber == null) {
    return false;
  }

  return onlySelectedApp != null;
}

export async function statusCommandProgram(flagsFromCli: StatusCommandFlags): Promise<void> {
  const isJsonRequested = flagsFromCli.json == true;

  try {
    let statusFlags: StatusFlags;

    try {
      statusFlags = decodeStatusFlags(flagsFromCli);
    } catch (cause) {
      failUsage('--build takes a whole number above 0, such as 42.', isJsonRequested);
    }

    const launchPaths = readLaunchDirectories();
    const logger = createLogger(false);
    const loadedConfiguration = await loadConfig(launchPaths.workingDirectory);
    const selectedApps = selectIosApps(loadedConfiguration.apps, statusFlags.app);
    const usageProblem = findStatusUsageProblem(statusFlags, selectedApps.length);

    const isUsageProblemFound = usageProblem != null;

    if (isUsageProblemFound) {
      failUsage(usageProblem, statusFlags.json);
    }

    const isThereNoSelectedApp = selectedApps.length == 0;

    const isBuildWatchWithNoApp = isThereNoSelectedApp;

    if (isBuildWatchWithNoApp) {
      if (statusFlags.build != null) {
        throw createStatusFailure('find iOS app', new Error(NO_IOS_APPS_MESSAGE));
      }
    }

    if (isThereNoSelectedApp) {
      logger.note(NO_IOS_APPS_MESSAGE);
      return;
    }

    const ascKey = await loadAscKeyForAccount(statusFlags.account);

    const isThereNoAscKey = ascKey == null;

    if (isThereNoAscKey) {
      throw createStatusFailure(
        'load Apple account',
        new Error(
          'No Apple account key found. Run `launch-store creds set-key`, or pick one with --account.',
        ),
      );
    }

    const appleClient = new AppleStoreClientService().createClient(ascKey);
    const onlySelectedApp = selectedApps[0];

    const hasNoSelectedApp = onlySelectedApp == null;

    if (hasNoSelectedApp) {
      return;
    }

    const watchedBuildNumber = statusFlags.build;

    if (isSingleBuildWatch(watchedBuildNumber, onlySelectedApp)) {
      const buildWatchRequest: BuildWatchRequest = {
        appleClient,
        selectedApp: onlySelectedApp,
        buildNumber: watchedBuildNumber,
        logger,
        isJson: statusFlags.json,
      };

      try {
        const storeBuild = await watchBuildProcessing(buildWatchRequest);
        reportValidBuild(buildWatchRequest, storeBuild);
        return;
      } catch (cause) {
        if (isStatusCommandFailure(cause)) {
          reportFailedBuildWatch(buildWatchRequest, cause);
        }

        throw cause;
      }
    }

    const isWatchingInTerminal = statusFlags.watch;

    if (isWatchingInTerminal) {
      if (statusFlags.json == false) {
        const watchExitCode = await watchReleaseStatuses(
          function readStatuses() {
            return readSelectedStatuses(appleClient, selectedApps, false);
          },
          logger,
          loadedConfiguration.config,
        );

        completeCommand(watchExitCode);

        return;
      }
    }

    const appStatuses = await readSelectedStatuses(appleClient, selectedApps, statusFlags.builds);

    if (statusFlags.json) {
      const jsonRows = appStatuses.map(createStatusJsonRow);
      const serialized = JSON.stringify(jsonRows, null, 2);
      logger.line(serialized);
    }

    if (statusFlags.json == false) {
      printStatusBatch(logger, appStatuses);
    }

    function verdictExitCode(appStatus: AppReleaseStatus): number {
      return appStatus.releaseStatus.verdict.exitCode;
    }

    completeCommand(worstExitCode(appStatuses.map(verdictExitCode)));
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    if (isStatusCommandFailure(cause)) {
      throw cause;
    }

    throw createStatusFailure('read App Store status', cause);
  }
}
