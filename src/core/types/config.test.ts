import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUILD_ENGINE,
  DEFAULT_CREDENTIALS_PROVIDER,
  DEFAULT_STORAGE_PROVIDER,
  DEFAULT_SUBMITTER,
  LaunchConfigSchema,
  SubmitByPlatformSchema,
} from './config.js';

describe('LaunchConfigSchema', () => {
  it('fills the four provider defaults on parse, so a minimal config only declares profiles', () => {
    const parsed = LaunchConfigSchema.parse({ profiles: {} });
    expect(parsed).toMatchObject({
      credentials: DEFAULT_CREDENTIALS_PROVIDER,
      storage: DEFAULT_STORAGE_PROVIDER,
      buildEngine: DEFAULT_BUILD_ENGINE,
      submit: DEFAULT_SUBMITTER,
    });
  });

  it('keeps a caller-set provider name over the default', () => {
    expect(LaunchConfigSchema.parse({ profiles: {}, storage: 's3' }).storage).toBe('s3');
  });

  it('rejects an unknown top-level key (strict root — the #197 gate)', () => {
    expect(LaunchConfigSchema.safeParse({ profiles: {}, nope: 1 }).success).toBe(false);
  });

  it('accepts the per-platform submit form for a subset of platforms', () => {
    const parsed = LaunchConfigSchema.parse({
      profiles: {},
      submit: { android: ['google-play', 'amazon-appstore'] },
    });
    expect(parsed.submit).toEqual({ android: ['google-play', 'amazon-appstore'] });
  });
});

describe('SubmitByPlatformSchema', () => {
  it('is a partial record — a single platform key is valid, unknown keys are not', () => {
    expect(SubmitByPlatformSchema.safeParse({ ios: ['app-store-connect'] }).success).toBe(true);
    expect(SubmitByPlatformSchema.safeParse({}).success).toBe(true);
    expect(SubmitByPlatformSchema.safeParse({ windows: ['x'] }).success).toBe(false);
  });
});
