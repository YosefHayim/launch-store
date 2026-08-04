import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { parseLaunchConfig, validateLaunchConfig } from './schema.js';
describe('parseLaunchConfig', () => {
  it('fills provider defaults through Effect Schema', () => {
    const parsed = Effect.runSync(parseLaunchConfig({ profiles: {} }));
    expect(parsed).toMatchObject({
      credentials: 'local',
      storage: 'local',
      buildEngine: 'fastlane',
      submit: 'app-store-connect',
    });
  });
  it('accepts a per-platform submit map for a subset of platforms', () => {
    const parsed = Effect.runSync(
      parseLaunchConfig({
        profiles: {},
        submit: { android: ['google-play', 'amazon-appstore'] },
      }),
    );
    expect(parsed.submit).toEqual({ android: ['google-play', 'amazon-appstore'] });
  });
});
describe('validateLaunchConfig', () => {
  it('rejects an unknown top-level key as an unknown property', () => {
    expect(validateLaunchConfig({ profiles: {}, nope: true })).toContainEqual({
      path: 'nope',
      message: 'unknown property',
    });
  });
  it('flags malformed nested fields at dotted paths', () => {
    const violations = validateLaunchConfig({
      profiles: { production: { name: 'production', sizeBudgetMB: 'big' } },
      release: { releaseType: 'WHENEVER' },
    });
    expect(
      violations.some((violation) => violation.path === 'profiles.production.sizeBudgetMB'),
    ).toBe(true);
    expect(violations.some((violation) => violation.path === 'release.releaseType')).toBe(true);
  });
  it('rejects unknown per-platform submit keys without requiring every platform', () => {
    const violations = validateLaunchConfig({
      profiles: {},
      submit: { windows: ['store'] },
    });
    expect(violations).toContainEqual({ path: 'submit.windows', message: 'unknown property' });
    expect(violations.some((violation) => violation.path === 'submit.ios')).toBe(false);
  });
});
