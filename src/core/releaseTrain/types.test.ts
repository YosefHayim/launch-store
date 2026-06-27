import { describe, expect, it } from 'vitest';
import { isCarTerminal, isNativeCar, isOtaCar, type Car } from './types.js';

const at = '2026-06-16T00:00:00.000Z';
const ios = (state: 'building' | 'released' | 'failed'): Car => ({
  kind: 'ios',
  state,
  updatedAt: at,
});
const ota = (state: 'pending' | 'published'): Car => ({
  kind: 'ota',
  platform: 'ios',
  channel: 'production',
  runtimeVersion: '1.0.0',
  state,
  updatedAt: at,
});

describe('release-train car guards', () => {
  it('discriminates native vs OTA cars', () => {
    expect(isNativeCar(ios('building'))).toBe(true);
    expect(isOtaCar(ios('building'))).toBe(false);
    expect(isOtaCar(ota('pending'))).toBe(true);
    expect(isNativeCar(ota('pending'))).toBe(false);
  });

  it('treats released/failed native and published OTA cars as terminal', () => {
    expect(isCarTerminal(ios('released'))).toBe(true);
    expect(isCarTerminal(ios('failed'))).toBe(true);
    expect(isCarTerminal(ios('building'))).toBe(false);
    expect(isCarTerminal(ota('published'))).toBe(true);
    expect(isCarTerminal(ota('pending'))).toBe(false);
  });
});
