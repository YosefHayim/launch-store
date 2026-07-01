/**
 * Runtime classifiers for release-train cars — the predicates the orchestrator and CLI use to walk a
 * {@link TrainRecord}'s cars without naming concrete states inline. Kept beside the feature (not in the
 * type-only `core/types/` barrel) because they are logic, not shapes; the shapes they narrow live in
 * `core/types/releaseTrain.ts`.
 */

import type { Car, NativeCar, NativeCarState, OtaCar, TrainPlatform } from '../types.js';

/** Narrow a {@link Car} to an {@link OtaCar}. */
export function isOtaCar(car: Car): car is OtaCar {
  return car.kind === 'ota';
}

/** Narrow a {@link Car} to a {@link NativeCar} (iOS / Android). */
export function isNativeCar(car: Car): car is NativeCar {
  return car.kind !== 'ota';
}

/** Whether a `--platform` value is one the train can coordinate (iOS / Android), narrowing it to {@link TrainPlatform}. */
export function isTrainPlatform(value: string): value is TrainPlatform {
  return value === 'ios' || value === 'android';
}

/** Native car states past which no further action is taken — the car has reached an end of its lifecycle. */
const TERMINAL_NATIVE_STATES = new Set<NativeCarState>(['released', 'failed']);

/** Whether a car has reached a terminal state (a released/failed native car, or a published OTA car). */
export function isCarTerminal(car: Car): boolean {
  return isOtaCar(car) ? car.state === 'published' : TERMINAL_NATIVE_STATES.has(car.state);
}
