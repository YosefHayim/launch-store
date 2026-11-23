import { errorMessage } from '../services/platform/error-message.ts';
import type { MutableDeep } from '../types/mutable.ts';
import type {
  Car,
  NativeCar,
  NativeCarState,
  OtaCar,
  TrainPlatform,
  TrainRecord,
  TrainState,
} from '../types/release-train.ts';
import { isCarTerminal, isNativeCar, isOtaCar } from './guards.ts';

/** Store and OTA operations driven by the release-train state machine. */
export type TrainEngine = Readonly<{
  submitNative(trainCar: NativeCar): Promise<Readonly<{ buildId?: string }>>;
  readNative(trainCar: NativeCar): Promise<NativeCarState>;
  releaseNative(trainCar: NativeCar): Promise<void>;
  publishOta(trainCar: OtaCar): Promise<Readonly<{ manifestId?: string }>>;
}>;

/** One OTA follower coordinated behind its native platform. */
export type OtaCarSpec = Readonly<{
  platform: TrainPlatform;
  channel: string;
  runtimeVersion: string;
}>;

type StartTrainInput = Readonly<{
  id: string;
  app: string;
  hold: boolean;
  platforms: readonly TrainPlatform[];
  ota: readonly OtaCarSpec[];
  now: string;
}>;

type AdvanceOptions = Readonly<{
  now: string;
  force?: boolean;
  onWarn?(warningMessage: string): void;
}>;

const TRAIN_EXIT = { ok: 0, error: 1, blocked: 2, inProgress: 3 } as const;

/** Whether a native car stopped at a failure that requires an operator. */
export function isNativeFailure(trainCar: NativeCar): boolean {
  if (trainCar.state == 'rejected') {
    return true;
  }

  return trainCar.state == 'failed';
}

/** Whether a native car is approved or already released (eligible for the hold gate). */
export function isNativeApprovedOrReleased(trainCar: NativeCar): boolean {
  if (trainCar.state == 'approved') {
    return true;
  }

  return trainCar.state == 'released';
}

/** Whether the release gate may fire this reconcile. */
export function isReleaseGateOpen(
  hold: boolean,
  forced: boolean,
  hasNativeFailure: boolean,
  allNativeApprovedOrReleased: boolean,
): boolean {
  const isForced = forced == true;

  if (isForced) {
    return true;
  }

  const isNotHeld = hold == false;

  if (isNotHeld) {
    return true;
  }

  const isNativeFailureBlocking = hasNativeFailure == true;

  if (isNativeFailureBlocking) {
    return false;
  }

  return allNativeApprovedOrReleased;
}

/** Derive the train lifecycle from its cars and hold gate. */
export function deriveTrainState(
  trainCars: readonly Car[],
  hold: boolean,
  forced: boolean,
): TrainState {
  const everyCarIsTerminal = trainCars.every(isCarTerminal);

  if (everyCarIsTerminal) {
    return 'done';
  }

  const isNotHeld = hold == false;

  if (isNotHeld) {
    return 'running';
  }

  const isForced = forced == true;

  if (isForced) {
    return 'running';
  }

  const nativeCars = trainCars.filter(isNativeCar);

  const hasNativeFailure = nativeCars.some(isNativeFailure);

  if (hasNativeFailure) {
    return 'blocked';
  }

  return 'running';
}

async function submitNativeCar(
  platform: NativeCar['kind'],
  trainInput: StartTrainInput,
  trainEngine: TrainEngine,
): Promise<NativeCar> {
  const nativeCar: MutableDeep<NativeCar> = {
    kind: platform,
    state: 'building',
    updatedAt: trainInput.now,
  };

  try {
    var submission = await trainEngine.submitNative(nativeCar);
  } catch (cause) {
    nativeCar.state = 'failed';
    nativeCar.error = errorMessage(cause);

    return nativeCar;
  }

  nativeCar.state = 'submitted';

  const submittedBuildId = submission.buildId;

  const hasBuildId = submittedBuildId != null;

  if (hasBuildId) {
    nativeCar.buildId = submittedBuildId;
  }

  return nativeCar;
}

/** Submit each native car and append the requested pending OTA followers. */
export async function startTrain(
  trainInput: StartTrainInput,
  trainEngine: TrainEngine,
): Promise<TrainRecord> {
  async function submitPlatform(platform: NativeCar['kind']): Promise<NativeCar> {
    return submitNativeCar(platform, trainInput, trainEngine);
  }

  const nativeCars = await Promise.all(trainInput.platforms.map(submitPlatform));
  const trainCars: Car[] = [...nativeCars];

  for (const otaFollower of trainInput.ota) {
    const otaCar: OtaCar = {
      kind: 'ota',
      platform: otaFollower.platform,
      channel: otaFollower.channel,
      runtimeVersion: otaFollower.runtimeVersion,
      state: 'pending',
      updatedAt: trainInput.now,
    };

    trainCars.push(otaCar);
  }

  return {
    id: trainInput.id,
    app: trainInput.app,
    hold: trainInput.hold,
    state: deriveTrainState(trainCars, trainInput.hold, false),
    createdAt: trainInput.now,
    updatedAt: trainInput.now,
    cars: trainCars,
  };
}

async function adoptNativeState(
  trainCar: MutableDeep<NativeCar>,
  trainEngine: TrainEngine,
  advanceOptions: AdvanceOptions,
): Promise<void> {
  const isTerminal = isCarTerminal(trainCar);

  if (isTerminal) {
    return;
  }

  const nextCarPhase = await trainEngine.readNative(trainCar);

  const phaseIsUnchanged = nextCarPhase == trainCar.state;

  if (phaseIsUnchanged) {
    return;
  }

  trainCar.state = nextCarPhase;
  trainCar.updatedAt = advanceOptions.now;

  const failed = isNativeFailure(trainCar);

  if (failed) {
    return;
  }

  delete trainCar.error;
}

async function releaseApprovedCar(
  nativeCar: MutableDeep<NativeCar>,
  trainEngine: TrainEngine,
  advanceOptions: AdvanceOptions,
): Promise<void> {
  const isApproved = nativeCar.state == 'approved';

  if (isApproved == false) {
    return;
  }

  nativeCar.updatedAt = advanceOptions.now;

  try {
    await trainEngine.releaseNative(nativeCar);
  } catch (cause) {
    nativeCar.state = 'failed';
    nativeCar.error = errorMessage(cause);

    return;
  }

  nativeCar.state = 'released';
  delete nativeCar.error;
}

async function publishReadyOta(
  otaCar: MutableDeep<OtaCar>,
  nativeCars: readonly MutableDeep<NativeCar>[],
  trainEngine: TrainEngine,
  advanceOptions: AdvanceOptions,
): Promise<void> {
  const isPending = otaCar.state == 'pending';

  if (isPending == false) {
    return;
  }

  function samePlatform(candidate: MutableDeep<NativeCar>): boolean {
    return candidate.kind == otaCar.platform;
  }

  const nativeCar = nativeCars.find(samePlatform);

  if (nativeCar == null) {
    return;
  }

  const isReleased = nativeCar.state == 'released';

  if (isReleased == false) {
    return;
  }

  try {
    var publishedUpdate = await trainEngine.publishOta(otaCar);
  } catch (cause) {
    const warn = advanceOptions.onWarn;

    const hasWarning = warn != null;

    if (hasWarning) {
      const failureMessage = errorMessage(cause);
      warn(
        `OTA ${otaCar.platform} (${otaCar.channel}/${otaCar.runtimeVersion}) publish failed: ${failureMessage}`,
      );
    }

    return;
  }

  otaCar.state = 'published';

  const publishedManifestId = publishedUpdate.manifestId;

  const hasManifestId = publishedManifestId != null;

  if (hasManifestId) {
    otaCar.manifestId = publishedManifestId;
  }

  otaCar.updatedAt = advanceOptions.now;
}

function copyCar(trainCar: Car): MutableDeep<Car> {
  return { ...trainCar };
}

/** Reconcile store state, open the release gate, and publish eligible OTA followers. */
export async function advanceTrain(
  trainRecord: TrainRecord,
  trainEngine: TrainEngine,
  advanceOptions: AdvanceOptions,
): Promise<TrainRecord> {
  const isDone = trainRecord.state == 'done';

  if (isDone) {
    return trainRecord;
  }

  const isAborted = trainRecord.state == 'aborted';

  if (isAborted) {
    return trainRecord;
  }

  const isForced = advanceOptions.force == true;
  // Copies so a reconcile never mutates the caller's record.
  const trainCars = trainRecord.cars.map(copyCar);

  for (const trainCar of trainCars) {
    if (isNativeCar(trainCar)) {
      await adoptNativeState(trainCar, trainEngine, advanceOptions);
    }
  }

  const nativeCars: MutableDeep<NativeCar>[] = [];

  for (const trainCar of trainCars) {
    if (isNativeCar(trainCar)) {
      nativeCars.push(trainCar);
    }
  }

  const hasNativeFailure = nativeCars.some(isNativeFailure);
  const allApproved = nativeCars.every(isNativeApprovedOrReleased);

  const gateOpen = isReleaseGateOpen(trainRecord.hold, isForced, hasNativeFailure, allApproved);

  if (gateOpen) {
    for (const nativeCar of nativeCars) {
      await releaseApprovedCar(nativeCar, trainEngine, advanceOptions);
    }
  }

  for (const trainCar of trainCars) {
    if (isOtaCar(trainCar)) {
      await publishReadyOta(trainCar, nativeCars, trainEngine, advanceOptions);
    }
  }

  return {
    ...trainRecord,
    cars: trainCars,
    state: deriveTrainState(trainCars, trainRecord.hold, isForced),
    updatedAt: advanceOptions.now,
  };
}

function isCarStillMoving(trainCar: Car): boolean {
  return isCarTerminal(trainCar) == false;
}

/** Resolve the process exit code for a train record. */
export function trainExitCode(trainRecord: TrainRecord): number {
  const nativeCars = trainRecord.cars.filter(isNativeCar);
  const hasNativeFailure = nativeCars.some(isNativeFailure);

  const isBlocked = trainRecord.state == 'blocked';

  if (isBlocked) {
    return TRAIN_EXIT.blocked;
  }

  if (hasNativeFailure) {
    return TRAIN_EXIT.blocked;
  }

  const hasOpenCar = trainRecord.cars.some(isCarStillMoving);

  if (hasOpenCar) {
    return TRAIN_EXIT.inProgress;
  }

  return TRAIN_EXIT.ok;
}

/** Whether polling cannot advance the train without another operator action. */
export function isTrainSettled(trainRecord: TrainRecord): boolean {
  const isDone = trainRecord.state == 'done';

  if (isDone) {
    return true;
  }

  const isAborted = trainRecord.state == 'aborted';

  if (isAborted) {
    return true;
  }

  return trainRecord.state == 'blocked';
}
