// Starts or advances a release train that ships native and over-the-air updates together.

import { randomUUID } from 'node:crypto';
import { applyBuildEnvironment, resolveCommandEnv, selectApp } from '../build/pipeline-environment.ts';
import { loadConfig, type LoadedConfig } from '../config/config.ts';
import { parseCliEnv, type ResolvedEnv } from '../config/environment-file.ts';
import { resolveRuntimeVersion } from '../config/update-command.ts';
import { isCloudStorage } from '../distribution/storage.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import { completeCommand, isCommandExit } from '../terminal/command-exit.ts';
import type { AppDescriptor, BuildProfile } from '../types/app.ts';
import type { LaunchConfig } from '../types/config.ts';
import type { Car, NativeCar, OtaCar, TrainPlatform, TrainRecord } from '../types/release-train.ts';
import { createTrainRuntime, type TrainRuntime } from './builder.ts';
import { planTrainCars, type TrainCarPlanInput } from './engine.ts';
import { isOtaCar, isTrainPlatform } from './guards.ts';
import { advanceTrain, isTrainSettled, startTrain, trainExitCode } from './orchestrator.ts';
import {
  latestTrainRecord,
  listTrainRecords,
  readTrainRecord,
  writeTrainRecord,
} from './record.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { isFailureTag } from '../services/platform/tagged-failure.ts';

type ReleaseTrainCommandOptions = {
  app?: string;
  profile: string;
  platform?: string;
  ota: boolean;
  hold?: boolean;
  channel: string;
  runtimeVersion?: string;
  watch?: boolean;
  json?: boolean;
  env: string[];
  includeLocal: boolean;
};

type ReleaseTrainCommandInput = {
  action: string;
  id?: string;
  options: ReleaseTrainCommandOptions;
};

type ReleaseTrainCommandFailure = Readonly<{
  _tag: 'ReleaseTrainCommandFailure';
  operation: string;
  message: string;
  cause: unknown;
}>;

type PreparedTrain = Readonly<{
  config: LaunchConfig;
  app: AppDescriptor;
  runtime: TrainRuntime;
  logger: Logger;
}>;

function trainFailure(
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): ReleaseTrainCommandFailure {
  let message = fallbackMessage;

  if (message == null) {
    message = errorMessage(cause);
  }

  const isMessageEmpty = message.length == 0;

  if (isMessageEmpty) {
    message = `${operation} failed.`;
  }

  return { _tag: 'ReleaseTrainCommandFailure', operation, message, cause };
}

function readRequiredString(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string.`);
  }

  return field;
}

function readRequiredBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];

  if (typeof field != 'boolean') {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return field;
}

function readExactOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
): string | null {
  if (Object.hasOwn(record, fieldName) == false) {
    return null;
  }

  const field = record[fieldName];

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string.`);
  }

  return field;
}

function readExactOptionalBoolean(
  record: Record<string, unknown>,
  fieldName: string,
): boolean | null {
  if (Object.hasOwn(record, fieldName) == false) {
    return null;
  }

  const field = record[fieldName];

  if (typeof field != 'boolean') {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return field;
}

function copyStringList(entries: readonly unknown[], fieldName: string): string[] {
  const texts: string[] = [];

  for (const entry of entries) {
    if (typeof entry != 'string') {
      throw new Error(`${fieldName} must be a list of strings.`);
    }

    texts.push(entry);
  }

  return texts;
}

function readStringList(record: Record<string, unknown>, fieldName: string): string[] {
  const field = record[fieldName];

  if (Array.isArray(field)) {
    return copyStringList(field, fieldName);
  }

  throw new Error(`${fieldName} must be a list of strings.`);
}

function decodeReleaseTrainFlags(rawFlags: unknown): ReleaseTrainCommandOptions {
  const rawFlagsObject = readPlainObject(rawFlags);

  if (rawFlagsObject == null) {
    throw new Error('Release train options must be an object.');
  }

  const commandFlags: ReleaseTrainCommandOptions = {
    profile: readRequiredString(rawFlagsObject, 'profile'),
    ota: readRequiredBoolean(rawFlagsObject, 'ota'),
    channel: readRequiredString(rawFlagsObject, 'channel'),
    env: readStringList(rawFlagsObject, 'env'),
    includeLocal: readRequiredBoolean(rawFlagsObject, 'includeLocal'),
  };
  const appName = readExactOptionalString(rawFlagsObject, 'app');
  const platform = readExactOptionalString(rawFlagsObject, 'platform');
  const runtimeVersion = readExactOptionalString(rawFlagsObject, 'runtimeVersion');
  const hold = readExactOptionalBoolean(rawFlagsObject, 'hold');
  const watch = readExactOptionalBoolean(rawFlagsObject, 'watch');
  const json = readExactOptionalBoolean(rawFlagsObject, 'json');

  if (appName != null) {
    commandFlags.app = appName;
  }

  if (platform != null) {
    commandFlags.platform = platform;
  }

  if (runtimeVersion != null) {
    commandFlags.runtimeVersion = runtimeVersion;
  }

  if (hold != null) {
    commandFlags.hold = hold;
  }

  if (watch != null) {
    commandFlags.watch = watch;
  }

  if (json != null) {
    commandFlags.json = json;
  }

  return commandFlags;
}

/** Decode one requested release-train verb. */
export function ReleaseTrainCommandInputSchema(rawCommandInput: unknown): ReleaseTrainCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Release train command input must be an object.');
  }

  const commandInput: ReleaseTrainCommandInput = {
    action: readRequiredString(rawCommandInputObject, 'action'),
    options: decodeReleaseTrainFlags(rawCommandInputObject['options']),
  };
  const trainId = readExactOptionalString(rawCommandInputObject, 'id');

  if (trainId != null) {
    commandInput.id = trainId;
  }

  return commandInput;
}

/** Filesystem-safe app slug used in train ids. */
export function trainAppSlug(appName: string): string {
  const loweredName = appName.toLowerCase();
  // Turns every run of characters that are not letters or digits into one dash.
  const dashedName = loweredName.replace(/[^a-z0-9]+/g, '-');
  // Drops dashes left at the start or end of the slug.
  const appSlug = dashedName.replace(/^-+|-+$/g, '');

  const isSlugEmpty = appSlug == '';

  if (isSlugEmpty) {
    return 'train';
  }

  return appSlug;
}

/** Mint a stable train id from the app slug and a short random suffix. */
export function mintTrainId(appName: string): string {
  const trainIdSuffixLength = 4;
  const suffix = randomUUID().slice(0, trainIdSuffixLength);
  const appSlug = trainAppSlug(appName);

  return `${appSlug}-${suffix}`;
}

/** Format one train car's human label. */
export function carLabel(trainCar: Car): string {
  if (isOtaCar(trainCar)) {
    return `OTA ${trainCar.platform} (${trainCar.channel}/${trainCar.runtimeVersion})`;
  }

  return trainCar.kind;
}

function otaStatusDetail(trainCar: OtaCar): string {
  const isManifestMissing = trainCar.manifestId == null;

  if (isManifestMissing) {
    return '';
  }

  return ` - ${trainCar.manifestId}`;
}

function nativeStatusDetail(trainCar: NativeCar): string {
  const hasError = trainCar.error != null;

  if (hasError) {
    return ` - ${trainCar.error}`;
  }

  const hasBuildId = trainCar.buildId != null;

  if (hasBuildId) {
    return ` - build ${trainCar.buildId}`;
  }

  return '';
}

/** Extra status detail for one car (manifest id, build id, or error). */
export function carStatusDetail(trainCar: Car): string {
  if (isOtaCar(trainCar)) {
    return otaStatusDetail(trainCar);
  }

  return nativeStatusDetail(trainCar);
}

/** Format one train car's state and most useful identifier. */
export function carStatusLine(trainCar: Car): string {
  const detail = carStatusDetail(trainCar);

  return `${carLabel(trainCar)}: ${trainCar.state}${detail}`;
}

function renderTrain(trainRecord: TrainRecord, logger: Logger): void {
  let holdDetail = '';

  const isHeld = trainRecord.hold == true;

  if (isHeld) {
    holdDetail = ' - hold';
  }

  const statusLines = trainRecord.cars.map(carStatusLine);

  logger.box(
    `Train ${trainRecord.id} - ${trainRecord.app} - ${trainRecord.state}${holdDetail}`,
    statusLines,
  );
}

function currentIsoTime(): string {
  return new Date().toISOString();
}

type Wake = (settled?: void) => void;

function sleep(delayMilliseconds: number): Promise<void> {
  function wait(wake: Wake): void {
    function wakeLater(): void {
      wake();
    }

    setTimeout(wakeLater, delayMilliseconds);
  }

  return new Promise(wait);
}

function readTrainId(trainRecord: TrainRecord): string {
  return trainRecord.id;
}

async function failMissingNamedTrain(trainId: string): Promise<TrainRecord> {
  let knownTrains: TrainRecord[];

  try {
    knownTrains = await listTrainRecords();
  } catch (cause) {
    throw trainFailure('list release trains', cause);
  }

  const knownTrainIds = knownTrains.map(readTrainId);
  let knownTrainSummary = knownTrainIds.join(', ');

  const isSummaryEmpty = knownTrainSummary == '';

  if (isSummaryEmpty) {
    knownTrainSummary = 'none';
  }

  throw trainFailure(
    'find release train',
    trainId,
    `No release train "${trainId}". Known: ${knownTrainSummary}.`,
  );
}

async function readNamedTrain(trainId: string): Promise<TrainRecord> {
  const namedTrain = await readTrainRecord(trainId);

  const isMissing = namedTrain == null;

  if (isMissing) {
    return failMissingNamedTrain(trainId);
  }

  return namedTrain;
}

async function readLatestTrain(): Promise<TrainRecord> {
  let newestTrain: TrainRecord | null;

  try {
    newestTrain = await latestTrainRecord();
  } catch (cause) {
    throw trainFailure('read latest release train', cause);
  }

  if (newestTrain != null) {
    return newestTrain;
  }

  throw trainFailure(
    'find release train',
    undefined,
    'No release train yet. Start one with `launch-store release-train start`.',
  );
}

/** Load an explicit train id or the latest persisted train. */
async function loadTargetTrain(trainId: string | undefined): Promise<TrainRecord> {
  if (trainId != null) {
    return readNamedTrain(trainId);
  }

  return readLatestTrain();
}

function readTrainProfile(
  profiles: Record<string, BuildProfile>,
  profileName: string,
): BuildProfile {
  const selectedProfile = profiles[profileName];

  const isProfileMissing = selectedProfile == null;

  if (isProfileMissing) {
    return { name: profileName };
  }

  return selectedProfile;
}

async function prepareTrain(commandFlags: ReleaseTrainCommandOptions): Promise<PreparedTrain> {
  const logger = createLogger(false);
  let loadedConfiguration: LoadedConfig;

  try {
    loadedConfiguration = await loadConfig();
  } catch (cause) {
    throw trainFailure('load Launch configuration', cause);
  }

  let selectedApp: AppDescriptor;

  try {
    selectedApp = await selectApp(loadedConfiguration.apps, commandFlags.app);
  } catch (cause) {
    const failureMessage = errorMessage(cause);
    throw trainFailure('select app', cause, failureMessage);
  }

  const buildProfile = readTrainProfile(loadedConfiguration.config.profiles, commandFlags.profile);

  let environmentOverrides: Record<string, string>;

  try {
    environmentOverrides = parseCliEnv([...commandFlags.env]);
  } catch (cause) {
    const failureMessage = errorMessage(cause);
    throw trainFailure('parse environment overrides', cause, failureMessage);
  }

  let resolvedEnvironment: ResolvedEnv;

  try {
    resolvedEnvironment = await resolveCommandEnv({
      app: selectedApp,
      profile: buildProfile,
      cliEnv: environmentOverrides,
      includeLocal: commandFlags.includeLocal,
      envExclude: loadedConfiguration.config.envExclude,
    });
  } catch (cause) {
    throw trainFailure('resolve release train environment', cause);
  }

  const buildEnvironment = applyBuildEnvironment(resolvedEnvironment, logger);
  const runtime = createTrainRuntime(
    loadedConfiguration.config,
    selectedApp,
    buildProfile,
    buildEnvironment.values,
    commandFlags.hold == true,
    logger,
  );

  return {
    config: loadedConfiguration.config,
    app: selectedApp,
    runtime,
    logger,
  };
}

async function persistTrain(trainRecord: TrainRecord): Promise<void> {
  try {
    await writeTrainRecord(trainRecord);
  } catch (cause) {
    throw trainFailure('write release train', cause);
  }
}

async function reportTrain(
  trainRecord: TrainRecord,
  commandFlags: ReleaseTrainCommandOptions,
  logger: Logger,
): Promise<void> {
  const isJson = commandFlags.json == true;

  if (isJson) {
    const serialized = JSON.stringify(trainRecord, null, 2);
    logger.line(serialized);
  }

  if (isJson == false) {
    renderTrain(trainRecord, logger);
  }

  completeCommand(trainExitCode(trainRecord));
}

async function reconcileOnce(
  trainRecord: TrainRecord,
  runtime: TrainRuntime,
  force: boolean,
  logger: Logger,
): Promise<TrainRecord> {
  const warningMessages: string[] = [];

  function keepWarning(warningMessage: string): void {
    warningMessages.push(warningMessage);
  }

  let advancedTrain: TrainRecord;

  try {
    advancedTrain = await advanceTrain(trainRecord, runtime.engine, {
      now: currentIsoTime(),
      force,
      onWarn: keepWarning,
    });
  } catch (cause) {
    throw trainFailure('advance release train', cause);
  }

  await persistTrain(advancedTrain);

  for (const warningMessage of warningMessages) {
    logger.warn(warningMessage);
  }

  return advancedTrain;
}

function requireTrainPlatform(platformFilter: string | undefined): TrainPlatform | undefined {
  const isMissing = platformFilter == null;

  if (isMissing) {
    return undefined;
  }

  if (isTrainPlatform(platformFilter)) {
    return platformFilter;
  }

  throw trainFailure(
    'select release train platform',
    platformFilter,
    `Unknown --platform "${platformFilter}". Use ios or android.`,
  );
}

async function startReleaseTrain(commandFlags: ReleaseTrainCommandOptions): Promise<void> {
  const platformFilter = requireTrainPlatform(commandFlags.platform);
  const preparedTrain = await prepareTrain(commandFlags);
  const runtimeVersion = await runRuntimeVersion(preparedTrain.app, commandFlags.runtimeVersion);
  const hasBundleId = preparedTrain.app.bundleId != null;
  const hasPackageName = preparedTrain.app.packageName != null;
  const hasCloudStorage = isCloudStorage(preparedTrain.config);
  const skipsOta = commandFlags.ota == false;
  let trainCarInput: TrainCarPlanInput = {
    hasBundleId,
    hasPackageName,
    hasCloudStorage,
    runtimeVersion,
    channel: commandFlags.channel,
    noOta: skipsOta,
  };

  const hasPlatformFilter = platformFilter != null;

  if (hasPlatformFilter) {
    trainCarInput = { ...trainCarInput, platformFilter };
  }

  const trainCars = planTrainCars(trainCarInput);

  const hasNoPlatforms = trainCars.platforms.length == 0;

  if (hasNoPlatforms) {
    throw trainFailure(
      'resolve release train cars',
      preparedTrain.app,
      `${preparedTrain.app.name} declares no iOS bundle id or Android package - nothing to release.`,
    );
  }

  let otaDetail = '';

  const hasOta = trainCars.ota.length > 0;

  if (hasOta) {
    otaDetail = ' + OTA';
  }

  preparedTrain.logger.step(
    'release-train',
    `starting ${preparedTrain.app.name}: ${trainCars.platforms.join(' + ')}${otaDetail}`,
  );

  const trainRecord = await startTrain(
    {
      id: mintTrainId(preparedTrain.app.name),
      app: preparedTrain.app.name,
      hold: commandFlags.hold == true,
      platforms: trainCars.platforms,
      ota: trainCars.ota,
      now: currentIsoTime(),
    },
    preparedTrain.runtime.engine,
  );

  await persistTrain(trainRecord);
  preparedTrain.logger.note(
    `Track it with \`launch-store release-train status ${trainRecord.id} --watch\`.`,
  );
  await reportTrain(trainRecord, commandFlags, preparedTrain.logger);
}

async function runRuntimeVersion(
  appDescriptor: AppDescriptor,
  runtimeVersionFlag: string | undefined,
): Promise<string> {
  try {
    return await resolveRuntimeVersion(appDescriptor, runtimeVersionFlag);
  } catch (cause) {
    throw trainFailure('resolve train runtime version', cause);
  }
}

function shouldWatchTrain(commandFlags: ReleaseTrainCommandOptions): boolean {
  const isWatching = commandFlags.watch == true;

  if (isWatching == false) {
    return false;
  }

  const isJson = commandFlags.json == true;

  return isJson == false;
}

async function watchTrain(
  trainRecord: TrainRecord,
  preparedTrain: PreparedTrain,
): Promise<TrainRecord> {
  let currentTrain = trainRecord;
  const watchPollDelayMilliseconds = 30000;
  let isSettled = isTrainSettled(currentTrain);

  while (isSettled == false) {
    await sleep(watchPollDelayMilliseconds);
    currentTrain = await reconcileOnce(
      currentTrain,
      preparedTrain.runtime,
      false,
      preparedTrain.logger,
    );
    preparedTrain.logger.gap();
    renderTrain(currentTrain, preparedTrain.logger);
    isSettled = isTrainSettled(currentTrain);
  }

  return currentTrain;
}

async function statusReleaseTrain(
  trainId: string | undefined,
  commandFlags: ReleaseTrainCommandOptions,
): Promise<void> {
  const targetTrain = await loadTargetTrain(trainId);
  const preparedTrain = await prepareTrain({ ...commandFlags, app: targetTrain.app });
  let trainRecord = await reconcileOnce(
    targetTrain,
    preparedTrain.runtime,
    false,
    preparedTrain.logger,
  );

  const shouldWatch = shouldWatchTrain(commandFlags);

  if (shouldWatch) {
    trainRecord = await watchTrain(trainRecord, preparedTrain);
  }

  await reportTrain(trainRecord, commandFlags, preparedTrain.logger);
}

async function releaseHeldTrain(
  trainId: string | undefined,
  commandFlags: ReleaseTrainCommandOptions,
): Promise<void> {
  const targetTrain = await loadTargetTrain(trainId);
  const preparedTrain = await prepareTrain({ ...commandFlags, app: targetTrain.app });
  const trainRecord = await reconcileOnce(
    targetTrain,
    preparedTrain.runtime,
    true,
    preparedTrain.logger,
  );

  await reportTrain(trainRecord, commandFlags, preparedTrain.logger);
}

async function abortReleaseTrain(
  trainId: string | undefined,
  commandFlags: ReleaseTrainCommandOptions,
): Promise<void> {
  const logger = createLogger(false);
  const targetTrain = await loadTargetTrain(trainId);
  const abortedTrain: TrainRecord = {
    ...targetTrain,
    state: 'aborted',
    updatedAt: currentIsoTime(),
  };

  await persistTrain(abortedTrain);
  logger.note(
    `Aborted ${abortedTrain.id}. Live cars are untouched - roll back explicitly with \`launch-store rollout pause\` or \`launch-store updates rollback\`.`,
  );
  await reportTrain(abortedTrain, commandFlags, logger);
}

async function executeReleaseTrainCommand(commandInput: ReleaseTrainCommandInput): Promise<void> {
  if (commandInput.action == 'start') {
    return startReleaseTrain(commandInput.options);
  }

  if (commandInput.action == 'status') {
    return statusReleaseTrain(commandInput.id, commandInput.options);
  }

  if (commandInput.action == 'release') {
    return releaseHeldTrain(commandInput.id, commandInput.options);
  }

  if (commandInput.action == 'abort') {
    return abortReleaseTrain(commandInput.id, commandInput.options);
  }

  throw trainFailure(
    'select release train action',
    commandInput.action,
    `Unknown action "${commandInput.action}". Use start, status, release, or abort.`,
  );
}

/** Decode and execute one release-train command. */
export async function releaseTrainCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = ReleaseTrainCommandInputSchema(rawCommandInput);
    await executeReleaseTrainCommand(commandInput);
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    if (isFailureTag(cause, 'ReleaseTrainCommandFailure')) {
      throw cause;
    }

    throw trainFailure('run release-train command', cause);
  }
}
