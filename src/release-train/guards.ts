import type {
  Car,
  NativeCar,
  NativeCarState,
  OtaCar,
  TrainPlatform,
} from '../types/release-train.ts';

/** Narrow a {@link Car} to an {@link OtaCar}. */
export function isOtaCar(car: Car): car is OtaCar {
  return car.kind == 'ota';
}

/** Narrow a {@link Car} to a {@link NativeCar} (iOS / Android). */
export function isNativeCar(car: Car): car is NativeCar {
  return car.kind != 'ota';
}

/** Whether a platform value is one the train can coordinate. */
export function isTrainPlatform(platformCandidate: string): platformCandidate is TrainPlatform {
  if (platformCandidate == 'ios') return true;

  return platformCandidate == 'android';
}

/** Native car states past which no further action is taken. */
const terminalNativeStates = new Set<NativeCarState>(['released', 'failed']);

/** Whether a car has reached a terminal state (released/failed native, or published OTA). */
export function isCarTerminal(car: Car): boolean {
  if (isOtaCar(car)) return car.state == 'published';

  return terminalNativeStates.has(car.state);
}
