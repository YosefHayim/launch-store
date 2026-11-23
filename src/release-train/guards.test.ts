import { describe, expect, it } from 'vitest';
import { isCarTerminal, isNativeCar, isOtaCar } from './guards.ts';
import type { Car } from '../types/release-train.ts';
const at = '2026-06-16T00:00:00.000Z';
function ios(state: 'building' | 'released' | 'failed'): Car {
  return {
    kind: 'ios',
    state,
    updatedAt: at,
  };
}
function ota(state: 'pending' | 'published'): Car {
  return {
    kind: 'ota',
    platform: 'ios',
    channel: 'production',
    runtimeVersion: '1.0.0',
    state,
    updatedAt: at,
  };
}
function describeReleaseTrainCarGuards() {
  function discriminatesNativeVsOTACars() {
    expect(isNativeCar(ios('building'))).toBe(true);
    expect(isOtaCar(ios('building'))).toBe(false);
    expect(isOtaCar(ota('pending'))).toBe(true);
    expect(isNativeCar(ota('pending'))).toBe(false);
  }

  it('discriminates native vs OTA cars', discriminatesNativeVsOTACars);

  function treatsReleasedFailedNativeAndPublishedOTACarsAsTerminal() {
    expect(isCarTerminal(ios('released'))).toBe(true);
    expect(isCarTerminal(ios('failed'))).toBe(true);
    expect(isCarTerminal(ios('building'))).toBe(false);
    expect(isCarTerminal(ota('published'))).toBe(true);
    expect(isCarTerminal(ota('pending'))).toBe(false);
  }

  it(
    'treats released/failed native and published OTA cars as terminal',
    treatsReleasedFailedNativeAndPublishedOTACarsAsTerminal,
  );
}

describe('release-train car guards', describeReleaseTrainCarGuards);
