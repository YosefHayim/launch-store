import { Effect, Either } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import type {
  Car,
  NativeCar,
  NativeCarState,
  OtaCar,
  TrainPlatform,
  TrainRecord,
  TrainState,
} from '../types/releaseTrain.js';
import { isCarTerminal, isNativeCar, isOtaCar } from './guards.js';
import type { MutableDeep } from '../types/mutable.js';

/** Store and OTA operations driven by the release-train state machine. */
export type TrainEngine<Requirements = never> = Readonly<{
  submitNative: (
    trainCar: NativeCar,
  ) => Effect.Effect<Readonly<{ buildId?: string }>, unknown, Requirements>;
  readNative: (trainCar: NativeCar) => Effect.Effect<NativeCarState, unknown, Requirements>;
  releaseNative: (trainCar: NativeCar) => Effect.Effect<void, unknown, Requirements>;
  publishOta: (
    trainCar: OtaCar,
  ) => Effect.Effect<Readonly<{ manifestId?: string }>, unknown, Requirements>;
}>;

/** One OTA follower coordinated behind its native platform. */
export type OtaCarSpec = Readonly<{
  platform: TrainPlatform;
  channel: string;
  runtimeVersion: string;
}>;

/** Inputs used to create and submit a release train. */
export type StartTrainInput = Readonly<{
  id: string;
  app: string;
  hold: boolean;
  platforms: readonly TrainPlatform[];
  ota: readonly OtaCarSpec[];
  now: string;
}>;

/** Inputs controlling one release-train reconciliation. */
export type AdvanceOptions = Readonly<{
  now: string;
  force?: boolean;
  onWarn?: (message: string) => void;
}>;

/** Process exit codes for release-train status. */
export const TRAIN_EXIT = { ok: 0, error: 1, blocked: 2, inProgress: 3 } as const;

/** Whether a native car stopped at a failure that requires an operator. */
export const isNativeFailure = (trainCar: NativeCar): boolean => {
  if (trainCar.state === 'rejected') return true;
  return trainCar.state === 'failed';
};

/** Whether a native car is approved or already released (eligible for the hold gate). */
export const isNativeApprovedOrReleased = (trainCar: NativeCar): boolean => {
  if (trainCar.state === 'approved') return true;
  return trainCar.state === 'released';
};

/**
 * Whether the release gate may fire this reconcile.
 * Hold waits for every native car to be approved/released unless forced; a held failure blocks.
 */
export const isReleaseGateOpen = (
  hold: boolean,
  forced: boolean,
  hasNativeFailure: boolean,
  allNativeApprovedOrReleased: boolean,
): boolean => {
  const blocked = hold && !forced && hasNativeFailure;
  if (blocked) return false;
  if (forced) return true;
  if (!hold) return true;
  return allNativeApprovedOrReleased;
};

/** Derive the train lifecycle from its cars and hold gate. */
export const deriveTrainState = (
  trainCars: readonly Car[],
  hold: boolean,
  forced: boolean,
): TrainState => {
  if (trainCars.every(isCarTerminal)) return 'done';
  if (!hold) return 'running';
  if (forced) return 'running';
  if (trainCars.filter(isNativeCar).some(isNativeFailure)) return 'blocked';
  return 'running';
};

/** Submit each native car and append the requested pending OTA followers. */
export const startTrain = <Requirements>(
  trainInput: StartTrainInput,
  trainEngine: TrainEngine<Requirements>,
): Effect.Effect<TrainRecord, never, Requirements> =>
  Effect.gen(function* () {
    const trainCars: Car[] = [];
    for (const platform of trainInput.platforms) {
      const nativeCar: MutableDeep<NativeCar> = {
        kind: platform,
        state: 'building',
        updatedAt: trainInput.now,
      };
      const submission = yield* trainEngine.submitNative(nativeCar).pipe(Effect.either);
      if (Either.isLeft(submission)) {
        nativeCar.state = 'failed';
        nativeCar.error = errorMessage(submission.left);
      } else {
        nativeCar.state = 'submitted';
        if (submission.right.buildId !== undefined) {
          nativeCar.buildId = submission.right.buildId;
        }
      }
      trainCars.push(nativeCar);
    }
    for (const otaFollower of trainInput.ota) {
      trainCars.push({
        kind: 'ota',
        platform: otaFollower.platform,
        channel: otaFollower.channel,
        runtimeVersion: otaFollower.runtimeVersion,
        state: 'pending',
        updatedAt: trainInput.now,
      });
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
  });

/** Reconcile store state, open the release gate, and publish eligible OTA followers. */
export const advanceTrain = <Requirements>(
  trainRecord: TrainRecord,
  trainEngine: TrainEngine<Requirements>,
  advanceOptions: AdvanceOptions,
): Effect.Effect<TrainRecord, unknown, Requirements> =>
  Effect.gen(function* () {
    if (trainRecord.state === 'done') return trainRecord;
    if (trainRecord.state === 'aborted') return trainRecord;
    const forced = advanceOptions.force === true;
    const trainCars = trainRecord.cars.map((trainCar): MutableDeep<Car> => ({ ...trainCar }));

    for (const trainCar of trainCars) {
      if (!isNativeCar(trainCar)) continue;
      if (isCarTerminal(trainCar)) continue;
      const nextState = yield* trainEngine.readNative(trainCar);
      if (nextState === trainCar.state) continue;
      trainCar.state = nextState;
      trainCar.updatedAt = advanceOptions.now;
      if (!isNativeFailure(trainCar)) delete trainCar.error;
    }

    const nativeCars: MutableDeep<NativeCar>[] = [];
    for (const trainCar of trainCars) {
      if (!isNativeCar(trainCar)) continue;
      nativeCars.push(trainCar);
    }
    const hasNativeFailure = nativeCars.some(isNativeFailure);
    const allApproved = nativeCars.every(isNativeApprovedOrReleased);
    const gateOpen = isReleaseGateOpen(trainRecord.hold, forced, hasNativeFailure, allApproved);

    if (gateOpen) {
      for (const nativeCar of nativeCars) {
        if (nativeCar.state !== 'approved') continue;
        const releaseOutcome = yield* trainEngine.releaseNative(nativeCar).pipe(Effect.either);
        nativeCar.updatedAt = advanceOptions.now;
        if (Either.isLeft(releaseOutcome)) {
          nativeCar.state = 'failed';
          nativeCar.error = errorMessage(releaseOutcome.left);
          continue;
        }
        nativeCar.state = 'released';
        delete nativeCar.error;
      }
    }

    for (const otaCar of trainCars) {
      if (!isOtaCar(otaCar)) continue;
      if (otaCar.state !== 'pending') continue;
      const nativeCar = nativeCars.find((candidate) => candidate.kind === otaCar.platform);
      if (nativeCar === undefined) continue;
      if (nativeCar.state !== 'released') continue;
      const publishOutcome = yield* trainEngine.publishOta(otaCar).pipe(Effect.either);
      if (Either.isLeft(publishOutcome)) {
        if (advanceOptions.onWarn !== undefined) {
          advanceOptions.onWarn(
            `OTA ${otaCar.platform} (${otaCar.channel}/${otaCar.runtimeVersion}) publish failed: ${errorMessage(publishOutcome.left)}`,
          );
        }
        continue;
      }
      otaCar.state = 'published';
      if (publishOutcome.right.manifestId !== undefined) {
        otaCar.manifestId = publishOutcome.right.manifestId;
      }
      otaCar.updatedAt = advanceOptions.now;
    }

    return {
      ...trainRecord,
      cars: trainCars,
      state: deriveTrainState(trainCars, trainRecord.hold, forced),
      updatedAt: advanceOptions.now,
    };
  });

/** Resolve the process exit code for a train record. */
export const trainExitCode = (trainRecord: TrainRecord): number => {
  const hasNativeFailure = trainRecord.cars.filter(isNativeCar).some(isNativeFailure);
  if (trainRecord.state === 'blocked') return TRAIN_EXIT.blocked;
  if (hasNativeFailure) return TRAIN_EXIT.blocked;
  if (trainRecord.cars.some((trainCar) => !isCarTerminal(trainCar))) {
    return TRAIN_EXIT.inProgress;
  }
  return TRAIN_EXIT.ok;
};

/** Whether polling cannot advance the train without another operator action. */
export const isTrainSettled = (trainRecord: TrainRecord): boolean => {
  if (trainRecord.state === 'done') return true;
  if (trainRecord.state === 'aborted') return true;
  return trainRecord.state === 'blocked';
};
