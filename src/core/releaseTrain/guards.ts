import type {
  Car,
  NativeCar,
  NativeCarState,
  OtaCar,
  TrainPlatform,
} from '../types/releaseTrain.js';

/** Narrow a {@link Car} to an {@link OtaCar}. */
export const isOtaCar = (car: Car): car is OtaCar => car.kind === 'ota';

/** Narrow a {@link Car} to a {@link NativeCar} (iOS / Android). */
export const isNativeCar = (car: Car): car is NativeCar => car.kind !== 'ota';

/** Whether a platform value is one the train can coordinate. */
export const isTrainPlatform = (platformCandidate: string): platformCandidate is TrainPlatform => {
  if (platformCandidate === 'ios') return true;
  return platformCandidate === 'android';
};

/** Native car states past which no further action is taken. */
const TERMINAL_NATIVE_STATES = new Set<NativeCarState>(['released', 'failed']);

/** Whether a car has reached a terminal state (released/failed native, or published OTA). */
export const isCarTerminal = (car: Car): boolean => {
  if (isOtaCar(car)) return car.state === 'published';
  return TERMINAL_NATIVE_STATES.has(car.state);
};
