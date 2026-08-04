import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { parseLaunchConfig, validateLaunchConfig } from '../config/schema.js';
import {
  DEFAULT_BUILD_ENGINE,
  DEFAULT_CREDENTIALS_PROVIDER,
  DEFAULT_STORAGE_PROVIDER,
  DEFAULT_SUBMITTER,
} from './config.js';
describe('LaunchConfig Effect Schema boundary', () => {
  it('fills the four provider defaults on parse, so a minimal config only declares profiles', async () => {
    const parsed = await Effect.runPromise(parseLaunchConfig({ profiles: {} }));
    expect(parsed).toMatchObject({
      credentials: DEFAULT_CREDENTIALS_PROVIDER,
      storage: DEFAULT_STORAGE_PROVIDER,
      buildEngine: DEFAULT_BUILD_ENGINE,
      submit: DEFAULT_SUBMITTER,
    });
  });
  it('keeps a caller-set provider name over the default', async () => {
    const parsed = await Effect.runPromise(parseLaunchConfig({ profiles: {}, storage: 's3' }));
    expect(parsed.storage).toBe('s3');
  });
  it('rejects an unknown top-level key (strict root - the #197 gate)', () => {
    expect(validateLaunchConfig({ profiles: {}, nope: 1 }).length).toBeGreaterThan(0);
  });
  it('accepts the per-platform submit form for a subset of platforms', async () => {
    const parsed = await Effect.runPromise(
      parseLaunchConfig({
        profiles: {},
        submit: { android: ['google-play', 'amazon-appstore'] },
      }),
    );
    expect(parsed.submit).toEqual({ android: ['google-play', 'amazon-appstore'] });
  });
});
describe('SubmitByPlatform validation via LaunchConfig schema', () => {
  it('accepts a single platform key and rejects unknown platform keys', () => {
    expect(
      validateLaunchConfig({
        profiles: {},
        submit: { ios: ['app-store-connect'] },
      }),
    ).toEqual([]);
    expect(validateLaunchConfig({ profiles: {}, submit: {} })).toEqual([]);
    expect(
      validateLaunchConfig({
        profiles: {},
        submit: { windows: ['x'] },
      }).length,
    ).toBeGreaterThan(0);
  });
});
