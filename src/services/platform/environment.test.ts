import { afterEach, describe, expect, it } from 'vitest';
import {
  readLaunchEnvironment,
  resetLaunchEnvironment,
  useLaunchEnvironment,
} from './environment.ts';

afterEach(function resetEnvironment() {
  resetLaunchEnvironment();
});

describe('readLaunchEnvironment', () => {
  it('provides an empty environment', () => {
    useLaunchEnvironment({});
    const launchEnvironment = readLaunchEnvironment();
    expect(launchEnvironment.values).toEqual({});
  });

  it('reads a secret as a string and returns null when it is missing', () => {
    useLaunchEnvironment({ DEMO_PASSWORD: 'review-secret' });
    const environment = readLaunchEnvironment();
    expect(environment.readSecret('DEMO_PASSWORD')).toBe('review-secret');
    expect(environment.readSecret('MISSING_PASSWORD')).toBeNull();
    expect(environment.values).toEqual({});
  });
});
