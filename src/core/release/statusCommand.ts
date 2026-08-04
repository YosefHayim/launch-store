import { Data, Effect, Schema } from 'effect';
import { loadConfig } from '../config/config.js';
import { loadActiveAscKey } from '../credentials/accounts.js';
import {
  AppleStoreClientService,
  type AppleStoreClientService as AppleStoreClientRequirements,
} from '../services/appleStoreClient.js';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { notify } from '../services/notify.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { CommandExitSchema, completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { AppDescriptor } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';
import { IOS_PLATFORM, readReleaseStatus, type ReleaseStatus } from './appStoreRelease.js';
import { createTransitionTracker, planTransitionNotifications } from './releaseNotify.js';

const WATCH_INTERVAL_MS = 30_000;

export const StatusCommandInputSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  watch: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  json: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});

export type StatusCommandInput = Schema.Schema.Type<typeof StatusCommandInputSchema>;

/** One discovered iOS app reduced to status-read identity. */
export type StatusApp = Readonly<{ name: string; bundleId: string }>;

/** One app and its latest App Store status. */
export type AppReleaseStatus = Readonly<{ appName: string; releaseStatus: ReleaseStatus }>;

/** Reading or watching App Store status failed. */
export type StatusCommandFailure = Readonly<{
  readonly _tag: 'StatusCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeStatusCommandFailure = Data.tagged<StatusCommandFailure>('StatusCommandFailure');

export const StatusCommandFailureSchema: Schema.Schema<StatusCommandFailure> = Schema.Struct({
  _tag: Schema.Literal('StatusCommandFailure'),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
});

type AccountRequirements = Effect.Effect.Context<ReturnType<typeof loadActiveAscKey>>;
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

/** Format one human-readable App Store status line. */
export const formatStatusLine = (releaseStatus: ReleaseStatus): string => {
  const statusParts: string[] = [];
  if (releaseStatus.versionString === null) statusParts.push('no App Store version');
  else statusParts.push(`v${releaseStatus.versionString}`);
  statusParts.push(releaseStatus.verdict.label);
  if (releaseStatus.buildNumber !== null) {
    let processingSuffix = '';
    if (
      releaseStatus.buildProcessingState !== null &&
      releaseStatus.buildProcessingState !== 'VALID'
    ) {
      processingSuffix = ` (${releaseStatus.buildProcessingState})`;
    }
    statusParts.push(`build ${releaseStatus.buildNumber}${processingSuffix}`);
  }
  if (releaseStatus.phasedReleaseState !== null)
    statusParts.push(`phased: ${releaseStatus.phasedReleaseState}`);
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

/** Read every selected app concurrently through the shared Apple transport. */
const readSelectedStatuses = (
  appleClient: Parameters<typeof readReleaseStatus>[0],
  selectedApps: readonly StatusApp[],
): Effect.Effect<AppReleaseStatus[], StatusCommandFailure> =>
  Effect.forEach(
    selectedApps,
    (selectedApp) =>
      readReleaseStatus(appleClient, selectedApp.bundleId, IOS_PLATFORM).pipe(
        Effect.mapError((cause) =>
          statusFailure(`read App Store status for ${selectedApp.name}`, cause),
        ),
        Effect.map((releaseStatus) => ({ appName: selectedApp.name, releaseStatus })),
      ),
    { concurrency: 'unbounded' },
  );

/** Print one human-readable status batch. */
const printStatusBatch = (
  logger: Logger,
  appStatuses: readonly AppReleaseStatus[],
): Effect.Effect<void, unknown> =>
  Effect.forEach(
    appStatuses,
    (appStatus) => logger.step(appStatus.appName, formatStatusLine(appStatus.releaseStatus)),
    { concurrency: 1, discard: true },
  );

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
    if (selectedApps.length === 0) {
      yield* logger.note(
        'No iOS apps discovered. Add an app with an ios.bundleIdentifier in app.json.',
      );
      return;
    }
    const ascKey = yield* loadActiveAscKey();
    if (ascKey === null) {
      return yield* Effect.fail(
        statusFailure(
          'load active Apple account',
          'missing-active-account',
          'No active Apple account. Run `launch creds set-key` first.',
        ),
      );
    }
    const appleStoreClients = yield* AppleStoreClientService;
    const appleClient = yield* appleStoreClients.createClient(ascKey);
    const readStatuses = () => readSelectedStatuses(appleClient, selectedApps);
    let exitCode: number;
    if (commandInput.watch && !commandInput.json) {
      exitCode = yield* watchReleaseStatuses(readStatuses, logger, loadedConfiguration.config);
    } else {
      const appStatuses = yield* readStatuses();
      if (commandInput.json) {
        yield* logger.line(
          JSON.stringify(
            appStatuses.map((appStatus) => appStatus.releaseStatus),
            null,
            2,
          ),
        );
      } else {
        yield* printStatusBatch(logger, appStatuses);
      }
      exitCode = worstExitCode(
        appStatuses.map((appStatus) => appStatus.releaseStatus.verdict.exitCode),
      );
    }
    yield* completeCommand(exitCode);
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(CommandExitSchema)(cause)) return cause;
      if (Schema.is(StatusCommandFailureSchema)(cause)) return cause;
      return statusFailure('read App Store status', cause);
    }),
  );
