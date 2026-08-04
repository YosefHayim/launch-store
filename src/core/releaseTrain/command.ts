import type { Terminal } from '@effect/platform';
import { randomUUID } from 'node:crypto';
import { Clock, Data, Effect, Schema } from 'effect';
import { resolveCommandEnv, selectApp } from '../build/pipelineEnv.js';
import { loadConfig } from '../config/config.js';
import { parseCliEnv } from '../config/env.js';
import { resolveRuntimeVersion } from '../config/updateCommand.js';
import { isCloudStorage } from '../distribution/storage.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPromptService } from '../services/prompt.js';
import { CommandExitSchema, completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { AppDescriptor } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';
import type { Car, TrainRecord } from '../types/releaseTrain.js';
import { buildTrainRuntime, type TrainRuntime, type TrainRuntimeRequirements } from './builder.js';
import { resolveTrainCars, type ResolveCarsInput } from './engine.js';
import { isOtaCar, isTrainPlatform } from './guards.js';
import { advanceTrain, isTrainSettled, startTrain, trainExitCode } from './orchestrator.js';
import {
  latestTrainRecord,
  listTrainRecords,
  readTrainRecord,
  type TrainRecordRequirements,
  writeTrainRecord,
} from './record.js';

const WATCH_INTERVAL = '30 seconds';

type ReleaseTrainRequirements =
  | LaunchPromptService
  | Logger
  | Terminal.Terminal
  | TrainRuntimeRequirements;
type ReleaseTrainRecordRequirements = Logger | TrainRecordRequirements;

const OptionalString = Schema.optionalWith(Schema.String, { exact: true });
const OptionalBoolean = Schema.optionalWith(Schema.Boolean, { exact: true });

export const ReleaseTrainCommandOptionsSchema = Schema.Struct({
  app: OptionalString,
  profile: Schema.String,
  platform: OptionalString,
  ota: Schema.Boolean,
  hold: OptionalBoolean,
  channel: Schema.String,
  runtimeVersion: OptionalString,
  watch: OptionalBoolean,
  json: OptionalBoolean,
  env: Schema.Array(Schema.String),
  includeLocal: Schema.Boolean,
});

/** Flags shared by the release-train command verbs. */
export type ReleaseTrainCommandOptions = Schema.Schema.Type<
  typeof ReleaseTrainCommandOptionsSchema
>;

/** Schema for one requested release-train verb. */
export const ReleaseTrainCommandInputSchema = Schema.Struct({
  action: Schema.String,
  id: OptionalString,
  options: ReleaseTrainCommandOptionsSchema,
});

export type ReleaseTrainCommandInput = Schema.Schema.Type<typeof ReleaseTrainCommandInputSchema>;

/** Release-train configuration, persistence, or orchestration failed. */
export const ReleaseTrainCommandFailureSchema = Schema.Struct({
  _tag: Schema.Literal('ReleaseTrainCommandFailure'),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
});

export type ReleaseTrainCommandFailure = Schema.Schema.Type<
  typeof ReleaseTrainCommandFailureSchema
>;

export const makeReleaseTrainCommandFailure = Data.tagged<ReleaseTrainCommandFailure>(
  'ReleaseTrainCommandFailure',
);

type PreparedTrain = Readonly<{
  config: LaunchConfig;
  app: AppDescriptor;
  runtime: TrainRuntime;
  logger: Logger;
}>;

/** Convert an unknown cause to the release-train failure channel. */
const trainFailure = (
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): ReleaseTrainCommandFailure => {
  let message = fallbackMessage;
  if (message === undefined && cause instanceof Error) message = cause.message;
  if (message === undefined) message = `${operation} failed.`;
  return makeReleaseTrainCommandFailure({ operation, message, cause });
};

/** Map one logger write into the release-train failure channel. */
const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, ReleaseTrainCommandFailure> =>
  logWrite.pipe(Effect.mapError((cause) => trainFailure(operation, cause)));

/** Read the current instant through Effect's clock service. */
const currentIsoTime = (): Effect.Effect<string> =>
  Clock.currentTimeMillis.pipe(Effect.map((epochMillis) => new Date(epochMillis).toISOString()));

/** Mint a stable train id from the app slug and a short random suffix. */
export const mintTrainId = (appName: string): string => {
  let appSlug = appName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (appSlug === '') appSlug = 'train';
  return `${appSlug}-${randomUUID().slice(0, 4)}`;
};

/** Format one train car's human label. */
export const carLabel = (trainCar: Car): string => {
  if (isOtaCar(trainCar))
    return `OTA ${trainCar.platform} (${trainCar.channel}/${trainCar.runtimeVersion})`;
  return trainCar.kind;
};

/** Format one train car's state and most useful identifier. */
export const carStatusLine = (trainCar: Car): string => {
  if (isOtaCar(trainCar)) {
    let manifestDetail = '';
    if (trainCar.manifestId !== undefined) manifestDetail = ` - ${trainCar.manifestId}`;
    return `${carLabel(trainCar)}: ${trainCar.state}${manifestDetail}`;
  }
  let nativeDetail = '';
  if (trainCar.error !== undefined) nativeDetail = ` - ${trainCar.error}`;
  else if (trainCar.buildId !== undefined) nativeDetail = ` - build ${trainCar.buildId}`;
  return `${carLabel(trainCar)}: ${trainCar.state}${nativeDetail}`;
};

/** Render one train record as a boxed human summary. */
const renderTrain = (
  trainRecord: TrainRecord,
  logger: Logger,
): Effect.Effect<void, ReleaseTrainCommandFailure> => {
  let holdDetail = '';
  if (trainRecord.hold) holdDetail = ' - hold';
  return writeLog(
    'render release train',
    logger.box(
      `Train ${trainRecord.id} - ${trainRecord.app} - ${trainRecord.state}${holdDetail}`,
      trainRecord.cars.map(carStatusLine),
    ),
  );
};

/** Resolve an explicit train id or the latest persisted train. */
const resolveTarget = (
  trainId: string | undefined,
): Effect.Effect<TrainRecord, ReleaseTrainCommandFailure, TrainRecordRequirements> =>
  Effect.gen(function* () {
    let trainRecord: TrainRecord | null;
    if (trainId !== undefined) trainRecord = yield* readTrainRecord(trainId);
    else {
      trainRecord = yield* latestTrainRecord().pipe(
        Effect.mapError((cause) => trainFailure('read latest release train', cause)),
      );
    }
    if (trainRecord !== null) return trainRecord;
    if (trainId !== undefined) {
      const knownTrainIds = yield* listTrainRecords().pipe(
        Effect.map((knownTrains) => knownTrains.map((knownTrain) => knownTrain.id)),
        Effect.mapError((cause) => trainFailure('list release trains', cause)),
      );
      let knownTrainSummary = knownTrainIds.join(', ');
      if (knownTrainSummary === '') knownTrainSummary = 'none';
      return yield* Effect.fail(
        trainFailure(
          'find release train',
          trainId,
          `No release train "${trainId}". Known: ${knownTrainSummary}.`,
        ),
      );
    }
    return yield* Effect.fail(
      trainFailure(
        'find release train',
        trainId,
        'No release train yet. Start one with `launch release-train start`.',
      ),
    );
  });

/** Load app configuration, environment, logger, and the live train engine. */
const prepareTrain = (
  commandOptions: ReleaseTrainCommandOptions,
): Effect.Effect<PreparedTrain, ReleaseTrainCommandFailure, ReleaseTrainRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const loadedConfiguration = yield* loadConfig().pipe(
      Effect.mapError((cause) => trainFailure('load Launch configuration', cause)),
    );
    const selectedApp = yield* selectApp(loadedConfiguration.apps, commandOptions.app).pipe(
      Effect.mapError((cause) => trainFailure('select app', cause, cause.message)),
    );
    let buildProfile = loadedConfiguration.config.profiles[commandOptions.profile];
    if (buildProfile === undefined) buildProfile = { name: commandOptions.profile };
    const environmentOverrides = yield* parseCliEnv([...commandOptions.env]).pipe(
      Effect.mapError((cause) => trainFailure('parse environment overrides', cause, cause.message)),
    );
    const resolvedEnvironment = yield* resolveCommandEnv({
      app: selectedApp,
      profile: buildProfile,
      cliEnv: environmentOverrides,
      includeLocal: commandOptions.includeLocal,
      envExclude: loadedConfiguration.config.envExclude,
    }).pipe(Effect.mapError((cause) => trainFailure('resolve release train environment', cause)));
    const runtime = buildTrainRuntime(
      loadedConfiguration.config,
      selectedApp,
      buildProfile,
      resolvedEnvironment.values,
      commandOptions.hold === true,
      logger,
    );
    return {
      config: loadedConfiguration.config,
      app: selectedApp,
      runtime,
      logger,
    };
  });

/** Persist one release-train record. */
const persistTrain = (
  trainRecord: TrainRecord,
): Effect.Effect<void, ReleaseTrainCommandFailure, TrainRecordRequirements> =>
  writeTrainRecord(trainRecord).pipe(
    Effect.mapError((cause) => trainFailure('write release train', cause)),
  );

/** Render JSON or human output and complete with the record's exit code. */
const reportTrain = (
  trainRecord: TrainRecord,
  commandOptions: ReleaseTrainCommandOptions,
  logger: Logger,
): Effect.Effect<void, CommandExit | ReleaseTrainCommandFailure> =>
  Effect.gen(function* () {
    if (commandOptions.json === true)
      yield* writeLog(
        'render release train JSON',
        logger.line(JSON.stringify(trainRecord, null, 2)),
      );
    else yield* renderTrain(trainRecord, logger);
    yield* completeCommand(trainExitCode(trainRecord));
  });

/** Reconcile a train once, persist it, and render any retryable OTA warnings. */
const reconcileOnce = (
  trainRecord: TrainRecord,
  runtime: TrainRuntime,
  force: boolean,
  logger: Logger,
): Effect.Effect<TrainRecord, ReleaseTrainCommandFailure, TrainRuntimeRequirements> =>
  Effect.gen(function* () {
    const warningMessages: string[] = [];
    const advancedTrain = yield* advanceTrain(trainRecord, runtime.engine, {
      now: yield* currentIsoTime(),
      force,
      onWarn: (warningMessage) => {
        warningMessages.push(warningMessage);
      },
    }).pipe(Effect.mapError((cause) => trainFailure('advance release train', cause)));
    yield* persistTrain(advancedTrain);
    for (const warningMessage of warningMessages)
      yield* writeLog('render release train warning', logger.warn(warningMessage));
    return advancedTrain;
  });

/** Start a new train from the app's declared native and OTA cars. */
const startReleaseTrain = (
  commandOptions: ReleaseTrainCommandOptions,
): Effect.Effect<void, CommandExit | ReleaseTrainCommandFailure, ReleaseTrainRequirements> =>
  Effect.gen(function* () {
    const platformFilter = commandOptions.platform;
    if (platformFilter !== undefined && !isTrainPlatform(platformFilter)) {
      return yield* Effect.fail(
        trainFailure(
          'select release train platform',
          platformFilter,
          `Unknown --platform "${platformFilter}". Use ios or android.`,
        ),
      );
    }
    const preparedTrain = yield* prepareTrain(commandOptions);
    const runtimeVersion = yield* resolveRuntimeVersion(
      preparedTrain.app,
      commandOptions.runtimeVersion,
    ).pipe(Effect.mapError((cause) => trainFailure('resolve train runtime version', cause)));
    const trainCarInput: ResolveCarsInput = {
      hasBundleId: preparedTrain.app.bundleId !== undefined,
      hasPackageName: preparedTrain.app.packageName !== undefined,
      hasCloudStorage: isCloudStorage(preparedTrain.config),
      runtimeVersion,
      channel: commandOptions.channel,
      noOta: !commandOptions.ota,
    };
    if (platformFilter !== undefined) trainCarInput.platformFilter = platformFilter;
    const trainCars = resolveTrainCars(trainCarInput);
    if (trainCars.platforms.length === 0) {
      return yield* Effect.fail(
        trainFailure(
          'resolve release train cars',
          preparedTrain.app,
          `${preparedTrain.app.name} declares no iOS bundle id or Android package - nothing to release.`,
        ),
      );
    }
    let otaDetail = '';
    if (trainCars.ota.length > 0) otaDetail = ' + OTA';
    yield* writeLog(
      'render release train start',
      preparedTrain.logger.step(
        'release-train',
        `starting ${preparedTrain.app.name}: ${trainCars.platforms.join(' + ')}${otaDetail}`,
      ),
    );
    const trainRecord = yield* startTrain(
      {
        id: mintTrainId(preparedTrain.app.name),
        app: preparedTrain.app.name,
        hold: commandOptions.hold === true,
        platforms: trainCars.platforms,
        ota: trainCars.ota,
        now: yield* currentIsoTime(),
      },
      preparedTrain.runtime.engine,
    );
    yield* persistTrain(trainRecord);
    yield* writeLog(
      'render release train tracking hint',
      preparedTrain.logger.note(
        `Track it with \`launch release-train status ${trainRecord.id} --watch\`.`,
      ),
    );
    yield* reportTrain(trainRecord, commandOptions, preparedTrain.logger);
  });

/** Reconcile and report the selected train, polling when requested. */
const statusReleaseTrain = (
  trainId: string | undefined,
  commandOptions: ReleaseTrainCommandOptions,
): Effect.Effect<void, CommandExit | ReleaseTrainCommandFailure, ReleaseTrainRequirements> =>
  Effect.gen(function* () {
    const targetTrain = yield* resolveTarget(trainId);
    const preparedTrain = yield* prepareTrain({ ...commandOptions, app: targetTrain.app });
    let trainRecord = yield* reconcileOnce(
      targetTrain,
      preparedTrain.runtime,
      false,
      preparedTrain.logger,
    );
    if (commandOptions.watch === true && commandOptions.json !== true) {
      while (!isTrainSettled(trainRecord)) {
        yield* Effect.sleep(WATCH_INTERVAL);
        trainRecord = yield* reconcileOnce(
          trainRecord,
          preparedTrain.runtime,
          false,
          preparedTrain.logger,
        );
        yield* writeLog('render release train watch', preparedTrain.logger.gap());
        yield* renderTrain(trainRecord, preparedTrain.logger);
      }
    }
    yield* reportTrain(trainRecord, commandOptions, preparedTrain.logger);
  });

/** Force the selected held train through its release gate. */
const releaseHeldTrain = (
  trainId: string | undefined,
  commandOptions: ReleaseTrainCommandOptions,
): Effect.Effect<void, CommandExit | ReleaseTrainCommandFailure, ReleaseTrainRequirements> =>
  Effect.gen(function* () {
    const targetTrain = yield* resolveTarget(trainId);
    const preparedTrain = yield* prepareTrain({ ...commandOptions, app: targetTrain.app });
    const trainRecord = yield* reconcileOnce(
      targetTrain,
      preparedTrain.runtime,
      true,
      preparedTrain.logger,
    );
    yield* reportTrain(trainRecord, commandOptions, preparedTrain.logger);
  });

/** Mark the selected train aborted without attempting to undo live cars. */
const abortReleaseTrain = (
  trainId: string | undefined,
  commandOptions: ReleaseTrainCommandOptions,
): Effect.Effect<void, CommandExit | ReleaseTrainCommandFailure, ReleaseTrainRecordRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const targetTrain = yield* resolveTarget(trainId);
    const abortedTrain: TrainRecord = {
      ...targetTrain,
      state: 'aborted',
      updatedAt: yield* currentIsoTime(),
    };
    yield* persistTrain(abortedTrain);
    yield* writeLog(
      'render aborted release train',
      logger.note(
        `Aborted ${abortedTrain.id}. Live cars are untouched - roll back explicitly with \`launch rollout pause\` or \`launch updates rollback\`.`,
      ),
    );
    yield* reportTrain(abortedTrain, commandOptions, logger);
  });

/** Dispatch one decoded release-train verb. */
const executeReleaseTrainCommand = (
  commandInput: ReleaseTrainCommandInput,
): Effect.Effect<void, CommandExit | ReleaseTrainCommandFailure, ReleaseTrainRequirements> => {
  switch (commandInput.action) {
    case 'start':
      return startReleaseTrain(commandInput.options);
    case 'status':
      return statusReleaseTrain(commandInput.id, commandInput.options);
    case 'release':
      return releaseHeldTrain(commandInput.id, commandInput.options);
    case 'abort':
      return abortReleaseTrain(commandInput.id, commandInput.options);
    default:
      return Effect.fail(
        trainFailure(
          'select release train action',
          commandInput.action,
          `Unknown action "${commandInput.action}". Use start, status, release, or abort.`,
        ),
      );
  }
};

/** Decode and execute one release-train command. */
export const releaseTrainCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, CommandExit | ReleaseTrainCommandFailure, ReleaseTrainRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(ReleaseTrainCommandInputSchema)(
      rawCommandInput,
    );
    return yield* executeReleaseTrainCommand(commandInput);
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(CommandExitSchema)(cause)) return cause;
      if (Schema.is(ReleaseTrainCommandFailureSchema)(cause)) return cause;
      return trainFailure('run release-train command', cause);
    }),
  );
